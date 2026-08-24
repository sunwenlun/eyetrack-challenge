// ===== qrcode.js =====
/**
 * EyeTrack Challenge — Zero-dependency QR Code generator (byte mode).
 *
 * A compact, self-contained QR Code encoder modeled on the well-known
 * public-domain Nayuki algorithm. Supports byte-mode encoding for UTF-8
 * text, error-correction levels L/M/Q/H, and automatic version (1-10) and
 * mask selection. No external libraries required.
 *
 * Exposes window.QRCode (browser) and module.exports (Node/bundler).
 *
 * @example
 *   const qr = QRCode.generate('https://eyetrack.fun', { ecLevel: 'M' });
 *   // qr.size        -> module count per side
 *   // qr.modules[y][x] -> true === dark module
 */

/* ------------------------------------------------------------------ *
 *  Error-correction level descriptors                                 *
 *  ordinal follows the ISO/IEC 18004 table column order L,M,Q,H.      *
 *  formatBits are the 2-bit indicators embedded in the format string. *
 * ------------------------------------------------------------------ */
const ECL_LIST = [
  { name: 'L', formatBits: 1, ordinal: 0 },
  { name: 'M', formatBits: 0, ordinal: 1 },
  { name: 'Q', formatBits: 3, ordinal: 2 },
  { name: 'H', formatBits: 2, ordinal: 3 }
];
const ECL_BY_NAME = { L: ECL_LIST[0], M: ECL_LIST[1], Q: ECL_LIST[2], H: ECL_LIST[3] };

/** Highest version this implementation will attempt (kept small on purpose). */
const MAX_VERSION = 10;

/* ------------------------------------------------------------------ *
 *  Static QR tables (index: [version][eclOrdinal])                    *
 *  Source: ISO/IEC 18004 Annex — Error correction characteristics.    *
 * ------------------------------------------------------------------ */
const ECC_CODEWORDS_PER_BLOCK = [
  [7, 10, 13, 17], // v1
  [10, 16, 22, 28], // v2
  [15, 26, 18, 22], // v3
  [20, 18, 26, 16], // v4
  [34, 16, 18, 22], // v5
  [18, 16, 24, 28], // v6
  [20, 18, 18, 26], // v7
  [24, 22, 22, 26], // v8
  [30, 22, 20, 24], // v9
  [18, 26, 24, 28] // v10
];

const NUM_ERROR_CORRECTION_BLOCKS = [
  [1, 1, 1, 1], // v1
  [1, 1, 1, 1], // v2
  [1, 1, 2, 2], // v3
  [1, 2, 2, 4], // v4
  [1, 2, 2, 2], // v5
  [2, 4, 4, 4], // v6
  [2, 4, 2, 4], // v7
  [2, 2, 4, 4], // v8
  [2, 3, 4, 4], // v9
  [2, 4, 6, 6] // v10
];

/* Penalty weights for automatic mask selection (ISO/IEC 18004 6.8.2.2). */
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/* ------------------------------------------------------------------ *
 *  Bit-buffer helpers                                                 *
 * ------------------------------------------------------------------ */

/**
 * Appends the lowest `len` bits of `val` (MSB first) to a bit array.
 * @param {number[]} buffer - Array of 0/1 bits to extend in place.
 * @param {number} val - Value whose bits are appended.
 * @param {number} len - Number of low-order bits to append.
 * @returns {void}
 */
function appendBits(buffer, val, len) {
  for (let i = len - 1; i >= 0; i--) {
    buffer.push((val >>> i) & 1);
  }
}

/**
 * Tests whether bit `i` of `x` is set.
 * @param {number} x - The integer to test.
 * @param {number} i - Zero-based bit index.
 * @returns {boolean} True if the bit is 1.
 */
function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

/**
 * Encodes a string as UTF-8 bytes (manual, dependency-free).
 * @param {string} str - Input text.
 * @returns {number[]} Array of byte values (0-255).
 */
function toUtf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      // Surrogate pair -> encode as a single code point (4 bytes).
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

/* ------------------------------------------------------------------ *
 *  Galois field (GF(256)) arithmetic for Reed-Solomon                *
 * ------------------------------------------------------------------ */

/**
 * Multiplies two numbers in GF(256) using the 0x11D primitive polynomial.
 * @param {number} x - Operand A (0-255).
 * @param {number} y - Operand B (0-255).
 * @returns {number} Product in GF(256).
 */
function reedSolomonMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/**
 * Computes the Reed-Solomon generator polynomial coefficients (degree terms
 * only, highest to lowest, excluding the implicit leading 1).
 * @param {number} degree - Number of error-correction codewords.
 * @returns {number[]} Divisor coefficients.
 */
function reedSolomonComputeDivisor(degree) {
  const result = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1); // start with monomial x^0
  let root = 1; // 1 is a primitive root of GF(256)
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

/**
 * Computes Reed-Solomon error-correction remainder bytes for `data`.
 * @param {number[]} data - Data bytes.
 * @param {number[]} divisor - Generator polynomial from reedSolomonComputeDivisor.
 * @returns {number[]} Error-correction codewords.
 */
function reedSolomonComputeRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
}

/* ------------------------------------------------------------------ *
 *  Version / capacity math                                            *
 * ------------------------------------------------------------------ */

/**
 * Returns the number of raw data modules for a given version.
 * @param {number} ver - QR version (1-40).
 * @returns {number} Count of raw (pre-error-correction) data modules.
 */
function getNumRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/**
 * Returns the number of data codewords available for a version + EC level.
 * @param {number} ver - QR version (1-40).
 * @param {Object} ecl - Error-correction descriptor from ECL_LIST.
 * @returns {number} Number of data codewords.
 */
function getNumDataCodewords(ver, ecl) {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ver - 1][ecl.ordinal] *
      NUM_ERROR_CORRECTION_BLOCKS[ver - 1][ecl.ordinal]
  );
}

/**
 * Returns the character-count bit length for byte mode at a version.
 * @param {number} ver - QR version (1-40).
 * @returns {number} 8 for versions 1-9, 16 for 10-40.
 */
function numCharCountBits(ver) {
  return ver <= 9 ? 8 : 16;
}

/**
 * Returns alignment-pattern center coordinates for a version.
 * @param {number} ver - QR version (1-40).
 * @returns {number[]} Sorted center positions (empty for version 1).
 */
function getAlignmentPatternPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const result = [6];
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  for (let pos = ver * 4 + 17 - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/* ------------------------------------------------------------------ *
 *  QR Code model                                                      *
 * ------------------------------------------------------------------ */

/**
 * @class QrCode
 * @description Holds the final module matrix for a single QR symbol.
 */
class QrCode {
  /**
   * Builds a QR Code from already-padded data codewords.
   * @param {number} version - Version number (1-40).
   * @param {Object} ecl - Error-correction descriptor from ECL_LIST.
   * @param {number[]} dataCodewords - Padded data codewords.
   */
  constructor(version, ecl, dataCodewords) {
    this.version = version;
    this.errorCorrectionLevel = ecl;
    if (dataCodewords.length !== getNumDataCodewords(version, ecl)) {
      throw new RangeError('Invalid data codeword count for version/EC level');
    }
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }

    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Automatic mask selection: pick the mask with the lowest penalty.
    let mask = -1;
    if (mask < 0) {
      let minPenalty = 1000000000;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          mask = i;
          minPenalty = penalty;
        }
        this.applyMask(i); // undo (XOR is its own inverse)
      }
    }
    this.mask = mask;
    this.applyMask(this.mask);
    this.drawFormatBits(this.mask);
    this.isFunction = []; // no longer needed once drawing is complete
  }

  /**
   * Marks a module as a function pattern and sets its color.
   * @param {number} x - Column.
   * @param {number} y - Row.
   * @param {boolean} isDark - Whether the module is dark.
   * @returns {void}
   */
  setFunctionModule(x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  /**
   * Draws the three 7x7 finder patterns plus separators.
   * @param {number} x - Center column.
   * @param {number} y - Center row.
   * @returns {void}
   */
  drawFinderPattern(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  /**
   * Draws a 5x5 alignment pattern centered at (x, y).
   * @param {number} x - Center column.
   * @param {number} y - Center row.
   * @returns {void}
   */
  drawAlignmentPattern(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  /**
   * Draws all fixed function patterns (timing, finders, alignment,
   * format, version) before data placement.
   * @returns {void}
   */
  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const alignPos = getAlignmentPatternPositions(this.version);
    const numAlign = alignPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) {
          continue; // overlaps a finder pattern
        }
        this.drawAlignmentPattern(alignPos[i], alignPos[j]);
      }
    }
    this.drawFormatBits(0); // dummy mask value; real one drawn later
    this.drawVersion();
  }

  /**
   * Draws the 15-bit format string (EC level + mask) in both copies.
   * @param {number} mask - Selected mask (0-7).
   * @returns {void}
   */
  drawFormatBits(mask) {
    const data = (this.errorCorrectionLevel.formatBits << 3) | mask; // 5 bits
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; // 15 bits

    // First copy
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    // Second copy
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // always-dark module
  }

  /**
   * Draws the 18-bit version string (versions 7+ only).
   * @returns {void}
   */
  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem; // 18 bits
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  /**
   * Splits data into blocks, appends Reed-Solomon EC, and interleaves.
   * @param {number[]} data - Data codewords.
   * @returns {number[]} Final codeword sequence ready for placement.
   */
  addEccAndInterleave(data) {
    const ver = this.version;
    const ecl = this.errorCorrectionLevel;
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ver - 1][ecl.ordinal];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ver - 1][ecl.ordinal];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const rsDiv = reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += dat.length;
      const ecc = reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) dat.push(0); // pad short blocks to equal length
      blocks.push(dat.concat(ecc));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        // Skip the padding byte in short blocks
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(blocks[j][i]);
        }
      }
    }
    return result;
  }

  /**
   * Places the interleaved codewords into the zig-zag data region.
   * @param {number[]} data - Interleaved codewords.
   * @returns {void}
   */
  drawCodewords(data) {
    if (data.length !== Math.floor(getNumRawDataModules(this.version) / 8)) {
      throw new RangeError('Invalid codeword count: got ' + data.length +
        ' expected ' + Math.floor(getNumRawDataModules(this.version) / 8) +
        ' (v' + this.version + ' ecl=' + this.errorCorrectionLevel.name + ')');
    }
    let i = 0; // bit index into data
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the vertical timing column
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  /**
   * Applies (or undoes) a mask pattern by XOR-ing data modules.
   * @param {number} mask - Mask index (0-7).
   * @returns {void}
   */
  applyMask(mask) {
    if (mask < 0 || mask > 7) throw new RangeError('Mask value out of range');
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = false;
        }
        if (!this.isFunction[y][x] && invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  /**
   * Counts consecutive-run patterns that resemble a finder pattern.
   * @param {number[]} runHistory - Seven most-recent run lengths.
   * @returns {number} 0, 1, or 2 finder-like matches.
   */
  finderPenaltyCountPatterns(runHistory) {
    const n = runHistory[1];
    const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3 && runHistory[4] === n && runHistory[5] === n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
    );
  }

  /**
   * Adds a run length to history, prepending the light border for the first.
   * @param {number} currentRunLength - Length to record.
   * @param {number[]} runHistory - Seven-length history array (mutated).
   * @returns {void}
   */
  finderPenaltyAddHistory(currentRunLength, runHistory) {
    if (runHistory[0] === 0) currentRunLength += this.size; // initial border
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }

  /**
   * Finalizes a run, adds the trailing border, and scores finder-like patterns.
   * @param {boolean} currentRunColor - Color of the run being terminated.
   * @param {number} currentRunLength - Length of the run.
   * @param {number[]} runHistory - Seven-length history array.
   * @returns {number} Finder-pattern penalty contribution.
   */
  finderPenaltyTerminateAndCount(currentRunColor, currentRunLength, runHistory) {
    if (currentRunColor) {
      this.finderPenaltyAddHistory(currentRunLength, runHistory);
      currentRunLength = 0;
    }
    currentRunLength += this.size; // final light border
    this.finderPenaltyAddHistory(currentRunLength, runHistory);
    return this.finderPenaltyCountPatterns(runHistory);
  }

  /**
   * Computes the penalty score for the chosen mask (ISO/IEC 18004 6.8.2.2).
   * @returns {number} Total penalty score (lower is better).
   */
  getPenaltyScore() {
    let result = 0;
    const size = this.size;
    const modules = this.modules;

    // Rule 1 + 3: row runs
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runX = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += PENALTY_N1;
          else if (runX > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runX, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          runX = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * PENALTY_N3;
    }

    // Rule 1 + 3: column runs
    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runY = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < size; y++) {
        if (modules[y][x] === runColor) {
          runY++;
          if (runY === 5) result += PENALTY_N1;
          else if (runY > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runY, runHistory);
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
          runColor = modules[y][x];
          runY = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * PENALTY_N3;
    }

    // Rule 2: 2x2 blocks of the same color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }

    // Rule 4: dark-module balance
    let dark = 0;
    for (const row of modules) {
      for (const c of row) if (c) dark++;
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }
}

/**
 * Encodes byte data into the smallest QR Code that fits the requested EC level.
 * May upgrade the EC level (without changing the version) if it still fits.
 * @param {number[]} dataBytes - UTF-8 bytes to encode.
 * @param {Object} ecl - Error-correction descriptor from ECL_LIST.
 * @param {number} maxVersion - Upper bound on version selection.
 * @param {boolean} boostEcl - Whether to raise the EC level when possible.
 * @returns {QrCode} The constructed QR Code.
 */
function encodeSegments(dataBytes, ecl, maxVersion, boostEcl) {
  let version = 1;
  let dataUsedBits = 0;
  for (;;) {
    const dataCapBits = getNumDataCodewords(version, ecl) * 8;
    const used = 4 + numCharCountBits(version) + dataBytes.length * 8;
    if (used <= dataCapBits) {
      dataUsedBits = used;
      break;
    }
    if (version >= maxVersion) throw new RangeError('Data too long for QR encoder (max version ' + maxVersion + ')');
    version++;
  }

  if (boostEcl) {
    for (const lvl of [ECL_LIST[1], ECL_LIST[2], ECL_LIST[3]]) {
      if (dataUsedBits <= getNumDataCodewords(version, lvl) * 8) {
        ecl = lvl;
        break;
      }
    }
  }

  // Build the bit buffer: mode (4) + char count + data + terminator + padding.
  const bb = [];
  appendBits(bb, 0b0100, 4); // byte mode indicator
  appendBits(bb, dataBytes.length, numCharCountBits(version));
  for (const b of dataBytes) appendBits(bb, b, 8);

  const dataCapBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(bb, 0, Math.min(4, dataCapBits - bb.length)); // terminator
  appendBits(bb, 0, (8 - (bb.length % 8)) % 8); // pad to byte boundary
  for (let pad = 0xec; bb.length < dataCapBits; pad ^= 0xec ^ 0x11) {
    appendBits(bb, pad, 8); // alternating pad bytes 0xEC / 0x11
  }

  // Pack bits into codewords (big-endian).
  const dataCodewords = new Array(dataCapBits / 8).fill(0);
  for (let i = 0; i < bb.length; i++) {
    dataCodewords[i >> 3] |= bb[i] << (7 - (i & 7));
  }

  return new QrCode(version, ecl, dataCodewords);
}

/* ------------------------------------------------------------------ *
 *  Public API                                                         *
 * ------------------------------------------------------------------ */

const QRCode = {
  /**
   * Generates a QR Code matrix for the given text.
   * @param {string} text - Text to encode (UTF-8).
   * @param {Object} [opts] - Options.
   * @param {'L'|'M'|'Q'|'H'} [opts.ecLevel='M'] - Error-correction level.
   * @returns {{version:number, size:number, modules:boolean[][]}}
   *   version  - QR version (1-MAX_VERSION)
   *   size     - Modules per side
   *   modules  - modules[y][x] is true for a dark module
   */
  generate(text, opts) {
    opts = opts || {};
    const ecName = opts.ecLevel || 'M';
    const ecl = ECL_BY_NAME[ecName];
    if (!ecl) throw new Error('Invalid ecLevel: ' + ecName + ' (use L/M/Q/H)');
    const dataBytes = toUtf8Bytes(String(text));
    const qr = encodeSegments(dataBytes, ecl, MAX_VERSION, true);
    return {
      version: qr.version,
      size: qr.size,
      mask: qr.mask,
      modules: qr.modules.map((row) => row.slice())
    };
  }
};

// Expose for classic <script> consumers.
if (typeof window !== 'undefined') {
  window.QRCode = QRCode;
}

// Expose for Node / bundler consumers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = QRCode;
}

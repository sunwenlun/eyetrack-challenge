// ===== qrcode.test.js =====
/**
 * Validates the hand-rolled QR encoder against the reference `qrcode` library.
 * Compares the final module matrices (encoding + mask selection) for a set of
 * real-world inputs at several EC levels. Exits non-zero on any mismatch.
 */
const path = require('path');
const QRCode = require(path.join(__dirname, 'qrcode.js'));
const QrLib = require('qrcode');

/**
 * Builds a module matrix from our encoder.
 * @param {string} text
 * @param {string} ecl
 * @returns {{size:number, modules:boolean[][]}}
 */
function myMatrix(text, ecl) {
  const qr = QRCode.generate(text, { ecLevel: ecl });
  return { size: qr.size, modules: qr.modules };
}

/**
 * Builds a module matrix from the reference library.
 * @param {string} text
 * @param {string} ecl
 * @returns {{size:number, modules:boolean[][]}}
 */
function libMatrix(text, ecl) {
  const qr = QrLib.create(text, { errorCorrectionLevel: ecl });
  const size = qr.modules.size;
  const data = qr.modules.data; // row-major Uint8Array, 1 = dark
  const modules = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(!!data[r * size + c]);
    modules.push(row);
  }
  return { size, modules };
}

const cases = [
  ['https://eyetrack.fun', 'M'],
  ['https://eyetrack.fun', 'L'],
  ['https://eyetrack.fun', 'Q'],
  ['https://eyetrack.fun', 'H'],
  ['https://eyetrack.fun/daily', 'M'],
  ['https://eyetrack.fun/play?lvl=12', 'M'],
  ['HELLO WORLD', 'M'],
  ['https://example.com/x', 'H'],
  ['https://eyetrack.fun', 'M'], // duplicate to double-check determinism
  ['a'.repeat(40), 'L']
];

let allPass = true;
for (const [text, ecl] of cases) {
  const a = myMatrix(text, ecl);
  const b = libMatrix(text, ecl);
  let ok = a.size === b.size;
  if (ok) {
    for (let r = 0; r < a.size && ok; r++) {
      for (let c = 0; c < a.size; c++) {
        if (a.modules[r][c] !== b.modules[r][c]) {
          ok = false;
          break;
        }
      }
    }
  }
  if (!ok) {
    allPass = false;
    console.log(`FAIL  text="${text}" ec=${ecl}  size my=${a.size} lib=${b.size}`);
  } else {
    console.log(`PASS  text="${text}" ec=${ecl}  size=${a.size} v? mask?`);
  }
}

console.log(allPass ? '\nALL QR MATRICES MATCH ✅' : '\nSOME QR MATRICES DIFFERRED ❌');
process.exit(allPass ? 0 : 1);

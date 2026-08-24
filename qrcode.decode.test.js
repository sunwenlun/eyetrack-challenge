// ===== qrcode.decode.test.js =====
/**
 * Real scannability check: rasterizes matrices from our encoder and decodes
 * them with jsQR. A correct QR Code must decode back to the original text.
 */
const path = require('path');
const QRCode = require(path.join(__dirname, 'qrcode.js'));
const jsQR = require('jsqr');

/**
 * Rasterizes a module matrix into an RGBA buffer a real decoder can read.
 * @param {boolean[][]} modules - modules[y][x], true = dark.
 * @param {number} scale - Pixels per module.
 * @param {number} quiet - Quiet-zone modules around the symbol.
 * @returns {{data:Uint8ClampedArray, size:number}}
 */
function rasterize(modules, scale, quiet) {
  const n = modules.length;
  const dim = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4);
  // start all white
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules[y][x]) continue;
      const px = (quiet + x) * scale;
      const py = (quiet + y) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = ((py + dy) * dim + (px + dx)) * 4;
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
        }
      }
    }
  }
  return { data, size: dim };
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
  ['https://eyetrack.fun', 'M'],
  ['a'.repeat(40), 'L'],
  ['https://eyetrack.fun?daily=2026-07-26', 'Q']
];

let allPass = true;
for (const [text, ecl] of cases) {
  const qr = QRCode.generate(text, { ecLevel: ecl });
  const { data, size } = rasterize(qr.modules, 8, 4);
  const decoded = jsQR(data, size, size);
  const ok = decoded && decoded.data === text;
  if (!ok) allPass = false;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  "${text}" ${ecl}  v${qr.version} mask${qr.mask} -> ` +
    (decoded ? JSON.stringify(decoded.data) : 'null')
  );
}
console.log(allPass ? '\nALL QR CODES DECODE CORRECTLY ✅' : '\nSOME QR CODES FAILED DECODE ❌');
process.exit(allPass ? 0 : 1);

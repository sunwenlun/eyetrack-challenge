// ===== share.js =====
/**
 * EyeTrack Challenge — Share / Viral Hook Layer
 *
 * Generates a 1080x1920 result card after a failed run, exports it as a
 * PNG (Web Share API on mobile, download fallback on desktop), and copies
 * a ready-to-paste share text to the clipboard.
 *
 * Requires config.js to be loaded first (reads window.CONFIG.SHARE).
 */

if (typeof window === 'undefined' || !window.CONFIG || !window.CONFIG.SHARE) {
  throw new Error('[share.js] config.js must be loaded before share.js');
}

/**
 * @typedef {Object} ShareResult
 * @property {number} level    - Level the player reached.
 * @property {number} accuracy - Accuracy (0-100, or 0-1 fraction).
 * @property {boolean} [isDaily=false] - Whether this was the daily challenge.
 */

const ShareManager = {
  /**
   * Normalizes accuracy to a rounded 0-100 integer.
   * Accepts either percent (73) or fraction (0.73) input.
   * @param {number} accuracy
   * @returns {number} Integer percent in [0, 100].
   */
  _normalizeAccuracy(accuracy) {
    let acc = Number(accuracy) || 0;
    if (acc > 0 && acc <= 1) acc *= 100;
    acc = Math.round(acc);
    return Math.max(0, Math.min(100, acc));
  },

  /**
   * Word-wraps text to fit a max pixel width.
   * @param {CanvasRenderingContext2D} ctx - Context with the target font already set.
   * @param {string} text - Text to wrap.
   * @param {number} maxWidth - Max line width in px.
   * @returns {string[]} Array of lines.
   */
  _wrapText(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  /**
   * Traces a rounded-rectangle path (does not fill/stroke).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left edge.
   * @param {number} y - Top edge.
   * @param {number} w - Width.
   * @param {number} h - Height.
   * @param {number} r - Corner radius.
   * @returns {void}
   */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  /**
   * Renders the shareable result card onto an off-screen canvas.
   * Layout is tuned for the 1080x1920 portrait story format.
   * @param {ShareResult} result
   * @returns {HTMLCanvasElement} The rendered card.
   */
  generateResultCard({ level, accuracy, isDaily = false }) {
    const { cardWidth: W, cardHeight: H, cardBgGradient, failCaptions, shareUrl } =
      window.CONFIG.SHARE;

    // cardBgGradient is absent from the current config.js — fall back to
    // purple-theme shades so the card never crashes.
    const bgGrad = cardBgGradient || ['#0f0c29', '#241b4d'];

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

    // --- background gradient ---
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, bgGrad[0]);
    grad.addColorStop(1, bgGrad[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // --- decorative translucent balls ---
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = window.CONFIG.GAME.ballColor;
    const deco = [
      [140, 300, 90], [950, 200, 70], [880, 1150, 110],
      [160, 1300, 80], [540, 620, 140],
    ];
    for (const [x, y, r] of deco) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- game title (neon blue glow) ---
    ctx.save();
    ctx.fillStyle = '#4FC3F7';
    ctx.shadowColor = '#4FC3F7';
    ctx.shadowBlur = 36;
    ctx.font = `900 108px ${FONT}`;
    ctx.fillText('EYE TRACK', W / 2, 250);
    ctx.fillText('CHALLENGE', W / 2, 370);
    ctx.restore();

    // --- result line ---
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 100px ${FONT}`;
    ctx.fillText(isDaily ? 'Daily Challenge' : `Level ${level}`, W / 2, 620);
    if (isDaily) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `700 56px ${FONT}`;
      ctx.fillText(`Level ${level}`, W / 2, 720);
    }

    // --- random self-deprecating caption ---
    const caption = failCaptions[Math.floor(Math.random() * failCaptions.length)];
    ctx.fillStyle = window.CONFIG.GAME.highlightColor; // '#FFD54F'
    ctx.font = `italic 700 54px ${FONT}`;
    const captionTop = isDaily ? 850 : 800;
    this._wrapText(ctx, caption, W - 200).forEach((line, i) => {
      ctx.fillText(line, W / 2, captionTop + i * 70);
    });

    // --- accuracy ---
    const acc = this._normalizeAccuracy(accuracy);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 76px ${FONT}`;
    ctx.fillText(`Accuracy: ${acc}%`, W / 2, 1080);

    // --- hook line ---
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = `600 44px ${FONT}`;
    ctx.fillText('Think you can beat me?', W / 2, 1240);

    // --- QR code (real, scannable) ---
    const qrSize = 320;
    const qrX = (W - qrSize) / 2;
    const qrY = 1320;
    ctx.save();
    // White rounded card so the QR reads cleanly on the dark background.
    ctx.fillStyle = '#FFFFFF';
    this._roundRect(ctx, qrX, qrY, qrSize, qrSize, 28);
    ctx.fill();

    let qrDrawn = false;
    try {
      // QRCode is defined in qrcode.js (loaded before share.js).
      if (typeof QRCode !== 'undefined') {
        const qr = QRCode.generate(shareUrl, { ecLevel: 'M' });
        const N = qr.size;
        const quiet = 4; // standard quiet zone (4 modules)
        const total = N + quiet * 2;
        const px = qrSize / total;
        const off = quiet * px;
        ctx.fillStyle = '#0a0a0a'; // near-black modules for max contrast
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (qr.modules[r][c]) {
              ctx.fillRect(qrX + off + c * px, qrY + off + r * px, Math.ceil(px), Math.ceil(px));
            }
          }
        }
        qrDrawn = true;
      }
    } catch (e) {
      console.warn('[share] QR generation failed, using placeholder', e);
    }

    // Fallback if the QR generator is unavailable or throws.
    if (!qrDrawn) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 5;
      ctx.setLineDash([18, 14]);
      this._roundRect(ctx, qrX + 24, qrY + 24, qrSize - 48, qrSize - 48, 16);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.font = `600 34px ${FONT}`;
      ctx.fillText('QR', W / 2, qrY + qrSize / 2);
    }
    ctx.restore();

    // --- scan caption ---
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `600 40px ${FONT}`;
    ctx.fillText('Scan to play', W / 2, qrY + qrSize + 70);

    // --- short link ---
    ctx.fillStyle = '#4FC3F7';
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText(shareUrl.replace(/^https?:\/\//, ''), W / 2, 1790);

    return canvas;
  },

  /**
   * Exports the card as a PNG. Prefers the native share sheet on mobile
   * (Web Share API with files); falls back to a classic <a download>.
   * @param {HTMLCanvasElement} canvas - Card from generateResultCard().
   * @returns {Promise<string>} Resolves with the PNG data URL.
   */
  async exportAsImage(canvas) {
    const dataUrl = canvas.toDataURL('image/png');

    // Preferred path on mobile: native share sheet with the image file.
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob && typeof File !== 'undefined' && navigator.canShare) {
        const file = new File([blob], 'eyetrack-result.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'EyeTrack Challenge',
            text: 'Think you can beat me?',
          });
          return dataUrl;
        }
      }
    } catch (err) {
      // User dismissed the share sheet — don't punish them with a download.
      if (err && err.name === 'AbortError') return dataUrl;
    }

    // Fallback: classic download via a temporary anchor.
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'eyetrack-result.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return dataUrl;
  },

  /**
   * Copies a ready-to-paste share text to the clipboard.
   * @param {ShareResult} result
   * @returns {Promise<void>} Resolves when the text is on the clipboard.
   */
  copyShareText({ level, accuracy, isDaily = false }) {
    const acc = this._normalizeAccuracy(accuracy);
    const firstLine = isDaily
      ? `I scored Level ${level} on today's EyeTrack Challenge Daily! 🔥`
      : `I reached Level ${level} on EyeTrack Challenge! 🔥`;
    const text =
      `${firstLine}\n` +
      `My accuracy: ${acc}%\n` +
      `Think you can beat me? 👇\n` +
      `${window.CONFIG.SHARE.shareUrl}`;

    // Modern path: async clipboard API (requires secure context).
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }

    // Legacy fallback: hidden textarea + execCommand('copy').
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) {
        document.body.removeChild(ta);
        reject(err);
      }
    });
  },

  /**
   * Three-layer share fallback: native share sheet (mobile) → PNG download.
   * Cancelling the native sheet is respected (no surprise download).
   * @param {ShareResult} cardData
   * @returns {Promise<{method: string, success: boolean}>} How it was shared:
   *   'native-share' | 'download' | 'cancelled'.
   */
  async shareWithFallback(cardData) {
    const canvas = this.generateResultCard(cardData);

    // Layer 1: Web Share API with the card as a file (iOS/Android sheet).
    if (navigator.share && navigator.canShare) {
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        const file = new File([blob], 'eyetrack-result.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'EyeTrack Challenge',
            text: `I reached Level ${cardData.level}! Think you can beat me?`,
            files: [file],
          });
          return { method: 'native-share', success: true };
        }
      } catch (e) {
        // User dismissed the sheet — do NOT fall through to a download.
        if (e && e.name === 'AbortError') {
          return { method: 'cancelled', success: false };
        }
        console.log('[share] native share failed', e);
      }
    }

    // Layer 2: classic PNG download.
    this.exportAsImage(canvas);
    return { method: 'download', success: true };
  },

  /**
   * Builds the short-link share text (for clipboard / manual posting).
   * @param {ShareResult} cardData
   * @returns {string} Multi-line share text.
   */
  getShareText(cardData) {
    const acc = cardData.accuracy || 0;
    const lines = [
      `🧠 EyeTrack Challenge`,
      cardData.isDaily ? `📅 Daily Challenge` : `Level ${cardData.level}`,
      `Accuracy: ${acc}%`,
      ``,
      `Think you can beat me? 👇`,
      `https://eyetrack.fun`,
    ];
    return lines.join('\n');
  },
};

// Expose for classic <script> consumers.
if (typeof window !== 'undefined') {
  window.ShareManager = ShareManager;
}

// Expose for Node / bundler consumers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ShareManager;
}

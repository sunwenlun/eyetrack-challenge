// ===== platforms/wechat.js =====
/**
 * WeChat Mini Game platform adapter for EyeTrack Challenge.
 *
 * Implements the platform interface consumed by minigame-host.js so the core
 * engine (game.js) runs unchanged inside the wx runtime. Every browser/DOM
 * API the web build uses is replaced here with a wx.* equivalent. No other
 * file in this project touches `wx`.
 *
 * Imported by: game.wechat.js (mini-game entry) -> minigame-host.js.boot(this)
 *
 * NOTE: GA4 is intentionally NOT used here — Google services are blocked /
 * unreliable in mainland China. Use wx.reportAnalytics (custom analysis,
 * configured in the MP backend) or the WeChat Mini Game dashboard instead.
 */
const wx = (typeof wx !== 'undefined') ? wx : null;

const WECHAT = {
  name: 'wechat',

  /** Main (display) canvas. First createCanvas() call returns the screen canvas. */
  createCanvas() {
    return wx.createCanvas();
  },

  /** 2D context — wx canvas supports getContext('2d'). */
  getContext(canvas) {
    return canvas.getContext('2d');
  },

  /** Screen size in CSS pixels + device pixel ratio. */
  getSystemInfo() {
    try {
      const info = wx.getSystemInfoSync();
      return {
        windowWidth: info.windowWidth,
        windowHeight: info.windowHeight,
        pixelRatio: info.pixelRatio || 1,
      };
    } catch (e) {
      return { windowWidth: 375, windowHeight: 667, pixelRatio: 1 };
    }
  },

  /**
   * Register a touch-start handler. handler({x, y}) receives CSS-pixel coords
   * (touch.clientX / clientY), already in the canvas coordinate space because
   * the canvas is sized to the full screen in CSS pixels.
   */
  onTouchStart(handler) {
    wx.onTouchStart((ev) => {
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      handler({ x: t.clientX, y: t.clientY });
    });
  },

  /**
   * Build a key/value store mirroring StorageManager's public API so the
   * engine's optional persistence works identically on wx storage.
   * Keys are namespaced with `et_` to avoid clashing with other mini-games.
   */
  makeStorageManager() {
    return {
      _read(key, fallback) {
        try {
          const raw = wx.getStorageSync(key);
          return (raw === '' || raw === null || raw === undefined) ? fallback : String(raw);
        } catch (e) { return fallback; }
      },
      _write(key, value) {
        try { wx.setStorageSync(key, value); return true; } catch (e) { return false; }
      },
      _today() {
        const now = new Date();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${now.getFullYear()}-${m}-${d}`;
      },
      getBestLevel() {
        const n = parseInt(this._read('et_best_level', '1'), 10);
        return Number.isFinite(n) && n >= 1 ? n : 1;
      },
      setBestLevel(level) {
        this._write('et_best_level', String(Math.max(1, Math.floor(Number(level) || 1))));
      },
      getDailyResult() {
        const raw = this._read('et_daily_result', null);
        if (!raw) return null;
        try {
          const p = JSON.parse(raw);
          if (p && Number.isFinite(p.level) && Number.isFinite(p.accuracy)) {
            return { level: p.level, accuracy: p.accuracy };
          }
        } catch (e) { /* ignore */ }
        return null;
      },
      setDailyResult(level, accuracy) {
        this._write('et_daily_result', JSON.stringify({ level: Number(level) || 0, accuracy: Number(accuracy) || 0 }));
        this._write('et_daily_date', this._today());
      },
      hasPlayedDailyToday() {
        return this._read('et_daily_date', null) === this._today();
      },
      getTotalPlays() {
        const n = parseInt(this._read('et_total_plays', '0'), 10);
        return Number.isFinite(n) && n >= 0 ? n : 0;
      },
      incrementTotalPlays() {
        const next = this.getTotalPlays() + 1;
        this._write('et_total_plays', String(next));
        return next;
      },
    };
  },

  /** Enable the top-right share menu and define the forwarding payload. */
  initShare(title) {
    try {
      wx.showShareMenu({ menus: ['shareAppMessage'] });
      wx.onShareAppMessage(() => ({
        title: title || 'EyeTrack — 盯住小球，挑战你的记忆力',
        imageUrl: '', // 可选：分享卡片图（需先上传到微信CDN），留空用默认截图
      }));
    } catch (e) { /* 分享不可用则忽略 */ }
  },

  /** Programmatically open the share sheet (e.g. from an in-canvas button). */
  shareNow(title) {
    try {
      if (typeof wx.shareAppMessage === 'function') {
        wx.shareAppMessage({ title: title || 'EyeTrack — 盯住小球，挑战你的记忆力', imageUrl: '' });
      }
    } catch (e) { /* 忽略 */ }
  },

  /** Custom analytics -> wx.reportAnalytics (事件需在 MP 后台「自定义分析」配置). */
  analytics(event, params) {
    try {
      if (typeof wx.reportAnalytics === 'function') wx.reportAnalytics(event, params || {});
    } catch (e) { /* 未配置则忽略 */ }
  },
};

if (typeof module !== 'undefined' && module.exports) module.exports = WECHAT;

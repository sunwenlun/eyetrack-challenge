// ===== storage.js =====
/**
 * EyeTrack Challenge — Persistence Layer
 *
 * Crash-safe wrapper around window.localStorage. Every read/write is
 * wrapped in try-catch so private / incognito mode never breaks the game.
 *
 * Requires config.js to be loaded first — all keys are read from
 * window.CONFIG.STORAGE_KEYS.
 */

if (typeof window === 'undefined' || !window.CONFIG || !window.CONFIG.STORAGE_KEYS) {
  throw new Error('[storage.js] config.js must be loaded before storage.js');
}

/** @type {Object.<string, string>} localStorage key map, sourced from config.js */
const STORAGE_KEYS = window.CONFIG.STORAGE_KEYS;

/**
 * @typedef {Object} DailyResult
 * @property {number} level    - Level reached in the daily challenge.
 * @property {number} accuracy - Accuracy in percent (0-100).
 */

const StorageManager = {
  /**
   * Safe read. Returns the fallback on a missing key OR any storage error.
   * @param {string} key - localStorage key.
   * @param {?string} fallback - Value returned when the key is absent or unreadable.
   * @returns {?string} Raw stored string, or fallback.
   */
  _read(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch (err) {
      return fallback;
    }
  },

  /**
   * Safe write. Never throws.
   * @param {string} key - localStorage key.
   * @param {string} value - Value to store.
   * @returns {boolean} true on success, false otherwise.
   */
  _write(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  },

  /**
   * Today's date string in 'YYYY-MM-DD' — same format as the daily seed,
   * so daily-challenge bookkeeping always matches config.js.
   * @returns {string}
   */
  _today() {
    if (
      window.CONFIG.DAILY_CHALLENGE &&
      typeof window.CONFIG.DAILY_CHALLENGE.getDailySeed === 'function'
    ) {
      return window.CONFIG.DAILY_CHALLENGE.getDailySeed();
    }
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  },

  /**
   * Best level ever reached.
   * @returns {number} Always >= 1; defaults to 1.
   */
  getBestLevel() {
    const n = parseInt(this._read(STORAGE_KEYS.bestLevel, '1'), 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  },

  /**
   * Persist the best level.
   * @param {number} level - Level to store (clamped to >= 1).
   * @returns {boolean} true on success.
   */
  setBestLevel(level) {
    const n = Math.max(1, Math.floor(Number(level) || 1));
    return this._write(STORAGE_KEYS.bestLevel, String(n));
  },

  /**
   * Daily-challenge result, or null if never played / data corrupted.
   * @returns {?DailyResult}
   */
  getDailyResult() {
    const raw = this._read(STORAGE_KEYS.dailyResult, null);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Number.isFinite(parsed.level) && Number.isFinite(parsed.accuracy)) {
        return { level: parsed.level, accuracy: parsed.accuracy };
      }
      return null;
    } catch (err) {
      return null;
    }
  },

  /**
   * Store the daily result and stamp today's date so
   * hasPlayedDailyToday() can lock the player out until tomorrow.
   * @param {number} level - Level reached.
   * @param {number} accuracy - Accuracy in percent (0-100).
   * @returns {boolean} true on success.
   */
  setDailyResult(level, accuracy) {
    const ok = this._write(
      STORAGE_KEYS.dailyResult,
      JSON.stringify({ level: Number(level) || 0, accuracy: Number(accuracy) || 0 })
    );
    this._write(STORAGE_KEYS.dailyDate, this._today());
    return ok;
  },

  /**
   * True if a daily result was already recorded today.
   * @returns {boolean}
   */
  hasPlayedDailyToday() {
    return this._read(STORAGE_KEYS.dailyDate, null) === this._today();
  },

  /**
   * Lifetime play count (all modes).
   * @returns {number} Always >= 0; defaults to 0.
   */
  getTotalPlays() {
    const n = parseInt(this._read(STORAGE_KEYS.totalPlays, '0'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  },

  /**
   * Increment the lifetime play count by 1.
   * @returns {number} The new total.
   */
  incrementTotalPlays() {
    const next = this.getTotalPlays() + 1;
    this._write(STORAGE_KEYS.totalPlays, String(next));
    return next;
  },
};

// Expose for classic <script> consumers.
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}

// Expose for Node / bundler consumers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}

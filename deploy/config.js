// ===== config.js — 与现有 game.js / storage.js / share.js / levels.js 完全兼容 =====

const CONFIG = {
  GAME: {
    ballRadius: 22,
    // === FIX: 3D ball + centered numbers ===
    ballColor:      '#C8A2E8',  // 薰衣草紫（球体主色）
    ballColorLight: '#E8D5F5',  // 亮部（高光渐变用）
    ballColorDark:  '#9B6FC7',  // 暗部（边缘渐变用）
    numberTextColor:'#3E1F6D',  // 球内数字颜色（深紫）
    highlightColor: '#FF1744',   // 鲜红（保留字段）
    targetRingColor: '#FF1744',  // 初始高亮目标圈颜色（鲜红）
    correctColor: '#66BB6A',
    wrongColor: '#EF5350',
    bgColor: '#F5F5F5',        // 浅灰白兜底底色（transparentBg=true 时不用；若关闭透明则填此浅色，永不出现深色）
    transparentBg: true,       // 浅色主题：canvas 透明清屏，透出容器背景与大脑
    boardInk: '#4A148C',       // 棋盘内提示文字/数字编号颜色（浅色棋盘用深紫）
    targetCount: 3,
    phaseShowDuration: 2000,
    phaseTransitionDuration: 500,
    phaseMoveDuration: 3000
  },

  DAILY_CHALLENGE: {
    enabled: true,
    getDailySeed: function () {
      var d = new Date();
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    },
    seededRandom: function (seed) {
      var str = String(seed);
      var h = 2166136261 >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      var state = h >>> 0;
      return function () {
        state = (state + 0x6D2B79F5) >>> 0;
        var t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  },

  SHARE: {
    cardWidth: 1080,
    cardHeight: 1920,
    failCaptions: [
      "My eyes gave up at Level 6 🤡",
      "I have the attention span of a goldfish 🐠",
      "Brain said left, eyes went right 💀",
      "Level 8? More like Level 🤡",
      "My eyeballs filed for divorce",
      "I tracked exactly zero balls. Send help.",
      "The balls were moving? Since when?",
      "My cat could do better and she's blind",
      "Ophthalmologist appointment booked 📞",
      "Skill issue. Definitely a skill issue."
    ],
    shareUrl: 'https://eyetrack.fun'
  },

  STORAGE_KEYS: {
    bestLevel: 'etc_best_level',
    dailyResult: 'etc_daily_result',
    dailyDate: 'etc_daily_date',
    totalPlays: 'etc_total_plays'
  },

  SOUNDS: {
    highlight: [880],
    correct: [523.25, 659.25],
    wrong: [220, 110],
    levelComplete: [523.25, 659.25, 783.99]
  }
};

// 暴露给浏览器全局
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

// Node / bundler 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
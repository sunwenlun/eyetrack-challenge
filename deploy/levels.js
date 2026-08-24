// ===== levels.js — V2 Full Release（30 关 + 无限模式 + 干扰物配置） =====
// === V2 Full Release ===

(function () {
  'use strict';

  // ---------- 依赖获取 ----------
  var _CFG = null;
  function _getConfig() {
    if (_CFG) return _CFG;
    if (typeof window !== 'undefined' && window.CONFIG) _CFG = window.CONFIG;
    else if (typeof globalThis !== 'undefined' && globalThis.CONFIG) _CFG = globalThis.CONFIG;
    return _CFG;
  }

  // ---------- 关卡表 ----------
  // 字段说明：
  //   trajType     'wallbounce'（直线前进 + 垂直 S 摆动 + 撞墙选最均衡方向）
  //   freqRange    摆动频率随机增量（基础 × 0.5~1.0，单位 Hz）
  //   ampRange     摆动幅度随机增量（基础 15 + rng * ampRange，单位 px）
  //   noiseAmount  保留字段（当前未使用，保持兼容）
  //   noiseSpeed   保留字段（当前未使用，保持兼容）
  //   distractions 干扰物数组（=== Distraction Overhaul V2 ===）：
  //                { type:'brain'|'star'|'earth', opacity, speedMult(相对球速倍数),
  //                  color, rotation?, sizeMult? } — 由 game.js 渲染为全场无规则
  //                游荡的低透明度形状。speedMult 每关 +0.1：L16=1.2 → L30=2.6，
  //                L31+ 封顶 2.6（getLevelConfig 返回 L30 副本已天然处理）。
  // === V2 Full Release ===
  // L1-L15：沿用上一版定稿的 wallbounce 速度曲线（speed 1.8→3.2；原 swim 的
  // 0.8–2.4 对直线撞墙太慢会“饿死”，已在上一版验证并抬高）。无干扰物。
  // L16-20：+ 大脑阴影 | L21-25：+ 五角星 | L26-30：+ 地球（三重干扰）。
  // L16-30 球参数取 L15 封顶值（12 球 / speed 3.2 / duration 6000），难度递进全靠干扰物。
  var LEVELS = [
    { level: 1,  ballCount: 8,  speed: 1.8,  duration: 4200,  trajType: 'wallbounce', freqRange: 0.4,  ampRange: 40, noiseAmount: 0,  noiseSpeed: 0,    distractions: [] }
  , { level: 2,  ballCount: 8,  speed: 1.9,  duration: 4200,  trajType: 'wallbounce', freqRange: 0.4,  ampRange: 42, noiseAmount: 0,  noiseSpeed: 0,    distractions: [] }
  , { level: 3,  ballCount: 8,  speed: 2.0,  duration: 4400,  trajType: 'wallbounce', freqRange: 0.45, ampRange: 44, noiseAmount: 2,  noiseSpeed: 0.2,  distractions: [] }
  , { level: 4,  ballCount: 8,  speed: 2.1,  duration: 4600,  trajType: 'wallbounce', freqRange: 0.45, ampRange: 46, noiseAmount: 3,  noiseSpeed: 0.25, distractions: [] }
  , { level: 5,  ballCount: 9,  speed: 2.2,  duration: 4800,  trajType: 'wallbounce', freqRange: 0.5,  ampRange: 48, noiseAmount: 4,  noiseSpeed: 0.3,  distractions: [] }
  , { level: 6,  ballCount: 9,  speed: 2.3,  duration: 5000,  trajType: 'wallbounce', freqRange: 0.5,  ampRange: 50, noiseAmount: 5,  noiseSpeed: 0.35, distractions: [] }
  , { level: 7,  ballCount: 9,  speed: 2.4,  duration: 5200,  trajType: 'wallbounce', freqRange: 0.55, ampRange: 52, noiseAmount: 8,  noiseSpeed: 0.4,  distractions: [] }
  , { level: 8,  ballCount: 10, speed: 2.5,  duration: 5200,  trajType: 'wallbounce', freqRange: 0.55, ampRange: 54, noiseAmount: 10, noiseSpeed: 0.45, distractions: [] }
  , { level: 9,  ballCount: 10, speed: 2.6,  duration: 5400,  trajType: 'wallbounce', freqRange: 0.6,  ampRange: 56, noiseAmount: 12, noiseSpeed: 0.5,  distractions: [] }
  , { level: 10, ballCount: 10, speed: 2.7,  duration: 5400,  trajType: 'wallbounce', freqRange: 0.6,  ampRange: 58, noiseAmount: 15, noiseSpeed: 0.6,  distractions: [] }
  , { level: 11, ballCount: 10, speed: 2.8,  duration: 5600,  trajType: 'wallbounce', freqRange: 0.65, ampRange: 60, noiseAmount: 18, noiseSpeed: 0.7,  distractions: [] }
  , { level: 12, ballCount: 10, speed: 2.9,  duration: 5600,  trajType: 'wallbounce', freqRange: 0.65, ampRange: 62, noiseAmount: 20, noiseSpeed: 0.8,  distractions: [] }
  , { level: 13, ballCount: 12, speed: 3.0,  duration: 5800,  trajType: 'wallbounce', freqRange: 0.7,  ampRange: 64, noiseAmount: 25, noiseSpeed: 1.0,  distractions: [] }
  , { level: 14, ballCount: 12, speed: 3.1,  duration: 5800,  trajType: 'wallbounce', freqRange: 0.7,  ampRange: 66, noiseAmount: 30, noiseSpeed: 1.2,  distractions: [] }
  , { level: 15, ballCount: 12, speed: 3.2,  duration: 6000,  trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5,  distractions: [] }

  // === Distraction Overhaul V2 === L16-20: Brain shadow（speedMult 1.2→1.6）
  , { level: 16, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.15, speedMult: 1.2, color: '#2D2040' }] }
  , { level: 17, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.15, speedMult: 1.3, color: '#2D2040' }] }
  , { level: 18, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.15, speedMult: 1.4, color: '#2D2040' }] }
  , { level: 19, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.15, speedMult: 1.5, color: '#2D2040' }] }
  , { level: 20, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.15, speedMult: 1.6, color: '#2D2040' }] }

  // === Distraction Overhaul V2 === L21-25: Brain + Star（speedMult 1.7→2.1）
  , { level: 21, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 1.7, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 1.7, color: '#FFD54F', rotation: true, sizeMult: 1.5 }] }
  , { level: 22, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 1.8, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 1.8, color: '#FFD54F', rotation: true, sizeMult: 1.5 }] }
  , { level: 23, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 1.9, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 1.9, color: '#FFD54F', rotation: true, sizeMult: 1.5 }] }
  , { level: 24, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.0, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.0, color: '#FFD54F', rotation: true, sizeMult: 1.5 }] }
  , { level: 25, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.1, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.1, color: '#FFD54F', rotation: true, sizeMult: 1.5 }] }

  // === Distraction Overhaul V2 === L26-30: Brain + Star + Earth（speedMult 2.2→2.6）
  , { level: 26, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.2, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.2, color: '#FFD54F', rotation: true, sizeMult: 1.5 }, { type: 'earth', opacity: 0.18, speedMult: 2.2, color: '#1565C0', sizeMult: 1.5 }] }
  , { level: 27, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.3, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.3, color: '#FFD54F', rotation: true, sizeMult: 1.5 }, { type: 'earth', opacity: 0.18, speedMult: 2.3, color: '#1565C0', sizeMult: 1.5 }] }
  , { level: 28, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.4, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.4, color: '#FFD54F', rotation: true, sizeMult: 1.5 }, { type: 'earth', opacity: 0.18, speedMult: 2.4, color: '#1565C0', sizeMult: 1.5 }] }
  , { level: 29, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.5, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.5, color: '#FFD54F', rotation: true, sizeMult: 1.5 }, { type: 'earth', opacity: 0.18, speedMult: 2.5, color: '#1565C0', sizeMult: 1.5 }] }
  , { level: 30, ballCount: 12, speed: 3.2, duration: 6000, trajType: 'wallbounce', freqRange: 0.75, ampRange: 68, noiseAmount: 35, noiseSpeed: 1.5, distractions: [{ type: 'brain', opacity: 0.12, speedMult: 2.6, color: '#2D2040' }, { type: 'star', opacity: 0.15, speedMult: 2.6, color: '#FFD54F', rotation: true, sizeMult: 1.5 }, { type: 'earth', opacity: 0.18, speedMult: 2.6, color: '#1565C0', sizeMult: 1.5 }] }
  ];

  // ---------- 工具 ----------
  function _shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /** Shallow-copies a level row into a fresh config object. */
  function _copyRow(row) {
    return {
      level: row.level,
      ballCount: row.ballCount,
      speed: row.speed,
      duration: row.duration,
      trajType: row.trajType,
      freqRange: row.freqRange,
      ampRange: row.ampRange,
      noiseAmount: row.noiseAmount,
      noiseSpeed: row.noiseSpeed,
      // 数组也拷贝一份：调用方（game.js/无限模式）拿到的配置与 LEVELS 原表解耦，
      // 任何运行时修改都不会污染全局关卡表。
      distractions: (row.distractions || []).slice()
    };
  }

  // ---------- 公开接口 ----------
  /**
   * === V2 Full Release === 无限模式：
   * levelNum > 30 时返回 L30 配置副本（参数封顶），但 level 编号继续递增，
   * 使 L31、L32… 无限进行；关卡号在 HUD / 分享卡 / 排行榜中照常显示。
   */
  function getLevelConfig(levelNumber) {
    var n = Math.max(1, levelNumber | 0);
    if (n > 30) {
      var cfg = _copyRow(LEVELS[29]); // L30 是 index 29
      cfg.level = n;                  // level 编号递增，参数封顶
      return cfg;
    }
    return _copyRow(LEVELS[n - 1]);
  }

  function pickTargets(ballCount, rng) {
    var total = Math.max(1, Math.floor(Number(ballCount) || 1));
    var cfg = _getConfig();
    var required = (cfg && cfg.GAME && cfg.GAME.targetCount) || 3;
    if (total < required) {
      console.error('[levels.js] ballCount (' + total + ') < targetCount (' + required + ')');
    }
    var arr = [];
    for (var i = 0; i < total; i++) arr.push(i);
    var useRng = (typeof rng === 'function') ? rng : Math.random;
    _shuffle(arr, useRng);
    return arr.slice(0, Math.min(required, total));
  }

  /**
   * === Daily starts at L16 === 每日挑战固定从 L16 开始。
   * seed = 'YYYY-MM-DD-L16'（日期 + 起始关卡），保证同一天全球玩家拿到
   * 完全一致的关卡与目标布局。seededRandom 与 mulberry32 等价（已有，复用）。
   */
  function generateDailyLevel() {
    var cfg = _getConfig();
    if (!cfg) throw new Error('[levels.js] CONFIG not loaded');
    var seed = cfg.DAILY_CHALLENGE.getDailySeed() + '-L16'; // === Daily starts at L16 ===
    var rng = cfg.DAILY_CHALLENGE.seededRandom(seed);
    var base = getLevelConfig(16); // === Daily starts at L16 ===
    var targets = pickTargets(base.ballCount, rng);
    base.seed = seed;
    base.targets = targets;
    return base;
  }

  // ---------- 暴露 ----------
  var Levels = {
    getLevelConfig: getLevelConfig,
    pickTargets: pickTargets,
    generateDailyLevel: generateDailyLevel
  };

  if (typeof window !== 'undefined') window.Levels = Levels;
  if (typeof module !== 'undefined' && module.exports) module.exports = Levels;

})();

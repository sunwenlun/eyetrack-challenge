// ===== game.js — Phase 1 + 2 =====
// === V2 Full Release ===
/**
 * EyeTrack — Core Game Engine (V2 Full Release)
 *
 * V2: 30 campaign levels + infinite mode (params cap at L30, level number
 * keeps climbing), daily challenge fixed at L16 with seed 'YYYY-MM-DD-L16',
 * all player-facing copy in English.
 * === Distraction Overhaul V2 === distraction sprites (canvas brain / star /
 * earth from L16 up) wander the whole board erratically at low opacity,
 * moving at ball-speed x speedMult (1.2x at L16 → 2.6x at L30, capped after).
 *
 * Phase 1: state machine + Ball objects + movement system + render loop.
 * Phase 2: pointer input + result evaluation + Web Audio sound effects.
 * Unified wall-bounce motion: every ball travels in a straight line with a
 * perpendicular sine sway, bounces off walls (picking the least-used wall
 * direction so all four edges stay populated), and never overlaps another
 * ball. Three game modes (campaign / practice / daily) share this exact
 * motion — only the mode logic differs. No two balls overlap because a hard
 * positional-correction pass runs every frame and pushes any overlapping
 * pair exactly to 2*radius apart. A soft Boids separation steers them apart
 * gently during approach so the hard pass is rarely triggered and motion
 * stays smooth. DOM event binding lives in the UI layer (index.html).
 *
 * Requires: config.js (window.CONFIG), levels.js (window.Levels).
 * Optional: storage.js (window.StorageManager) — persistence is skipped
 * silently in headless environments. share.js is driven by the UI layer
 * via the onLevelComplete / onGameOver callbacks.
 *
 * Exposes window.GameEngine (the class, with .PHASE / .Ball attached as
 * statics so the UI layer can compare phases) and module.exports in Node.
 */

/* ------------------------------------------------------------------------ */
/* Dependency resolution (browser window / globalThis / Node require)       */
/* ------------------------------------------------------------------------ */

/**
 * Resolves a shared module in any environment.
 * @param {string} name - Global name, e.g. 'CONFIG'.
 * @param {string} requirePath - Node fallback path, e.g. './config.js'.
 * @returns {?object} The module, or null when unavailable.
 * @private
 */
function _getGlobal(name, requirePath) {
  if (typeof window !== 'undefined' && window[name]) return window[name];
  if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
  try {
    if (typeof require !== 'undefined') return require(requirePath);
  } catch (err) {
    /* handled by the guards below */
  }
  return null;
}

const _CFG = _getGlobal('CONFIG', './config.js');
const _Levels = _getGlobal('Levels', './levels.js');
if (!_CFG || !_CFG.GAME) {
  throw new Error('[game.js] config.js must be loaded before game.js');
}
if (!_Levels) {
  throw new Error('[game.js] levels.js must be loaded before game.js');
}

// === Phase 2 additions ===
// Optional: persistence. storage.js needs a real window.localStorage, so in
// headless (Node) environments this resolves to null and calls are skipped.
const _Storage = _getGlobal('StorageManager', './storage.js');

/* ------------------------------------------------------------------------ */
/* Phase state enum                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Game phases. The engine is a strict state machine — update() dispatches
 * on this value and only one phase handler runs per frame.
 * @readonly
 * @enum {number}
 */
const PHASE = {
  IDLE: 0,        // waiting to start
  SHOW: 1,        // highlight target balls (phaseShowDuration ms)
  TRANSITION: 2,  // unify appearance (phaseTransitionDuration ms)
  MOVE: 3,        // balls move (levelConfig.duration ms)
  STOP: 4,        // balls frozen, number labels shown, awaiting input
  INPUT: 5,       // player clicks balls one by one — Phase 2
  RESULT: 6,      // scoring / verdict — Phase 2
};

/* ------------------------------------------------------------------------ */
/* Ball                                                                     */
/* ------------------------------------------------------------------------ */

class Ball {
  /**
   * @param {number} index - Ball index, 0..N-1.
   * @param {number} x - Initial center x (px).
   * @param {number} y - Initial center y (px).
   * @param {number} radius - Ball radius (px).
   * @param {boolean} isTarget - Whether the player must track this ball.
   */
  constructor(index, x, y, radius, isTarget) {
    this.index = index;       // ball index 0..N-1
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.isTarget = isTarget;
    this.numberLabel = null;  // assigned when entering STOP
    this.vx = 0;              // last-frame displacement X (px)
    this.vy = 0;              // last-frame displacement Y (px)
    this.highlightTimer = 0;  // SHOW-phase blink countdown (targets only)
    this.selectedState = 0;   // 0=unpicked, 1=correct ring, 2=wrong ring (Phase 2)
    this.speed = 1;           // level base speed — set by initBalls

    // === Practice Mode + Unified Wallbounce === 默认 swim（initBalls 会按关卡
    // trajType 覆盖为 wallbounce）；保留字段供 swim 降级分支使用。
    this.trajType = 'swim';   // 默认；实际由 initBalls 按关卡覆盖（当前全 wallbounce）
    this.targetX = x;         // 当前漫游目标点 X
    this.targetY = y;         // 当前漫游目标点 Y
    this.cx = x;              // MOT 漫游目标点 X（角度转向用）
    this.cy = y;              // MOT 漫游目标点 Y
    this.stay = 0;            // MOT 目标点停留倒计时 (s)
    this.baseSpeed = 1;       // 前进基础速度
    this.swimAmp = 0;         // 垂直摆动幅度 (px)
    this.swimFreq = 0;        // 摆动频率 (Hz)
    this.swimPhase = 0;       // 摆动相位
    this.swimTime = 0;        // 摆动时间累加 (s)
    this.angle = 0;           // 当前朝向角 (rad)
    this.turnRate = 0.04;     // 每帧单位最大转向角 (rad)，保证平滑不急转
    this.targetReachDist = 0; // 接近目标多少 px 时换目标
    this.separateX = 0;       // 软分离累积位移 X
    this.separateY = 0;       // 软分离累积位移 Y

    // === MOT 轨迹（增强 swim）=== 每球独立速度 + 温和周期爆发
    this.speedFactor = 1;    // 速度系数（MOT：0.85~1.15）
    this.burst = 0;          // 当前爆发剩余时长 (s)
    this.burstT = 0;         // 下次爆发倒计时 (s)
  }
}

/* ------------------------------------------------------------------------ */
/* GameEngine                                                               */
/* ------------------------------------------------------------------------ */

class GameEngine {
  /**
   * @param {HTMLCanvasElement} canvas - The canvas the game renders into.
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.phase = PHASE.IDLE;
    this.balls = [];
    this.levelConfig = null;
    this.currentLevel = 1;
    this.phaseTimer = 0;
    // === Practice Mode + Unified Wallbounce === 三种模式：campaign | practice | daily
    this.mode = 'campaign';
    // === Practice Difficulty Select === 练习难度与当前关号（由难度段随机选关）
    this.practiceDifficulty = 'easy'; // 'easy' | 'medium' | 'hard'
    this.practiceLevel = 1;           // 当前练习用的关卡编号
    // === V2 Full Release === 当前关卡的干扰物数组（brain / star / earth，
    // 低透明度横穿棋盘，L16+ 出现；SHOW 阶段就开始飘，增加记忆干扰）。
    this.distractions = [];
    // === Physics & Visual Upgrade ===
    this.selectedBalls = [];      // reserved for Phase 2
    this.isDailyChallenge = false;
    // === Level Clear Pause === 成功反馈瞬时状态（仅显示 / 防重入，非新状态机）
    this._levelClearActive = false; // 是否正在显示"Level Clear"文字
    this._levelClearToken = 0;      // 防止快速连点导致 setTimeout 回调错乱
    this._stepText = '';            // === Step Hints（目标二）=== 正式关卡顶部步骤文字
    this._renderStepOnCanvas = false; // 小游戏无 DOM：宿主置 true 改在 Canvas 内画步骤提示；web 用 DOM 条保持 false
    this.dailySeed = null;
    this.animationId = null;
    this.onPhaseChange = null;    // callback: (phase) => void, for the UI layer
    this.onLevelComplete = null;  // reserved for Phase 2
    this.onGameOver = null;       // reserved for Phase 2
    this._rng = Math.random;      // swapped for a seeded RNG in daily mode

    // === Phase 2 additions ===
    this.accuracyTracker = { hits: 0, misses: 0 }; // picks within the current level
    this._audioCtx = null;        // Web Audio context, lazily initialized

    // === 选中音效连击 === 连续选对/选错计数（跨局累计，到 3 重置循环）
    this._streakCorrect = 0;
    this._streakWrong = 0;
  }

  /* ------------------------------ public ------------------------------ */

  /**
   * Loads a level and enters the SHOW phase.
   * @param {number} levelNumber - 1-based level number (ignored for daily).
   * @param {boolean} [isDaily=false] - True to play today's seeded daily level.
   * @returns {void}
   */
  startLevel(levelNumber, isDaily = false) {
    // === Phase 2 additions ===
    // Unlock audio inside the user gesture that starts the level.
    this._initAudio();

    this.isDailyChallenge = Boolean(isDaily);

    // Daily levels come pre-seeded (level pick + targets); normal runs
    // resolve straight from the LEVELS table.
    this.levelConfig = this.isDailyChallenge
      ? _Levels.generateDailyLevel()
      : _Levels.getLevelConfig(levelNumber);

    this.currentLevel = this.levelConfig.level;
    // === GA4 Events === 关卡开始埋点（headless 下 gtag 未定义，跳过）
    if (typeof gtag !== 'undefined') {
      gtag('event', 'level_start', {
        level_name: 'Level ' + this.currentLevel,
        mode: this.mode,
        difficulty: (this.practiceDifficulty || 'N/A')
      });
    }
    this.dailySeed = this.isDailyChallenge ? this.levelConfig.seed : null;

    // Daily determinism: spawn positions, directions and sway must be
    // identical for every player on the same day, so the layout RNG is
    // seeded too (suffix '-balls' keeps it independent from the level-pick
    // stream inside Levels.generateDailyLevel).
    this._rng = this.isDailyChallenge
      ? _CFG.DAILY_CHALLENGE.seededRandom(`${this.dailySeed}-balls`)
      : Math.random;

    this.selectedBalls = [];
    this.resetAccuracy(); // === Phase 2 additions === accuracy is per-level
    this._streakCorrect = 0; this._streakWrong = 0; // 选中音效连击重置
    this.initBalls();
    this._initDistractions(); // === V2 Full Release === L16+ 干扰物

    // === Daily starts at L16 === Daily seed stability log (debug only).
    // Seed = 'YYYY-MM-DD-L16' (built in Levels.generateDailyLevel) — every
    // player worldwide gets the same board.
    if (this.isDailyChallenge) {
      console.log('%c[Daily Challenge]', 'color:#FF1744;font-weight:bold;', {
        seed: this.dailySeed,
        startingLevel: this.currentLevel,
        config: this.levelConfig
      });
    }

    this._setPhase(PHASE.SHOW, _CFG.GAME.phaseShowDuration);

    if (this.animationId === null) {
      this.start();
    }
  }

  /**
   * Sets the active game mode. All modes share identical ball motion
   * (wallbounce); only the mode logic differs.
   * @param {'campaign'|'practice'|'daily'} mode
   * @returns {void}
   */
  setMode(mode) {
    this.mode = mode;
  }

  // === Share Targets V2 === 支持分享链接直接进入 daily 指定关卡
  // 由 main.js 在 boot 阶段调用一次（避免放在 startLevel 内造成递归）
  handleUrlParams() {
    if (typeof window === 'undefined' || !window.location) return false;
    const params = new URLSearchParams(window.location.search);
    const urlSeed = params.get('seed');
    const urlMode = params.get('mode');
    if (urlSeed && urlMode === 'daily') {
      this.setMode('daily');
      this.dailySeed = urlSeed;
      // 从 "YYYY-MM-DD-L16" 提取关卡号
      const m = urlSeed.match(/-L(\d+)$/);
      const lvl = m ? parseInt(m[1], 10) : 16;
      this.startLevel(lvl, true);
      return true;
    }
    return false;
  }

  /**
   * === Practice Mode + Unified Wallbounce ===
   * Practice: no timer pressure, no game-over, wrong clicks don't end the
   * round, infinite retries, can exit any time. Reuses L1 params and loops
   * a fresh board each time a round is completed.
   * @returns {void}
   */
  /**
   * === Practice Difficulty Select ===
   * Sets the practice difficulty and randomly picks a starting level from
   * that difficulty's band (Easy 1-10, Medium 11-20, Hard 21-30).
   * @param {'easy'|'medium'|'hard'} difficulty
   * @returns {void}
   */
  setPracticeDifficulty(difficulty) {
    this.practiceDifficulty = difficulty;
    let minL, maxL;
    if (difficulty === 'easy')        { minL = 1;  maxL = 10; }
    else if (difficulty === 'medium') { minL = 11; maxL = 20; }
    else                              { minL = 21; maxL = 30; }
    // 用引擎当前 RNG（练习为 Math.random，非确定性即可）随机选关
    this.practiceLevel = minL + Math.floor(this._rng() * (maxL - minL + 1));
  }

  /**
   * === Practice Difficulty Select ===
   * Practice: no timer pressure, no game-over, wrong clicks don't end the
   * round, infinite retries, can exit any time. Loads a fresh board from the
   * currently selected difficulty band and loops a new board each time a
   * round is completed.
   * @returns {void}
   */
  startPractice() {
    this._initAudio(); // 在用户手势内解锁音频（与 startLevel 一致）
    this.setMode('practice');
    // === Practice Difficulty Select === 如果没选过难度，默认 easy
    if (!this.practiceDifficulty) this.practiceDifficulty = 'easy';
    // 从该难度段随机选一关
    this.setPracticeDifficulty(this.practiceDifficulty);
    // 加载该关配置
    this.levelConfig = _Levels.getLevelConfig(this.practiceLevel);
    this.currentLevel = this.practiceLevel;
    this._rng = Math.random; // 练习布局不要求确定性
    this.selectedBalls = [];
    this.resetAccuracy();     // 每局重置命中/失误统计
    this._streakCorrect = 0; this._streakWrong = 0; // 选中音效连击重置
    this.initBalls();         // 注意：引擎实际方法名为 initBalls（伪代码 _spawnBalls 不存在）
    this._initDistractions(); // 让该难度段的干扰物（brain/star/earth）真正显示
    // SHOW 用固定记忆时长（伪代码写 levelConfig.duration 会导致记忆阶段过长，已修正）
    this._setPhase(PHASE.SHOW, _CFG.GAME.phaseShowDuration);
    if (this.animationId === null) {
      this.start();
    }
  }

  /**
   * Creates all balls for the current levelConfig: random full-board spawn
   * plus per-ball procedural S-sway parameters (frequency / amplitude /
   * phase), all drawn from the layout RNG so daily boards are identical
   * worldwide. A hard overlap pass then guarantees no two balls start
   * overlapping (so there is no first-frame pop).
   * @returns {void}
   */
  initBalls() {
    const cfg = this.levelConfig;
    const { ballCount, speed } = cfg;
    const radius = _CFG.GAME.ballRadius;
    const rng = this._rng || Math.random;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Daily configs carry deterministic targets from generateDailyLevel();
    // normal runs pick fresh ones.
    const targets = Array.isArray(cfg.targets)
      ? cfg.targets
      : _Levels.pickTargets(ballCount);

    this.balls = [];
    for (let i = 0; i < ballCount; i++) {
      const ball = new Ball(i, 0, 0, radius, targets.includes(i));

      // === Practice Mode + Unified Wallbounce === 按关卡 trajType 设置运动模式
      // （当前所有关卡统一 wallbounce；保留 swim 分支以兼容潜在降级/扩展）。
      ball.trajType = cfg.trajType || 'wallbounce';

      switch (ball.trajType) {
        case 'wallbounce': {
          // === Wall-Bounce Balanced === 均匀分配初始方向（4 面墙配额 + Fisher-Yates 打乱）
          const margin = ball.radius + 5;

          // 起始位置：随机但不要太靠近墙
          ball.x = margin + rng() * Math.max(1, w - margin * 2);
          ball.y = margin + rng() * Math.max(1, h - margin * 2);

          // ---- 均匀分配初始方向 ----
          // 4 面墙：0=左, 1=右, 2=上, 3=下
          // 每面墙的配额 = floor(ballCount / 4)，多余的轮流分配
          const wallQueue = []; // 要分配给所有球的方向队列
          const baseQuota = Math.floor(ballCount / 4);
          const remainder = ballCount % 4;

          for (let wall = 0; wall < 4; wall++) {
            for (let q = 0; q < baseQuota; q++) {
              wallQueue.push(wall);
            }
          }
          // 多余的球轮流补到各面墙
          for (let r = 0; r < remainder; r++) {
            wallQueue.push(r);
          }
          // 打乱顺序（Fisher-Yates）
          for (let k = wallQueue.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            [wallQueue[k], wallQueue[j]] = [wallQueue[j], wallQueue[k]];
          }

          // 当前球取队列里的第 i 个方向
          const assignedWall = wallQueue[i];
          const angleMap = [180, 0, 270, 90]; // 左=180°, 右=0°, 上=270°, 下=90°
          ball.angle = angleMap[assignedWall] * Math.PI / 180;

          // 撞墙计数（用于长期均衡）
          ball.wallHitCount = [0, 0, 0, 0];

          ball.baseSpeed = speed;

          // S 形摆动参数
          ball.wobbleAmp = 15 + rng() * cfg.ampRange;
          ball.wobbleFreq = cfg.freqRange * (0.5 + rng() * 0.5);
          ball.wobblePhase = rng() * Math.PI * 2;
          ball.wobbleTime = 0;

          ball.vx = Math.cos(ball.angle) * speed;
          ball.vy = Math.sin(ball.angle) * speed;

          break;
        }
        case 'swim':
        default: {
          // === Swim Mode v3 (long-range) === 全场对角远距目标 + S 形摆动 + 软分离
          const margin = ball.radius + 20;

          // 初始位置随机全场
          ball.x = margin + rng() * Math.max(1, w - margin * 2);
          ball.y = margin + rng() * Math.max(1, h - margin * 2);

          // 初始目标点：必须在画布对角区域（至少距离当前位置 40% 画布宽/高）
          ball.targetX = margin + rng() * Math.max(1, w - margin * 2);
          ball.targetY = margin + rng() * Math.max(1, h - margin * 2);
          // 强制推到远处
          const minDistX = w * 0.4;
          const minDistY = h * 0.4;
          let attempts = 0;
          while (attempts < 10) {
            const dx = Math.abs(ball.targetX - ball.x);
            const dy = Math.abs(ball.targetY - ball.y);
            if (dx >= minDistX && dy >= minDistY) break;
            ball.targetX = margin + rng() * Math.max(1, w - margin * 2);
            ball.targetY = margin + rng() * Math.max(1, h - margin * 2);
            attempts++;
          }

          ball.baseSpeed = speed;
          ball.swimAmp = 15 + rng() * cfg.ampRange;
          ball.swimFreq = cfg.freqRange * (0.5 + rng() * 0.5);
          ball.swimPhase = rng() * Math.PI * 2;
          ball.swimTime = 0;
          ball.targetReachDist = ball.radius * 3;
          ball.separateX = 0;
          ball.separateY = 0;

          break;
        }
        case 'mot': {
          // === MOT 轨迹（移植自测试版 updateMOT，手感顺滑）===
          // 角度转向（turnRate 限制）→ 连续正弦弯曲 → 速度取角度方向。
          // 不做强软分离，只靠每帧 _resolveOverlaps 保证零重叠（参考测试版）。
          const margin = ball.radius + 20;

          ball.x = margin + rng() * Math.max(1, w - margin * 2);
          ball.y = margin + rng() * Math.max(1, h - margin * 2);

          // 漫游目标点（角度转向朝它走）
          ball.cx = margin + rng() * Math.max(1, w - margin * 2);
          ball.cy = margin + rng() * Math.max(1, h - margin * 2);

          ball.angle = rng() * Math.PI * 2;
          ball.turnRate = 2.4;
          ball.swimFreq = 0.5 + rng() * 0.9;     // 0.5~1.4
          ball.swimPhase = rng() * Math.PI * 2;
          ball.swimAmp = 20 + rng() * 50;         // 20~70
          ball.swimTime = 0;
          ball.stay = 1.2 + rng() * 1.4;          // 1.2~2.6s 后换目标
          ball.speedFactor = 0.85 + rng() * 0.3;  // 0.85~1.15 每球独立速度（制造错身，练前额叶/顶叶）
          ball.burst = 0;
          ball.burstT = 1.2 + rng() * 2;          // 错开首次爆发
          ball.baseSpeed = speed;
          ball.speedFactor = 0.85 + rng() * 0.3;  // 0.85~1.15 每球独立速度
          ball.burst = 0;
          ball.burstT = 1.5 + rng() * 2;          // 1.5~3.5s 后首次爆发

          break;
        }
      }

      if (ball.isTarget) {
        ball.highlightTimer = _CFG.GAME.phaseShowDuration;
      }
      this.balls.push(ball);
    }

    // 出生即做一次硬分离，避免随机初始位置重叠（也无首帧突跳）
    this._resolveOverlaps(radius, w, h);
  }

  /**
   * === Distraction Overhaul V2 ===
   * Builds the distraction sprites for the current level (L16+). Each one
   * wanders the WHOLE board erratically (random roaming targets) at low
   * opacity, moving at `ball speed x speedMult` so higher levels get faster
   * distractions (L16=1.2x → L30=2.6x, capped for L31+ via getLevelConfig).
   * Positions use Math.random on purpose: distractions are purely visual,
   * and consuming the seeded RNG here would shift the daily layout.
   * @returns {void}
   * @private
   */
  _initDistractions() {
    const cfg = this.levelConfig;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.distractions = [];
    if (cfg && cfg.distractions && cfg.distractions.length > 0) {
      for (const d of cfg.distractions) {
        const sizeMult = d.sizeMult || 1.5;
        const baseBallRadius = 22;                       // 标准球半径
        const visualSize = baseBallRadius * 2 * sizeMult; // 直径 = 半径×2×倍数
        this.distractions.push({
          type: d.type,
          opacity: d.opacity,
          speedMult: d.speedMult || 1.2, // 相对球速的倍数
          color: d.color,
          rotation: d.rotation || false,
          angle: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.04,

          // 当前位置：随机全场
          x: Math.random() * w,
          y: Math.random() * h,

          // 无规则游荡目标点
          targetX: Math.random() * w,
          targetY: Math.random() * h,
          wanderTimer: 0,
          wanderInterval: 60 + Math.floor(Math.random() * 120), // 60~180帧换目标

          visualSize: visualSize,
        });
      }
    }
  }

  /**
   * Advances the state machine. Dispatches on the current phase.
   * @param {number} dt - Elapsed milliseconds since the last frame.
   * @returns {void}
   */
  update(dt) {
    switch (this.phase) {
      case PHASE.SHOW:
        this._updateShow(dt);
        break;
      case PHASE.TRANSITION:
        this._updateTransition(dt);
        break;
      case PHASE.MOVE:
        this._updateMove(dt);
        break;
      case PHASE.STOP:
        this._updateStop(dt);
        break;
      case PHASE.INPUT:
        // Nothing per-frame: picks arrive via handlePointerDown().
        break;
      case PHASE.RESULT:
        // Terminal state until the UI layer starts the next level.
        break;
      default:
        break; // IDLE — nothing to update
    }
  }

  /**
   * Draws one frame: background, balls, number labels, phase overlay.
   * @returns {void}
   */
  render() {
    const { ctx, canvas } = this;

    // 1. clear — transparent when CONFIG.GAME.transparentBg is on, so the
    // container's light background and ghost brain show through the board;
    // otherwise fall back to the opaque bgColor fill.
    if (_CFG.GAME.transparentBg) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = _CFG.GAME.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 2. balls
    this._renderBalls();

    // 3. number labels once frozen (and during Phase 2 input)
    if (this.phase === PHASE.STOP || this.phase === PHASE.INPUT) {
      this._renderNumberLabels();
    }

    // 3.5 === V2 Full Release === distraction sprites — drawn AFTER the
    // balls (they float over the play field at low opacity) and BEFORE the
    // UI hint text so the overlay always stays readable.
    this._renderDistractions();

    // 4. phase hint text
    this._renderPhaseOverlay();

    // 4.5 === Level Clear Pause === 成功时居中淡入"✓ Level Clear"反馈（仅显示，1s 后消除）
    if (this._levelClearActive) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 30px "Nunito", Arial, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText('✓ Level Clear', canvas.width / 2, canvas.height / 2);
      ctx.fillStyle = '#2E7D32'; // 现有成功绿，深绿在浅底上清晰
      ctx.fillText('✓ Level Clear', canvas.width / 2, canvas.height / 2);
      ctx.restore();
    }
  }

  /**
   * Starts the requestAnimationFrame loop. No-op in headless (Node)
   * environments, where the caller drives update()/render() manually.
   * @returns {void}
   */
  start() {
    if (typeof requestAnimationFrame === 'undefined') return;
    if (this.animationId !== null) return; // already running

    let lastTime = performance.now();
    const loop = (now) => {
      // Clamp huge gaps (tab switch) so balls never tunnel through walls.
      const dt = Math.min(now - lastTime, 100);
      lastTime = now;
      this.update(dt);
      this.render();
      this.animationId = requestAnimationFrame(loop);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  /**
   * Stops the animation loop. Safe to call when already stopped.
   * @returns {void}
   */
  stop() {
    if (this.animationId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animationId);
    }
    this.animationId = null;
  }

  /**
   * === Step Hints（目标二）=== 设置正式关卡顶部的步骤提示文字。
   * 由 _setPhase 在 SHOW/MOVE/STOP/INPUT 阶段调用；演示弹窗的全局
   * showTopText('game') 也走此方法，二者共用同一落地逻辑。
   * @param {string} text - 提示文字；空串或 null 表示清除。
   * @returns {void}
   */
  setStepText(text) {
    this._stepText = (text == null) ? '' : String(text);
  }

  /* ==================== Phase 2 additions: input ======================= */

  /**
   * Handles a pointer (mouse/touch) press at canvas coordinates. Only
   * active during the INPUT phase; ignores empty space, repeat picks and
   * presses in any other phase. The UI layer converts DOM events into
   * canvas coordinates and forwards them here.
   * @param {number} x - Canvas x coordinate (px).
   * @param {number} y - Canvas y coordinate (px).
   * @returns {void}
   */
  handlePointerDown(x, y) {
    if (this.phase !== PHASE.INPUT) return;

    // First ball whose circle contains the point (balls barely overlap
    // and are frozen during INPUT, so find() is sufficient).
    const clicked = this.balls.find((b) => {
      const dx = b.x - x;
      const dy = b.y - y;
      return Math.hypot(dx, dy) < b.radius;
    });
    if (!clicked || this.selectedBalls.includes(clicked)) return;

    if (clicked.isTarget) {
      clicked.selectedState = 1; // green ring
      this.accuracyTracker.hits++;
      // === 选中音效连击（MOT 反馈）=== 连续选对：good / good / very good
      this._streakCorrect++;
      this._streakWrong = 0;
      if (this._streakCorrect >= 3) { this._speakWord('veryGood'); this._streakCorrect = 0; }
      else { this._speakWord('good'); }
      this.selectedBalls.push(clicked);
      // === GA4 Events === 选择目标球埋点
      if (typeof gtag !== 'undefined') {
        gtag('event', 'ball_selected', { event_category: 'gameplay', correct: true, value: 1 });
      }
    } else {
      clicked.selectedState = 2; // red ring
      // === Practice Mode + Unified Wallbounce === 练习模式：错误点击只显示红色反馈，
      // 不计入失败、不结束本局、不进入 selectedBalls（否则 3 次误点会误触"全部选完"
      // 判定），0.5s 后清除红色状态，玩家可继续重试该球。
      if (this.mode === 'practice') {
        // 连续选错：no / no / oh no
        this._streakWrong++;
        this._streakCorrect = 0;
        if (this._streakWrong >= 3) { this._speakWord('ohNo'); this._streakWrong = 0; }
        else { this._speakWord('no'); }
        setTimeout(() => { clicked.selectedState = 0; }, 500);
        return;
      }
      this.accuracyTracker.misses++;
      // === 选中音效连击（MOT 反馈）=== 连续选错：no / no / oh no
      this._streakWrong++;
      this._streakCorrect = 0;
      if (this._streakWrong >= 3) { this._speakWord('ohNo'); this._streakWrong = 0; }
      else { this._speakWord('no'); }
      this.selectedBalls.push(clicked);
      // === GA4 Events === 选择非目标球（误点）埋点
      if (typeof gtag !== 'undefined') {
        gtag('event', 'ball_selected', { event_category: 'gameplay', correct: false, value: 1 });
      }
    }

    // All picks made -> judge the round.
    if (this.selectedBalls.length >= _CFG.GAME.targetCount) {
      this._setPhase(PHASE.RESULT, 0); // 进入 RESULT 后 handlePointerDown 的 INPUT 守卫拦截后续点击
      // === Level Clear Pause === 选满且全对：先停顿 1s 显示成功反馈，再走现有过渡；
      // 选错（含 miss）立即判定，失败逻辑不受影响。
      const allCorrect = this.selectedBalls.every((b) => b.isTarget);
      if (allCorrect) {
        this._levelClearActive = true;
        const token = ++this._levelClearToken; // 防快速连点导致回调错乱
        setTimeout(() => {
          if (token !== this._levelClearToken) return; // 已被新一局重置
          if (this.phase !== PHASE.RESULT) return;     // 本局状态已改变则跳过
          this._levelClearActive = false;
          this._evaluateResult(); // 沿用现有成功过渡（practice 重开 / onLevelComplete）
        }, 1000);
      } else {
        this._evaluateResult();
      }
    }
  }

  /**
   * Accuracy of the current level's picks, in whole percent.
   * @returns {number} 0-100 (0 when no picks have been made).
   */
  getAccuracy() {
    const total = this.accuracyTracker.hits + this.accuracyTracker.misses;
    return total === 0 ? 0 : Math.round((this.accuracyTracker.hits / total) * 100);
  }

  /**
   * Resets the per-level hit/miss counters (called from startLevel).
   * @returns {void}
   */
  resetAccuracy() {
    this.accuracyTracker = { hits: 0, misses: 0 };
  }

  /* ==================== Phase 2 additions: audio ======================= */

  /**
   * Lazily creates the Web Audio context. Must be called from inside a
   * user gesture (startLevel qualifies). Silently no-ops when the Web
   * Audio API is unavailable — the game then runs muted.
   * @returns {void}
   */
  _initAudio() {
    if (this._audioCtx) return;
    const AC =
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    try {
      this._audioCtx = new AC();
    } catch (e) {
      /* audio unavailable — run muted */
    }
  }

  /**
   * Plays a short note sequence as sine waves with exponential decay.
   * Frequencies come from CONFIG.SOUNDS.
   * @param {number[]} freqs - Note frequencies in Hz, played in sequence.
   * @param {number} [durations=0.15] - Per-note duration in seconds.
   * @returns {void}
   */
  _playTone(freqs, durations) {
    if (!this._audioCtx) this._initAudio();
    if (!this._audioCtx) return;

    // Autoplay policy: the context may still be suspended — nudge it.
    if (
      this._audioCtx.state === 'suspended' &&
      typeof this._audioCtx.resume === 'function'
    ) {
      this._audioCtx.resume().catch(() => {});
    }

    const dur = durations || 0.15;
    const now = this._audioCtx.currentTime;
    freqs.forEach((freq, i) => {
      const start = now + i * dur;
      const osc = this._audioCtx.createOscillator();
      const gain = this._audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      // Envelope anchored at THIS note's start time, so later notes in an
      // arpeggio ring as loud as the first one.
      gain.gain.setValueAtTime(0.3, start);
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur);
      osc.connect(gain);
      gain.connect(this._audioCtx.destination);
      osc.start(start);
      osc.stop(start + dur);
    });
  }

  /**
   * Speaks a short feedback word (Good / Very good / No / Oh no) via the
   * Web Speech API when available; falls back to a synthesized tone when
   * speechSynthesis is missing (e.g. some embedded webviews / minigame).
   * @param {'good'|'veryGood'|'no'|'ohNo'} word
   * @returns {void}
   */
  _speakWord(word) {
    try {
      if (
        typeof window !== 'undefined' &&
        window.speechSynthesis &&
        window.SpeechSynthesisUtterance
      ) {
        const u = new window.SpeechSynthesisUtterance(word);
        u.lang = 'en-US';
        u.rate = 1.05;
        u.pitch = 1.1;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
        return;
      }
    } catch (e) { /* fall through to tone */ }
    const FB = {
      good: [659.25, 880.0],
      veryGood: [523.25, 659.25, 783.99],
      no: [220.0],
      ohNo: [180.0, 110.0],
    };
    this._playTone(FB[word] || [440.0], 0.14);
  }

  /* ------------------------- phase transitions ------------------------- */

  /**
   * Switches phase, resets the phase timer and notifies the UI layer.
   * @param {number} phase - A PHASE value.
   * @param {number} timerMs - Countdown for the new phase (0 = no countdown).
   * @returns {void}
   * @private
   */
  _setPhase(phase, timerMs) {
    this.phase = phase;
    this.phaseTimer = timerMs;

    // === Distraction Overhaul V2 === 每轮 SHOW 开始时把干扰物重置为
    // 随机全场位置 + 随机新目标（不是固定屏外起点），记忆阶段即在场干扰。
    if (phase === PHASE.SHOW) {
      const w = this.canvas.width;
      const h = this.canvas.height;
      for (const d of this.distractions) {
        d.x = Math.random() * w;
        d.y = Math.random() * h;
        d.targetX = Math.random() * w;
        d.targetY = Math.random() * h;
        d.wanderTimer = 0;
      }
    }

    // === Step Hints（目标二）=== 正式关卡三步文字提示（SHOW/MOVE/INPUT），
    // 其余阶段清空前一步提示；TRANSITION 不设置，保留 SHOW 提示直到 MOVE 接管。
    // 统一通过引擎方法 setStepText 落地，与演示弹窗共享的全局
    // showTopText('game') 走同一路径。
    let stepMsg = null;
    if (phase === PHASE.SHOW) stepMsg = 'Remember these highlighted balls';
    else if (phase === PHASE.MOVE) stepMsg = 'Watch them move';
    else if (phase === PHASE.STOP || phase === PHASE.INPUT) stepMsg = 'Tap the original ones';
    else if (phase === PHASE.RESULT || phase === PHASE.IDLE) stepMsg = '';
    if (stepMsg !== null) {
      // 正式关卡复用全局 showTopText('game')；headless（无 window）时直写字段
      if (typeof window !== 'undefined' && typeof window.showTopText === 'function') {
        window.showTopText(stepMsg, 0, 'game');
      } else {
        this.setStepText(stepMsg);
      }
    }

    if (typeof this.onPhaseChange === 'function') {
      this.onPhaseChange(phase);
    }

    // === Background Music (H5) === 小球运动（MOVE）时全音量 0.38；其余相位
    // （SHOW 记忆 / STOP-INPUT 等点击 / RESULT / IDLE）音量减半 0.19 持续播放，
    // 不再 pause，作为氛围底噪。
    if (phase === PHASE.MOVE) _bgmPlay();
    else _bgmDuck();
  }

  /**
   * === Distraction Overhaul V2 ===
   * Advances every distraction sprite: erratic full-board wandering.
   * Each sprite heads toward a random roaming target at a speed of
   * `levelConfig.speed x speedMult` px/frame (so the per-level gradient
   * L16=1.2x → L30=2.6x actually shows on screen), picks a fresh random
   * target when it arrives or after 60~180 frames, and optionally spins.
   * Called during SHOW / TRANSITION / MOVE so the distraction is already
   * on the board while the player memorizes the targets (per design), and
   * freezes with the balls at STOP.
   * @param {number} dt - Elapsed ms.
   * @returns {void}
   * @private
   */
  _updateDistractions(dt) {
    if (this.distractions.length === 0) return;
    const frameScale = (dt / 1000) * 60;
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const d of this.distractions) {
      d.wanderTimer += frameScale;
      const actualSpeed = (this.levelConfig.speed || 2) * d.speedMult;

      // 到达目标点或超时 → 选新目标（随机全场）
      let dx = d.targetX - d.x;
      let dy = d.targetY - d.y;
      let dist = Math.hypot(dx, dy);
      if (dist < 5 || d.wanderTimer > d.wanderInterval) {
        d.targetX = Math.random() * w;
        d.targetY = Math.random() * h;
        d.wanderTimer = 0;
        d.wanderInterval = 60 + Math.floor(Math.random() * 120);
        dx = d.targetX - d.x;
        dy = d.targetY - d.y;
        dist = Math.hypot(dx, dy) || 1;
      }

      // 朝目标匀速推进：步长 = 球速 × speedMult × 帧缩放（不超过剩余距离）
      const step = Math.min(dist, actualSpeed * frameScale);
      d.x += (dx / dist) * step;
      d.y += (dy / dist) * step;

      // 旋转
      if (d.rotation) d.angle += d.rotationSpeed * frameScale;

      // 边界安全网（不应该需要，但以防万一）
      d.x = Math.max(0, Math.min(w, d.x));
      d.y = Math.max(0, Math.min(h, d.y));
    }
  }

  /* ---------------------------- phase updates --------------------------- */

  /**
   * SHOW: count down; blink target highlights (300ms on / 300ms off).
   * @param {number} dt - Elapsed ms.
   * @returns {void}
   * @private
   */
  _updateShow(dt) {
    this.phaseTimer -= dt;
    this._updateDistractions(dt); // === V2 Full Release === 记忆阶段也飘
    for (const ball of this.balls) {
      if (ball.isTarget) {
        ball.highlightTimer = Math.max(0, ball.highlightTimer - dt);
      }
    }
    if (this.phaseTimer <= 0) {
      this._setPhase(PHASE.TRANSITION, _CFG.GAME.phaseTransitionDuration);
    }
  }

  /**
   * TRANSITION: brief beat where all balls look identical, then MOVE.
   * @param {number} dt - Elapsed ms.
   * @returns {void}
   * @private
   */
  _updateTransition(dt) {
    this.phaseTimer -= dt;
    this._updateDistractions(dt); // === V2 Full Release ===
    if (this.phaseTimer <= 0) {
      const duration =
        (this.levelConfig && this.levelConfig.duration) || _CFG.GAME.phaseMoveDuration;
      this._setPhase(PHASE.MOVE, duration);
    }
  }

  /**
   * MOVE: every ball S-roams the whole board, bounces off walls, gently
   * separates from neighbours, and is then hard-corrected so no two balls
   * ever overlap. At the end of the phase the balls freeze and receive
   * number labels.
   *
   * All motion is time-based (seconds, normalized by frameScale = dtSec*60),
   * so feel is identical at any refresh rate.
   * @param {number} dt - Elapsed ms.
   * @returns {void}
   * @private
   */
  _updateMove(dt) {
    this.phaseTimer -= dt;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const rng = this._rng || Math.random;
    const ballRadius = this.balls[0] ? this.balls[0].radius : _CFG.GAME.ballRadius;

        // === Swim Mode v3 (long-range) === 每个球 S 形全场漫游 + 碰墙镜像翻转
    for (const ball of this.balls) {
      switch (ball.trajType) {
        case 'wallbounce': {
          // === Wall-Bounce Balanced === 直线前进 + S 形摆动 + 撞墙后选最均衡方向
          const margin = ball.radius; // 与 _resolveOverlaps 的夹取边界(r)一致，避免边缘假撞墙
          const dtSec = dt / 1000;
          const frameScale = dtSec * 60;

          // ---- 位移：沿当前角度前进 ----
          ball.x += ball.vx * frameScale;
          ball.y += ball.vy * frameScale;

          // ---- S 形摆动（垂直于速度方向）----
          ball.wobbleTime += dtSec;
          const wob = ball.wobbleTime * ball.wobbleFreq * Math.PI * 2 + ball.wobblePhase;
          const cosVal = Math.cos(wob);
          const speedMag = Math.hypot(ball.vx, ball.vy) || 1;
          const perpX = -ball.vy / speedMag;
          const perpY = ball.vx / speedMag;
          // 横向速度幅值：使摆动振幅 ≈ wobbleAmp
          const lateralSpeed = ball.wobbleAmp * ball.wobbleFreq * Math.PI * 2;
          ball.x += perpX * cosVal * lateralSpeed * dtSec;
          ball.y += perpY * cosVal * lateralSpeed * dtSec;

          // ---- 碰墙检测（0=左, 1=右, 2=上, 3=下）----
          // 速度方向守卫：仅当球「朝墙外」运动时才算撞墙，避免被 _resolveOverlaps
          // 夹在边缘(r)的球因位置阈值反复触发假撞墙而贴墙抖动。
          let hitWall = -1;
          if (ball.x <= margin && ball.vx < 0) { ball.x = margin; hitWall = 0; }
          else if (ball.x >= w - margin && ball.vx > 0) { ball.x = w - margin; hitWall = 1; }
          else if (ball.y <= margin && ball.vy < 0) { ball.y = margin; hitWall = 2; }
          else if (ball.y >= h - margin && ball.vy > 0) { ball.y = h - margin; hitWall = 3; }

          if (hitWall >= 0) {
            // 记录这次撞墙
            ball.wallHitCount[hitWall]++;

            // 可选方向：排除来的方向
            const forbiddenMap = { 0:[180], 1:[0], 2:[270], 3:[90] };
            let options = [0, 90, 180, 270].filter(d => !forbiddenMap[hitWall].includes(d));

            // 从可选方向里挑 wallHitCount 最小的
            let minHits = Infinity;
            for (const d of options) {
              const wallIdx = d === 0 ? 1 : d === 180 ? 0 : d === 90 ? 3 : 2;
              if (ball.wallHitCount[wallIdx] < minHits) {
                minHits = ball.wallHitCount[wallIdx];
              }
            }
            options = options.filter(d => {
              const wallIdx = d === 0 ? 1 : d === 180 ? 0 : d === 90 ? 3 : 2;
              return ball.wallHitCount[wallIdx] === minHits;
            });

            // 从最优方向里随机选一个
            const newDir = options[Math.floor(rng() * options.length)];

            // === Hybrid 修正（=== Wall-Bounce Balanced ===）===
            // 把选中的「垂直方向」向场内倾斜约 35°，使其始终带「离墙」分量，
            // 避免贴墙抖动 + 对面墙饿死；选中的「内反光」方向（本就离墙）仅加
            // ±12° 随机微扰以丰富路径。均衡选择逻辑（forbiddenMap / wallHitCount）不变。
            const INWARD_BY_WALL = { 0: 0, 1: 180, 2: 90, 3: 270 };
            const inwardAngle = INWARD_BY_WALL[hitWall];
            let diff = ((newDir - inwardAngle + 540) % 360) - 180;
            let finalAngle = newDir;
            if (Math.abs(diff) > 45) {
              finalAngle = newDir + (diff > 0 ? -35 : 35);
            } else {
              finalAngle = newDir + (rng() * 2 - 1) * 12;
            }
            ball.angle = finalAngle * Math.PI / 180;

            // 随机化摆动相位
            ball.wobblePhase = rng() * Math.PI * 2;
            ball.wobbleTime = 0;

            ball.vx = Math.cos(ball.angle) * ball.baseSpeed;
            ball.vy = Math.sin(ball.angle) * ball.baseSpeed;
          }

          break;
        }
        case 'swim':
        default: {
          // === Swim Mode v3 (long-range) === S 形全场漫游（远距目标 + 碰墙镜像翻转）
          const margin = ball.radius + 10;
          const dtSec = dt / 1000;
          const frameScale = dtSec * 60;

          // ---- 1. 检查是否到达目标 ----
          const dxToTarget = ball.targetX - ball.x;
          const dyToTarget = ball.targetY - ball.y;
          const distToTarget = Math.hypot(dxToTarget, dyToTarget);

          if (distToTarget < ball.targetReachDist) {
            // === Anti-Crowd + Tutorial Choice === 选新目标：远距（保留上一版 v3）
            // + 避开拥挤区（半径 80px 内已有 ≥2 个球则视为拥挤，重试）。
            // 注：输出要求明确保留「长距离目标点」逻辑，故将远距约束与拥挤检测合并。
            let newTx, newTy;
            const minDx = w * 0.4;
            const minDy = h * 0.4;
            let attempts = 0;
            do {
              newTx = margin + rng() * Math.max(1, w - margin * 2);
              newTy = margin + rng() * Math.max(1, h - margin * 2);
              // 长距离约束：目标必须在画布另一侧（保留上一版 v3 行为）
              const farEnough =
                Math.abs(newTx - ball.x) >= minDx &&
                Math.abs(newTy - ball.y) >= minDy;
              // 拥挤检测：半径 80px 内已有 ≥2 个球则视为拥挤
              let nearbyCount = 0;
              for (const other of this.balls) {
                if (other === ball) continue;
                const d = Math.hypot(other.x - newTx, other.y - newTy);
                if (d < 80) nearbyCount++;
              }
              attempts++;
              // 满足「远距且不太拥挤」即采用；试满 20 次仍无更优解则退而求其次
              if ((farEnough && nearbyCount < 2) || attempts >= 20) break;
            } while (true);
            ball.targetX = newTx;
            ball.targetY = newTy;
          }

          // ---- 2. 朝向目标 ----
          const tx = ball.targetX - ball.x;
          const ty = ball.targetY - ball.y;
          const tdist = Math.hypot(tx, ty) || 1;
          const dirX = tx / tdist;
          const dirY = ty / tdist;

          // ---- 3. S 形摆动（垂直于前进方向）----
          ball.swimTime += dtSec;
          const perpX = -dirY;
          const perpY = dirX;
          const s = Math.sin(ball.swimTime * ball.swimFreq * Math.PI * 2 + ball.swimPhase);
          const swingX = perpX * s * ball.swimAmp;
          const swingY = perpY * s * ball.swimAmp;

          // 摆动速度（对时间的导数）
          const cosVal = Math.cos(ball.swimTime * ball.swimFreq * Math.PI * 2 + ball.swimPhase);
          const swingVelX = perpX * cosVal * ball.swimFreq * 2;
          const swingVelY = perpY * cosVal * ball.swimFreq * 2;

          // 前进位移（MOT：每球独立速度 + 温和周期爆发，制造交叉训练前额叶/顶叶）
          let effSpeed = ball.baseSpeed;
          if (ball.trajType === 'mot') {
            if (ball.burst > 0) {
              effSpeed *= 1.3;                 // 温和爆发 1.3x（不夸张）
              ball.burst -= dtSec;
            } else {
              ball.burstT -= dtSec;
              if (ball.burstT <= 0) {
                ball.burst = 0.5 + rng() * 0.4; // 0.5~0.9s 爆发
                ball.burstT = 2 + rng() * 2;     // 2~4s 间隔
              }
            }
            effSpeed *= (ball.speedFactor || 1);
          }
          const forwardX = dirX * effSpeed * frameScale;
          const forwardY = dirY * effSpeed * frameScale;

          // 合成
          ball.x += forwardX + swingVelX * frameScale;
          ball.y += forwardY + swingVelY * frameScale;

          // 碰墙反弹（同时翻转目标点的对应轴，让球游回来）
          if (ball.x <= ball.radius) {
            ball.x = ball.radius;
            ball.targetX = w - ball.targetX; // 镜像翻转目标
          }
          if (ball.x >= w - ball.radius) {
            ball.x = w - ball.radius;
            ball.targetX = w - ball.targetX;
          }
          if (ball.y <= ball.radius) {
            ball.y = ball.radius;
            ball.targetY = h - ball.targetY;
          }
          if (ball.y >= h - ball.radius) {
            ball.y = h - ball.radius;
            ball.targetY = h - ball.targetY;
          }

          break;
        }
        case 'mot': {
          // === MOT 运动（移植自测试版 updateMOT，顺滑手感）===
          // 角度受限转向 + 连续正弦弯曲 + 速度取角度方向 + 碰壁翻角。
          // 不做强软分离（避免力场互搏颤抖），零重叠靠每帧 _resolveOverlaps。
          const m = ball.radius;
          const dtSec = dt / 1000;
          const frameScale = dtSec * 60;
          ball.swimTime += dtSec;

          // 朝漫游目标点转向（平滑）
          const dx = ball.cx - ball.x;
          const dy = ball.cy - ball.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 14 || ball.stay <= 0) {
            ball.cx = m + rng() * Math.max(1, w - m * 2);
            ball.cy = m + rng() * Math.max(1, h - m * 2);
            ball.stay = 1.2 + rng() * 1.4;
          } else {
            ball.stay -= dtSec;
          }
          const desired = Math.atan2(dy, dx);
          let da = desired - ball.angle;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          ball.angle += Math.max(-ball.turnRate * dtSec, Math.min(ball.turnRate * dtSec, da));
          // 连续正弦弯曲（叠加到角度上，自然游动）
          ball.angle += Math.sin(ball.swimTime * ball.swimFreq * Math.PI * 2 + ball.swimPhase) * ball.swimAmp * dtSec * 0.02;

          // 速度：每球独立速度 + 温和周期爆发（制造交叉，练前额叶/顶叶）
          let sp = ball.baseSpeed * (ball.speedFactor || 1);
          if (ball.burst > 0) {
            sp *= 1.7;                 // 周期爆发 1.7x（与测试版一致）
            ball.burst -= dtSec;
          } else {
            ball.burstT -= dtSec;
            if (ball.burstT <= 0) {
              ball.burst = 0.5 + rng() * 0.4; // 0.5~0.9s 爆发
              ball.burstT = 2 + rng() * 2;     // 2~4s 间隔
            }
          }
          const vel = sp * frameScale;
          ball.x += Math.cos(ball.angle) * vel;
          ball.y += Math.sin(ball.angle) * vel;

          // 碰壁反弹（翻转角度，让球游回来）
          if (ball.x < m) { ball.x = m; ball.angle = Math.PI - ball.angle; }
          if (ball.x > w - m) { ball.x = w - m; ball.angle = Math.PI - ball.angle; }
          if (ball.y < m) { ball.y = m; ball.angle = -ball.angle; }
          if (ball.y > h - m) { ball.y = h - m; ball.angle = -ball.angle; }

          break;
        }
      }
    }

    // === Anti-Crowd + Tutorial Choice === 增强分离系统（触发距离加大 + 力度 3.75×
    // + 拥挤逃离）。这是「软」避让，降低重叠概率；硬保证仍由下方 _resolveOverlaps 负责。
    // === Wall-Bounce Playable === wallbounce 用更温和的分离（跳过拥挤逃离），
    // 否则会被强分离（0.3 + 1.2 逃离）钉在中央、到不了墙、造成“饿死”
    const isWallBounce = this.balls[0] ? (this.balls[0].trajType === 'wallbounce') : false;
    const sepDist = isWallBounce ? ballRadius * 2.5 : ballRadius * 2.8;   // 触发距离加大
    const sepForce = isWallBounce ? 0.12 : 0.3;               // wallbounce 力度调低（swim 保持 0.3 = 3.75×）
    const crowdDist = ballRadius * 3.5; // 拥挤检测距离
    const crowdThreshold = 2;           // 周围 ≥2 个球就算拥挤

    // 重置
    for (const b of this.balls) {
      b.separateX = 0;
      b.separateY = 0;
      b.crowdCount = 0;
    }

    // 第一遍：计算拥挤度
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i], b = this.balls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < crowdDist) {
          a.crowdCount++;
          b.crowdCount++;
        }
      }
    }

    // 第二遍：分离力
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i], b = this.balls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0 && dist < sepDist) {
          const push = (sepDist - dist) * sepForce;
          const nx = dx / dist, ny = dy / dist;
          a.separateX -= nx * push;
          a.separateY -= ny * push;
          b.separateX += nx * push;
          b.separateY += ny * push;
        }
      }
    }

    // 第三遍：拥挤逃离（crowdCount ≥ 2 的球额外推开）。wallbounce 跳过 —— 否则把球推回中央
    for (const b of this.balls) {
      if (!isWallBounce && b.crowdCount >= crowdThreshold) {
        // 找一个远离人群的方向
        let escapeX = 0, escapeY = 0;
        for (const other of this.balls) {
          if (other === b) continue;
          const dx = b.x - other.x, dy = b.y - other.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0 && dist < crowdDist) {
            escapeX += dx / dist;
            escapeY += dy / dist;
          }
        }
        const escLen = Math.hypot(escapeX, escapeY) || 1;
        // 逃离推力
        b.separateX += (escapeX / escLen) * 1.2;
        b.separateY += (escapeY / escLen) * 1.2;
      }
    }

    // 应用（MOT 跳过：靠 _resolveOverlaps 保证零重叠，避免强软分离与前进力互搏造成颤抖）
    const isMot = this.balls[0] ? (this.balls[0].trajType === 'mot') : false;
    if (!isMot) {
      for (const b of this.balls) {
        b.x += b.separateX;
        b.y += b.separateY;
      }
    }

    // === Anti-Crowd + Tutorial Choice === 硬位移修正（保留作为零重叠的硬保证）
    // 软分离 + 拥挤逃离在数学上仍无法保证零重叠（有限盒内自由漫游必有路径交叉），
    // 故每帧仍做一次硬投影分离。这是“永不重叠”的硬保证，不可移除。
    this._resolveOverlaps(ballRadius, w, h);

    // === V2 Full Release === 干扰物位移（球运动之后）
    this._updateDistractions(dt);

    if (this.phaseTimer <= 0) {
      // Freeze and number every ball so the player can call out picks.
      this.balls.forEach((ball, i) => {
        ball.numberLabel = i + 1;
      });
      this._setPhase(PHASE.STOP, 0);
    }
  }

  /* ==================== Swim Mode v3 (long-range) ================== */

  /**
   * Iteratively pushes apart any overlapping pair until every pair is at
   * least 2*radius apart (or the pass converges). Runs every frame after
   * movement + soft separation, and once at spawn, so balls never visually
   * merge. Clamps to the board each iteration so balls stay inside.
   * @param {number} r - Ball radius (px).
   * @param {number} w - Canvas width (px).
   * @param {number} h - Canvas height (px).
   * @returns {void}
   * @private
   */
  _resolveOverlaps(r, w, h) {
    const balls = this.balls;
    const minD = r * 2;
    // Degenerate (all centers coincident) tie-breaker uses Math.random so it
    // never perturbs the seeded gameplay RNG stream (daily determinism).
    const rnd = () => Math.random;

    const clamp = () => {
      for (const b of balls) {
        if (b.x < r) b.x = r; else if (b.x > w - r) b.x = w - r;
        if (b.y < r) b.y = r; else if (b.y > h - r) b.y = h - r;
      }
    };

    const hasOverlap = () => {
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const dx = balls[j].x - balls[i].x;
          const dy = balls[j].y - balls[i].y;
          if (Math.hypot(dx, dy) < minD) return true;
        }
      }
      return false;
    };

    // One Gauss-Seidel relaxation pass: every overlapping pair is pushed
    // exactly to 2r apart. Returns true when any ball moved.
    const relax = () => {
      let moved = false;
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i], b = balls[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < minD) {
            if (d < 1e-4) { dx = rnd() - 0.5; dy = rnd() - 0.5; d = Math.hypot(dx, dy) || 1; }
            const push = (minD - d) / 2;
            const nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
            moved = true;
          }
        }
      }
      return moved;
    };

    // === Practice Mode + Unified Wallbounce ===
    // wallbounce 用更温和的分离（跳过拥挤逃离），高球数小画布下球会挤成簇，
    // 原「1 次松弛 + 4 次补松弛」不足以解开角簇，会残留 ≤1px 重叠。改为
    // 「松弛→夹取」交替直到零重叠（封顶 50 轮，让球尽量既在界内又零重叠），
    // 最后再补一次不夹取的纯净松弛作为硬保证：返回的每一帧都 100% 零重叠
    // （极端角簇最多让个别球 ≤r 越界，远优于两球合并）。
    clamp();
    for (let outer = 0; outer < 50; outer++) {
      const moved = relax();
      if (!moved) return;        // 已零重叠（且全程夹取在界内）
      clamp();
      if (!hasOverlap()) return; // 夹取后仍零重叠
    }
    // 极端角簇兜底：不再夹取，纯净松弛到完全零重叠（允许极少数球短暂 ≤r 越界）。
    for (let iter = 0; iter < 80; iter++) {
      if (!relax()) break;
    }
  }

  /**
   * STOP: a single-frame breather (labels are already drawn), then hand
   * over to INPUT where handlePointerDown() accepts picks.
   * @param {number} dt - Elapsed ms (unused).
   * @returns {void}
   * @private
   */
  _updateStop(dt) {
    // === Phase 2 additions ===
    this._setPhase(PHASE.INPUT, 0);
  }

  /* ==================== Phase 2 additions: result ====================== */

  /**
   * Judges the round once targetCount picks are in. A perfect round plays
   * the fanfare and unlocks the next level; any miss ends the run and, in
   * daily mode, records today's result. Fires onLevelComplete / onGameOver
   * so the UI layer can show summaries and share cards.
   * @returns {void}
   * @private
   */
  _evaluateResult() {
    const allCorrect = this.selectedBalls.every((b) => b.isTarget);
    const accuracy = this.getAccuracy();

    // === Practice Mode + Unified Wallbounce === 练习模式：永远不 Game Over、不进下一关。
    // 一局完成（选够 targetCount 个目标球）即重开新一局继续��习，无限循环。
    if (this.mode === 'practice') {
      this._playTone(_CFG.SOUNDS.levelComplete, 0.18); // 正向反馈
      // === Practice Difficulty Select === 一局完成后不结束，从该难度段再随机选一关重开
      const oldDifficulty = this.practiceDifficulty;
      this.setPracticeDifficulty(oldDifficulty); // 重新随机选关（同难度段）
      this.levelConfig = _Levels.getLevelConfig(this.practiceLevel);
      this.currentLevel = this.practiceLevel;
      this.selectedBalls = [];
      this.resetAccuracy();
      this.initBalls();
      this._initDistractions();
      this._setPhase(PHASE.SHOW, _CFG.GAME.phaseShowDuration);
      return;
    }

    if (allCorrect) {
      this._playTone(_CFG.SOUNDS.levelComplete, 0.18);
      // === GA4 Events === 关卡成功埋点（accuracy 复用本函数已算好的值）
      if (typeof gtag !== 'undefined') {
        gtag('event', 'level_end', {
          level_name: 'Level ' + this.currentLevel,
          success: true,
          accuracy: accuracy,
          mode: this.mode
        });
      }
      if (_Storage) {
        _Storage.setBestLevel(
          Math.max(_Storage.getBestLevel(), this.currentLevel + 1)
        );
      }
      if (typeof this.onLevelComplete === 'function') {
        this.onLevelComplete({
          level: this.currentLevel,
          accuracy: accuracy,
          isDaily: this.isDailyChallenge,
        });
      }
    } else {
      // === GA4 Events === 关卡失败埋点
      if (typeof gtag !== 'undefined') {
        gtag('event', 'level_end', {
          level_name: 'Level ' + this.currentLevel,
          success: false,
          accuracy: accuracy,
          mode: this.mode
        });
      }
      if (_Storage) {
        _Storage.incrementTotalPlays();
        if (this.isDailyChallenge) {
          _Storage.setDailyResult(this.currentLevel, accuracy);
        }
      }
      if (typeof this.onGameOver === 'function') {
        this.onGameOver({
          level: this.currentLevel,
          accuracy: accuracy,
          isDaily: this.isDailyChallenge,
          mode: this.mode, // === Practice Mode + Unified Wallbounce === 供 UI 层判断
          targets: this.balls
            .filter((b) => b.isTarget)
            .map((b) => b.numberLabel),
        });
      }
      // === GA4 Events === 游戏结束埋点（revived 字段本版本未实现，恒为 false）
      if (typeof gtag !== 'undefined') {
        gtag('event', 'game_over', {
          max_level: this.currentLevel,
          accuracy: accuracy,
          mode: this.mode,
          revived: (this.hasRevived || false)
        });
      }
    }
  }

  /* ------------------------------- render ------------------------------- */

  /**
   * Draws all balls, plus the SHOW-phase blinking highlight ring on targets
   * and the (Phase 2) correct/wrong selection rings.
   * @returns {void}
   * @private
   */
  // === FIX: 3D ball + centered numbers ===
  _renderBalls() {
    const ctx = this.ctx;
    const G = _CFG.GAME;

    for (const ball of this.balls) {
      const r = ball.radius;

      // ---- 1. 阴影 ----
      ctx.save();
      ctx.shadowColor = 'rgba(62, 31, 109, 0.4)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 4;

      // ---- 2. 径向渐变球体 ----
      // 渐变中心偏左上（模拟光源在左上角）
      const grad = ctx.createRadialGradient(
        ball.x - r * 0.35,  // 高光中心 X（偏左）
        ball.y - r * 0.35,  // 高光中心 Y（偏上）
        r * 0.05,           // 高光半径很小（亮点）
        ball.x,             // 球体中心 X
        ball.y,             // 球体中心 Y
        r                   // 球体半径
      );
      // 三段色：亮→主色→暗边
      grad.addColorStop(0,   G.ballColorLight || '#E0C8F5');
      grad.addColorStop(0.55, G.ballColor       || '#C8A2E8');
      grad.addColorStop(1,   G.ballColorDark  || '#9B6FC7');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ---- 3. 高光点（球体左上方的小白点，模拟玻璃球反光）----
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(
        ball.x - r * 0.3,   // 左偏
        ball.y - r * 0.35,  // 上偏
        r * 0.22,           // 高光半径约为球的 1/5
        0, Math.PI * 2
      );
      ctx.fill();
      ctx.restore();

      // ---- 4. 描边（选中/高亮状态） ----
      if (ball.selectedState === 1) {
        // 正确：绿色描边
        ctx.strokeStyle = G.correctColor || '#4CAF50';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ball.selectedState === 2) {
        // 错误：红色描边
        ctx.strokeStyle = G.wrongColor || '#F44336';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (this.phase === PHASE.SHOW && ball.isTarget) {
        // 目标高亮：鲜红闪烁描边（改动 3：红色 + 更急节奏）
        const blink = Math.floor(performance.now() / 150) % 2 === 0;
        if (blink) {
          ctx.strokeStyle = G.targetRingColor || '#FF1744';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(ball.x, ball.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Draws each ball's number label just above it (STOP / INPUT phases).
   * @returns {void}
   * @private
   */
  // === FIX: 3D ball + centered numbers ===
  _renderNumberLabels() {
    const ctx = this.ctx;
    ctx.save();
    // 字号根据球半径动态计算，约为半径的 80%
    const fontSize = Math.round((this.balls[0] && this.balls[0].radius || 20) * 0.8);
    ctx.font = 'bold ' + fontSize + 'px "Nunito", Arial, sans-serif';
    ctx.textAlign = 'center';    // 水平居中
    ctx.textBaseline = 'middle'; // 垂直居中 ← 这是关键

    for (const ball of this.balls) {
      if (ball.numberLabel == null) continue;
      const text = String(ball.numberLabel);

      // 先画白色描边（保证在紫色球上也清晰）
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(2, fontSize * 0.15);
      ctx.lineJoin = 'round';
      ctx.strokeText(text, ball.x, ball.y);

      // 再画深色填充
      ctx.fillStyle = _CFG.GAME.numberTextColor || '#3E1F6D';
      ctx.fillText(text, ball.x, ball.y);
    }
    ctx.restore();
  }

  /**
   * === Distraction Overhaul V2 ===
   * Draws every distraction sprite (canvas-drawn brain / star / gradient
   * earth) at its current position, opacity and rotation. The brain is a
   * dark-purple ellipse with fold curves (NOT an emoji — consistent look
   * across platforms and honors the configured color).
   * @returns {void}
   * @private
   */
  _renderDistractions() {
    if (this.distractions.length === 0) return;
    const ctx = this.ctx;

    for (const d of this.distractions) {
      ctx.save();
      ctx.globalAlpha = d.opacity;
      ctx.translate(d.x, d.y);
      if (d.rotation) ctx.rotate(d.angle);

      const hs = d.visualSize / 2; // 半尺寸

      if (d.type === 'brain') {
        // 深色填充的简易大脑：圆润椭圆 + 表面褶皱曲线
        ctx.fillStyle = d.color || '#2D2040';
        ctx.beginPath();
        ctx.ellipse(0, 0, hs, hs * 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
        // 表面褶皱线（几条竖向曲线）
        ctx.strokeStyle = d.color || '#2D2040';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = d.opacity * 0.6;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * hs * 0.3, -hs * 0.6);
          ctx.quadraticCurveTo(i * hs * 0.5, 0, i * hs * 0.3, hs * 0.6);
          ctx.stroke();
        }
        ctx.globalAlpha = d.opacity;

      } else if (d.type === 'star') {
        ctx.fillStyle = d.color || '#FFD54F';
        drawStar(ctx, 0, 0, 5, hs, hs * 0.5);
        ctx.fill();

      } else if (d.type === 'earth') {
        // 地球：蓝色渐变底 + 绿色大陆
        const grad = ctx.createRadialGradient(-hs * 0.2, -hs * 0.2, 0, 0, 0, hs);
        grad.addColorStop(0, '#64B5F6');
        grad.addColorStop(1, d.color || '#1565C0');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, hs, 0, Math.PI * 2);
        ctx.fill();
        // 大陆斑块
        ctx.fillStyle = '#4CAF50';
        ctx.globalAlpha = d.opacity * 0.7;
        ctx.beginPath();
        ctx.arc(hs * 0.2, -hs * 0.2, hs * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(-hs * 0.25, hs * 0.25, hs * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = d.opacity;
      }

      ctx.restore();
    }
  }

  /**
   * Draws the phase hint line at the top of the canvas.
   * @returns {void}
   * @private
   */
  _renderPhaseOverlay() {
    if (this._levelClearActive) return;
    // web 版步骤文字由 main.js 的 DOM 文字条负责（_renderStepOnCanvas=false），
    // 此处不绘制。小游戏无 DOM，宿主把 _renderStepOnCanvas 置 true，改在 Canvas
    // 内绘制步骤提示（与 web 的 DOM 条互斥，互不影响）。
    if (!this._renderStepOnCanvas) return;
    const text = this._stepText;
    if (!text) return;
    const { ctx, canvas } = this;
    ctx.save();
    ctx.font = 'bold 22px "Nunito", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const y = 30; // 画布顶部 0~40 区域（小游戏无 DOM 条，直接画在画面内顶部）
    try {
      const tw = ctx.measureText ? ctx.measureText(text).width : 0;
      if (tw && isFinite(tw)) ctx.clearRect(canvas.width / 2 - tw / 2 - 12, y - 16, tw + 24, 32);
    } catch (e) { /* headless 无 measureText，跳过清屏 */ }
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.strokeText(text, canvas.width / 2, y);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, canvas.width / 2, y);
    ctx.restore();
  }

  /**
   * Runs a self-contained first-time-play demo animation on its own canvas
   * (NOT the game board). Three balls roam with wall-bounce; one is flagged
   * as the target and wears a blinking red ring — mirroring the real gameplay
   * so the player learns what to look for. Stops after ~150 frames and then
   * invokes onComplete; returns a cancel() function that aborts the loop
   * WITHOUT firing onComplete (so a "Skip" click never double-starts the game).
   *
   * @param {HTMLCanvasElement} canvas - The dedicated tutorial canvas.
   * @param {function} [onComplete] - Called once when the demo finishes.
   * @returns {function} cancel - Stops the animation; safe to call twice.
   */
  // === Tutorial === 首次游玩演示动画（自包含 RAF 循环，返回取消函数）
  runTutorial(canvas, onComplete) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const G = _CFG.GAME;
    const r = Math.round(Math.min(W, H) * 0.11); // 球体半径随画布缩放

    // 三个演示球：其中一个是目标（红色闪烁环）
    const demoBalls = [
      { x: W * 0.30, y: H * 0.42, vx:  1.5, vy:  1.1, isTarget: true  },
      { x: W * 0.70, y: H * 0.58, vx: -1.3, vy:  1.4, isTarget: false },
      { x: W * 0.52, y: H * 0.78, vx:  1.1, vy: -1.5, isTarget: false }
    ];

    let frame = 0;
    const maxFrames = 150;
    let rafId = null;
    let cancelled = false;

    const drawDemoBall = (b) => {
      // 阴影
      ctx.save();
      ctx.shadowColor = 'rgba(62, 31, 109, 0.4)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
      // 径向渐变球体（与真实球体一致的亮→主→暗三段色）
      const grad = ctx.createRadialGradient(
        b.x - r * 0.35, b.y - r * 0.35, r * 0.05,
        b.x, b.y, r
      );
      grad.addColorStop(0,    G.ballColorLight || '#E0C8F5');
      grad.addColorStop(0.55, G.ballColor       || '#C8A2E8');
      grad.addColorStop(1,    G.ballColorDark  || '#9B6FC7');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 高光点（玻璃球反光）
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(b.x - r * 0.30, b.y - r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 目标高亮：鲜红闪烁描边（与真实 SHOW 阶段一致）
      if (b.isTarget) {
        const blink = Math.floor((typeof performance !== 'undefined'
          ? performance.now() : Date.now()) / 150) % 2 === 0;
        if (blink) {
          ctx.strokeStyle = G.targetRingColor || '#FF1744';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    const step = () => {
      if (cancelled) return;
      // 透明清屏（与游戏一致；非透明主题则回退底色）
      if (G.transparentBg) {
        ctx.clearRect(0, 0, W, H);
      } else {
        ctx.fillStyle = G.bgColor || '#0f0c29';
        ctx.fillRect(0, 0, W, H);
      }
      // 移动 + 碰墙反弹
      for (const b of demoBalls) {
        b.x += b.vx;
        b.y += b.vy;
        if (b.x <= r)      { b.x = r;      b.vx =  Math.abs(b.vx); }
        if (b.x >= W - r)  { b.x = W - r;  b.vx = -Math.abs(b.vx); }
        if (b.y <= r)      { b.y = r;      b.vy =  Math.abs(b.vy); }
        if (b.y >= H - r)  { b.y = H - r;  b.vy = -Math.abs(b.vy); }
      }
      for (const b of demoBalls) drawDemoBall(b);

      frame++;
      if (frame >= maxFrames) {
        if (typeof onComplete === 'function') onComplete();
        return;
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);

    // 返回取消函数：停止循环且不再触发 onComplete
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }
}

/* ------------------------------------------------------------------------ */
/* Helpers (module scope)                                                   */
/* ------------------------------------------------------------------------ */

/**
 * === V2 Full Release ===
 * Traces a five-pointed star path on the given context (caller fills).
 * @param {CanvasRenderingContext2D} ctx - Target context.
 * @param {number} cx - Center x.
 * @param {number} cy - Center y.
 * @param {number} spikes - Number of points (5 for a classic star).
 * @param {number} outerR - Outer radius (px).
 * @param {number} innerR - Inner radius (px).
 * @returns {void}
 */
function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = Math.PI / 2 * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.lineTo(cx + Math.cos(Math.PI / 2 * 3) * outerR, cy + Math.sin(Math.PI / 2 * 3) * outerR);
  ctx.closePath();
}

/* ------------------------------------------------------------------------ */
/* Exposure                                                                 */
/* ------------------------------------------------------------------------ */

// === Background Music (H5) === 三模式 BGM 由 window.bgmManager 控制，game.js
// 只负责在适当相位触发 play()（小球开始运动，音量 0.38）/ duck()（小球停止，
// 音量减半 0.19 持续播放），绝不在 RAF 内反复调用。headless / 小游戏运行时
// 无 window.bgmManager，守卫后自动跳过，不影响玩法逻辑。
function _bgmPlay() {
  const m = (typeof window !== 'undefined') ? window.bgmManager : null;
  if (m && typeof m.play === 'function') { try { m.play(); } catch (e) {} }
}
function _bgmDuck() {
  const m = (typeof window !== 'undefined') ? window.bgmManager : null;
  if (m && typeof m.duck === 'function') { try { m.duck(); } catch (e) {} }
}

// Statics so the UI layer can do `phase === GameEngine.PHASE.STOP`.
GameEngine.PHASE = PHASE;
GameEngine.Ball = Ball;

// Expose for classic <script> consumers.
if (typeof window !== 'undefined') {
  window.GameEngine = GameEngine;
}

// Expose for Node / bundler consumers.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GameEngine;
}

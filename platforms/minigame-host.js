// ===== platforms/minigame-host.js =====
/**
 * Platform-agnostic host that runs the SHARED EyeTrack GameEngine inside a
 * mini-game runtime (WeChat `wx` / Douyin `tt`). It replaces the entire web
 * UI layer (main.js — menus, HUD, tutorial overlay, share buttons) with:
 *
 *   - a canvas-drawn main menu (start / daily / share)
 *   - a canvas-drawn game-over screen (back to menu / share)
 *   - a single requestAnimationFrame loop that drives engine.update()/render()
 *   - touch hit-testing against in-canvas buttons
 *
 * It touches NO document / window / localStorage. The only platform-specific
 * knowledge lives in platforms/wechat.js & platforms/douyin.js. The core
 * game.js is loaded verbatim and runs unchanged (it already guards every
 * browser API behind `typeof` checks).
 *
 * Package flow: copy the right entry (game.wechat.js / game.douyin.js) to the
 * mini-game project root as `game.js`, along with platforms/* and the core
 * files (config.js, levels.js, game.js). No build step required — these are
 * plain CommonMagic modules the mini-game runtime can `require`.
 */

(function () {
  'use strict';

  // ---- load shared core (config.js / levels.js guard `window` internally) ----
  const CONFIG = require('../config.js');
  const Levels = require('../levels.js');
  const GameEngine = require('../game.js');

  // Expose to globalThis so engine._getGlobal() resolves them inside wx/tt
  // (the engine checks window first, then globalThis).
  globalThis.CONFIG = CONFIG;
  globalThis.Levels = Levels;

  /**
   * Boot the game for a given platform adapter.
   * @param {object} platform - The wechat.js / douyin.js adapter object.
   */
  function boot(platform) {
    const P = platform;

    // Platform storage replaces the web StorageManager (localStorage-based).
    globalThis.StorageManager = P.makeStorageManager();

    // ---- screen canvas (full device screen) ----
    const canvas = P.createCanvas();
    const info = P.getSystemInfo();
    const W = info.windowWidth;
    const H = info.windowHeight;
    canvas.width = W;   // logical pixels == gameplay bounds (engine reads these)
    canvas.height = H;
    const ctx = P.getContext(canvas);

    // Mini-game has no CSS background: render an opaque board instead of
    // relying on `transparentBg` (which only makes sense on the web container).
    CONFIG.GAME.transparentBg = false;

    const engine = new GameEngine(canvas);
    engine._renderStepOnCanvas = true; // draw step hints INSIDE the canvas (no DOM)
    globalThis.__eyeTrackEngine = engine;

    // ---- RAF / timing helpers (guarded for runtime availability) ----
    const raf = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame
      : (canvas.requestAnimationFrame ? ((fn) => canvas.requestAnimationFrame(fn)) : ((fn) => setTimeout(() => fn(Date.now()), 16)));
    const nowMs = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

    // ---- screen state machine ----
    let screen = 'menu';            // 'menu' | 'playing' | 'gameover'
    let lastResult = null;          // data from onGameOver / daily complete
    let gameoverTitle = 'Game Over';
    let buttons = [];               // [{x,y,w,h,label,action}] rebuilt per frame

    function addBtn(label, x, y, w, h, action) {
      buttons.push({ x, y, w, h, label, action });
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    function drawButton(b) {
      ctx.save();
      ctx.fillStyle = '#9B6FC7';
      roundRect(ctx, b.x, b.y, b.w, b.h, 14);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px "Nunito", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.restore();
    }

    // ---- screens ----
    function drawMenu() {
      ctx.fillStyle = CONFIG.GAME.bgColor;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#C8A2E8';
      ctx.font = 'bold 46px "Nunito", Arial, sans-serif';
      ctx.fillText('EyeTrack', W / 2, H * 0.20);
      ctx.fillStyle = '#E8D5F5';
      ctx.font = '18px "Nunito", Arial, sans-serif';
      ctx.fillText('盯住小球，挑战你的记忆力', W / 2, H * 0.20 + 42);

      buttons = [];
      const bw = Math.min(280, W * 0.72);
      const bh = 56;
      const bx = (W - bw) / 2;
      let by = H * 0.40;
      addBtn('开始游戏', bx, by, bw, bh, () => startGame('campaign')); by += bh + 18;
      addBtn('每日挑战', bx, by, bw, bh, () => startGame('daily'));     by += bh + 18;
      addBtn('分享给好友', bx, by, bw, bh, () => P.shareNow('EyeTrack — 盯住小球，挑战你的记忆力'));
      for (const b of buttons) drawButton(b);
    }

    function drawGameOver() {
      ctx.fillStyle = CONFIG.GAME.bgColor;
      ctx.fillRect(0, 0, W, H);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#C8A2E8';
      ctx.font = 'bold 36px "Nunito", Arial, sans-serif';
      ctx.fillText(gameoverTitle, W / 2, H * 0.18);

      const lv = lastResult ? lastResult.level : 0;
      const acc = lastResult ? Math.round((lastResult.accuracy || 0) * 100) : 0;
      ctx.fillStyle = '#E8D5F5';
      ctx.font = '20px "Nunito", Arial, sans-serif';
      ctx.fillText('到达关卡 ' + lv, W / 2, H * 0.18 + 56);
      ctx.fillText('准确率 ' + acc + '%', W / 2, H * 0.18 + 88);

      buttons = [];
      const bw = Math.min(280, W * 0.72);
      const bh = 56;
      const bx = (W - bw) / 2;
      let by = H * 0.46;
      addBtn('返回主菜单', bx, by, bw, bh, () => { screen = 'menu'; }); by += bh + 18;
      addBtn('分享成绩', bx, by, bw, bh, () => P.shareNow('EyeTrack — 我在第 ' + lv + ' 关挑战成功！'));
      for (const b of buttons) drawButton(b);
    }

    // small "菜单" pill drawn on top of the playing board (top-left)
    function drawPlayUI() {
      ctx.save();
      ctx.fillStyle = 'rgba(155, 111, 199, 0.88)';
      roundRect(ctx, 12, 12, 66, 38, 12);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px "Nunito", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('菜单', 45, 31);
      ctx.restore();
      buttons = [{ x: 12, y: 12, w: 66, h: 38, label: '', action: () => { screen = 'menu'; } }];
    }

    // ---- game flow ----
    function startGame(mode) {
      screen = 'playing';
      buttons = [];
      engine.setMode(mode);
      P.analytics('game_start', { mode });
      if (mode === 'daily') engine.startLevel(16, true); // 每日固定 L16 起
      else engine.startLevel(1, false);
    }

    engine.onLevelComplete = (data) => {
      if (screen !== 'playing') return; // 已回菜单则忽略（防止 pending setTimeout 误触发）
      P.analytics('level_complete', { level: data.level });
      if (engine.isDailyChallenge) {
        globalThis.StorageManager.setDailyResult(data.level, data.accuracy);
        lastResult = data;
        gameoverTitle = '每日挑战完成 🎉';
        screen = 'gameover';
        return;
      }
      // campaign: keep climbing
      engine.startLevel(data.level + 1, false);
    };

    engine.onGameOver = (data) => {
      if (screen !== 'playing') return;
      P.analytics('game_over', { level: data.level, accuracy: data.accuracy });
      lastResult = data;
      gameoverTitle = 'Game Over';
      screen = 'gameover';
    };

    // ---- input: tap buttons, or forward ball taps to the engine ----
    P.onTouchStart((pt) => {
      for (const b of buttons) {
        if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) {
          b.action();
          return;
        }
      }
      if (screen === 'playing') {
        engine.handlePointerDown(pt.x, pt.y); // 画布即全屏，坐标直接对应
      }
    });

    // ---- main loop ----
    let lastTime = nowMs();
    function frame(now) {
      const dt = Math.min((now - lastTime) || 16, 100);
      lastTime = now;

      if (screen === 'playing') {
        engine.update(dt);
        engine.render();      // draws board + step hint (canvas mode)
        drawPlayUI();         // menu pill on top
      } else if (screen === 'menu') {
        drawMenu();
      } else {
        drawGameOver();
      }
      raf(frame);
    }
    raf(frame);

    // enable the platform's top-right share menu (optional)
    P.initShare('EyeTrack — 盯住小球，挑战你的记忆力');
  }

  // expose for the platform entry modules
  if (typeof module !== 'undefined' && module.exports) module.exports = { boot };
  globalThis.__bootMiniGame = boot;
})();

// ===== main.js =====
// === V2 Full Release ===
// EyeTrack — 入口接线（三模式）+ 首次游玩教程流程控制（全英文文案）
// === Tutorial === 教程仅在 localStorage 无记录时显示一次

// === Background Music (H5) === 三模式 BGM 由 bgmManager.js 管理（原生 Audio，
// 零依赖）。mp3 文件：assets/1.mp3(practice) / 2.mp3(campaign) / 3.mp3(daily)。
// 此处不再创建全局 Audio 对象；bgmManager 在用户手势内按需加载（见 warmUpBgm）。

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- engine ---------- */
  const canvas = document.getElementById('game-canvas');
  const engine = new GameEngine(canvas);

  /* ---------- element refs ---------- */
  const screenStart = document.getElementById('screen-start');
  const screenGameover = document.getElementById('screen-gameover');
  const screenTransition = document.getElementById('screen-transition');
  const hud = document.getElementById('hud');
  const hudLevel = document.getElementById('hud-level');
  const hudAccuracy = document.getElementById('hud-accuracy');
  const bestLine = document.getElementById('best-level');
  const btnPractice = document.getElementById('btn-practice'); // === Practice Mode + Unified Wallbounce ===
  const btnCampaign = document.getElementById('btn-campaign');
  const btnDaily = document.getElementById('btn-daily');
  const btnRetry = document.getElementById('btn-retry');
  const btnHome = document.getElementById('btn-home');
  const resultCardPreview = document.getElementById('result-card-preview');
  const goTitle = document.getElementById('gameover-title');
  const goResult = document.getElementById('gameover-result');
  const goAccuracy = document.getElementById('gameover-accuracy');
  const goDaily = document.getElementById('gameover-daily');
  const transitionLevel = document.getElementById('transition-level');

  /* ---------- tutorial refs ---------- */
  // === Anti-Crowd + Tutorial Choice ===
  const TUTORIAL_KEY = 'eyeTrack_tutorialSeen';
  const tutorialOverlay = document.getElementById('tutorial-overlay');
  const tutorialCanvas = document.getElementById('tutorial-canvas');
  const tutorialStep = document.getElementById('tutorial-step');
  const tutorialDots = Array.from(document.querySelectorAll('.tutorial-dots .dot'));
  const tutorialActions = document.getElementById('tutorial-actions');
  const btnTutorialReplay = document.getElementById('btn-tutorial-replay');
  const btnTutorialStart = document.getElementById('btn-tutorial-start');
  const btnTutorialClose = document.getElementById('btn-tutorial-close');
  const btnHelp = document.getElementById('btn-help');
  const btnMute = document.getElementById('btn-mute'); // 右上角静音开关
  // === V2 Full Release === English tutorial copy
  const TUTORIAL_STEPS = [
    'Remember the red-ringed balls',
    'They will swim around...',
    'After they stop, tap them!'
  ];
  let tutorialRafStop = null;  // runTutorial 返回的取消函数
  let tutorialTimer = null;    // 文字/圆点轮播定时器

  /* ---------- helpers ---------- */
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  function updateBest() {
    // bestLine 现为 #best-level 的 span（p 内含 "Best: Level " 前缀）
    bestLine.textContent = StorageManager.getBestLevel();
  }

  function updateHUD() {
    // === Practice Difficulty Select === 练习模式 HUD 显示「难度 · 关号」
    if (engine.mode === 'practice') {
      const diffLabel = engine.practiceDifficulty === 'easy' ? 'Easy'
                      : engine.practiceDifficulty === 'medium' ? 'Medium' : 'Hard';
      hudLevel.textContent = 'Practice · ' + diffLabel + ' · L' + engine.practiceLevel;
    } else {
      hudLevel.textContent = 'Level ' + engine.currentLevel;
    }
    hudAccuracy.textContent = 'Accuracy: ' + engine.getAccuracy() + '%';
  }

  function flashButton(id, text) {
    const btn = document.getElementById(id);
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = orig;
    }, 2000);
  }

  function showGameOver(title, data) {
    goTitle.textContent = title;
    goResult.textContent = 'You reached Level ' + data.level;
    goAccuracy.textContent = 'Accuracy: ' + data.accuracy + '%';
    if (data.isDaily) {
      show(goDaily);
      btnRetry.textContent = "📅 Tomorrow's Challenge";
    } else {
      hide(goDaily);
      btnRetry.textContent = '🔄 Retry';
    }

    // Render the 1080x1920 share card into the small preview canvas.
    const cardCanvas = ShareManager.generateResultCard({
      level: data.level,
      accuracy: data.accuracy,
      isDaily: data.isDaily
    });
    const pctx = resultCardPreview.getContext('2d');
    pctx.drawImage(cardCanvas, 0, 0, resultCardPreview.width, resultCardPreview.height);

    // Share row — rebound per round so the closures carry this run's data.
    document.getElementById('btn-save-image').onclick = () => {
      ShareManager.exportAsImage(cardCanvas);
      flashButton('btn-save-image', '✅ Saved!');
    };
    document.getElementById('btn-copy-link').onclick = () => {
      ShareManager.copyShareText({
        level: data.level,
        accuracy: data.accuracy,
        isDaily: data.isDaily
      })
        .then(() => flashButton('btn-copy-link', '✅ Copied!'))
        .catch(() => flashButton('btn-copy-link', '❌ Failed'));
    };
    document.getElementById('btn-native-share').onclick = async () => {
      const result = await ShareManager.shareWithFallback({
        level: data.level,
        accuracy: data.accuracy,
        isDaily: data.isDaily
      });
      if (result.method === 'download') flashButton('btn-native-share', '✅ Saved!');
    };

    hide(hud);
    show(screenGameover);
    updateBest();
  }

  // === Share Targets V2 === 分享工具函数（URL Intent 方式，纯前端，无 OAuth）
  function getShareText(seed, acc, mode) {
    // 文案规则：daily 含完整 seed；campaign 用 L 关卡号
    if (mode === 'daily') {
      return 'EyeTrack Daily ' + seed + ' · Acc ' + acc + '% · EyeTrack';
    }
    return 'EyeTrack Campaign ' + seed + ' · Acc ' + acc + '%';
  }

  function getShareUrl(mode, seed) {
    const base = window.location.origin + window.location.pathname;
    return base + '?seed=' + encodeURIComponent(seed || '') + '&mode=' + mode;
  }

  function openShare(target, text, url) {
    const fullText = text + ' ' + url;
    let intent = '';
    if (target === 'x') {
      intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url);
    } else if (target === 'reddit') {
      intent = 'https://www.reddit.com/submit?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text);
    } else if (target === 'whatsapp') {
      intent = 'https://wa.me/?text=' + encodeURIComponent(fullText);
    } else if (target === 'facebook') {
      intent = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
    }
    if (intent) window.open(intent, '_blank', 'width=600,height=400');
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Link copied!');
    });
  }

  function saveAsImage(canvasEl, filename) {
    const link = document.createElement('a');
    link.download = filename || 'eyetrack-result.png';
    link.href = canvasEl.toDataURL('image/png');
    link.click();
  }

  /* ---------- engine callbacks ---------- */
  engine.onPhaseChange = () => {
    updateHUD();
  };

  engine.onLevelComplete = (data) => {
    updateHUD();
    if (engine.isDailyChallenge) {
      // The daily is one-shot: record it and show the summary screen
      // instead of replaying the same seeded level in a loop.
      StorageManager.setDailyResult(data.level, data.accuracy);
      showGameOver('Daily Complete! 🎉', data);
      return;
    }
    const next = data.level + 1;
    transitionLevel.textContent = 'Level ' + next;
    show(screenTransition);
    setTimeout(() => {
      hide(screenTransition);
      engine.startLevel(next, false);
    }, 800);
  };

  // === Practice Mode + Unified Wallbounce === 练习模式绝不弹 Game Over
  engine.onGameOver = (data) => {
    if (data && data.mode === 'practice') return; // game.js 内已重开一局
    if (typeof bgmManager !== 'undefined') bgmManager.stopAndReset(); // === BGM (H5) === 游戏结束停乐并归零

    // === Global Leaderboard (Vercel KV) === 游戏结束写入成绩 + 拉取全球百分位。
    // 异步、不阻塞 UI；任何失败静默降级（不阻断游戏体验）。
    submitScore(data.mode, data.level, data.accuracy);

    updateHUD();
    showGameOver('Game Over', data);
  };

  // === Global Leaderboard === 提交成绩并拉取百分位，写入结果页
  function submitScore(mode, maxLevel, accuracy) {
    try {
      const payload = JSON.stringify({ mode, maxLevel, accuracy });
      fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      }).catch(() => {});
      // 计算该成绩对应的全球百分位，显示在结果页
      fetch('/api/rank?mode=' + encodeURIComponent(mode) +
            '&maxLevel=' + encodeURIComponent(maxLevel) +
            '&accuracy=' + encodeURIComponent(accuracy))
        .then((r) => r.json())
        .then((j) => {
          if (!j || j.ok === false) return;
          const el = document.getElementById('gameover-percentile');
          if (!el) return;
          if (j.total === 0 || j.percentile === null) {
            el.textContent = 'Be the first to rank!';
          } else {
            el.textContent = 'You beat ' + j.percentile + '% of players worldwide';
          }
          el.classList.remove('hidden');
        })
        .catch(() => {});
    } catch (e) { /* 静默降级 */ }
  }

  /* ---------- start-game actions ---------- */
  // === BGM (H5) === 首次用户手势预热：预加载三个 Audio 对象，并任选一个
  // play().catch(()=>{}) 后立刻 pause，解锁浏览器自动播放策略
  // （iOS/Safari 要求用户手势后才能出声）。幂等，只跑一次。
  let _bgmUnlocked = false;
  function warmUpBgm() {
    if (typeof bgmManager === 'undefined') return;
    // 预加载三首 Audio 对象（重复调用命中缓存，安全）
    bgmManager.preloadAll();
    if (_bgmUnlocked) return;
    _bgmUnlocked = true;
    // 解锁自动播放策略：play() 后【不要在同一同步帧立刻 pause】——
    // iOS/Safari 可能因此判定 play 从未真正开始，导致解锁失败、之后 MOVE
    // 阶段的 play() 仍被自动播放策略拦截（彻底静音）。改为延迟一帧再 pause。
    bgmManager.setMode('campaign');
    bgmManager.play();
    const a = bgmManager.currentAudio;
    if (a) {
      const deferPause = () => { try { a.pause(); } catch (e) {} };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(deferPause);
      else setTimeout(deferPause, 30);
    }
    // 调试钩子：浏览器控制台输入 window.__bgm 可自查当前状态
    if (typeof window !== 'undefined') window.__bgm = bgmManager;
  }

  function startNormalGame() {
    warmUpBgm();
    // === GA4 Events === 开始游戏埋点（Campaign 模式）
    if (typeof gtag !== 'undefined') gtag('event', 'game_start', { event_category: 'engagement', mode: 'campaign' });
    engine.setMode('campaign');
    if (typeof bgmManager !== 'undefined') bgmManager.setMode('campaign'); // === BGM (H5) ===
    hide(screenStart);
    show(hud);
    document.getElementById('btn-back').classList.remove('hidden'); // === Back to Menu ===
    engine.startLevel(1, false);
  }

  function startDailyGame() {
    warmUpBgm();
    // === GA4 Events === 开始游戏埋点（Daily 模式）
    if (typeof gtag !== 'undefined') gtag('event', 'game_start', { event_category: 'engagement', mode: 'daily' });
    engine.setMode('daily');
    if (typeof bgmManager !== 'undefined') bgmManager.setMode('daily'); // === BGM (H5) ===
    hide(screenStart);
    show(hud);
    document.getElementById('btn-back').classList.remove('hidden'); // === Back to Menu ===
    // === V2 Full Release === 每日挑战固定从第 15 关开始
    // === Daily starts at L16 === （seed = 'YYYY-MM-DD-L16'，关卡与目标布局全球一致）
    engine.startLevel(16, true);
  }

  // === Back to Menu === 游戏内返回主菜单：停循环 + 完全重置 + 显示主菜单
  function goToMenu() {
    if (typeof bgmManager !== 'undefined') bgmManager.stopAndReset(); // === BGM (H5) === 停乐并归零
    engine.stop();                      // 停止 requestAnimationFrame
    engine._levelClearToken++;          // 作废挂起的 Level Clear 停顿 setTimeout
    engine.phase = GameEngine.PHASE.IDLE;
    engine.selectedBalls = [];
    engine.resetAccuracy();             // 重置命中/失误统计
    // 清空画布
    const gc = document.getElementById('game-canvas');
    gc.getContext('2d').clearRect(0, 0, gc.width, gc.height);
    // 隐藏顶部步骤文字条，避免回主菜单后仍显示在棋盘上方
    hideGameStepText();
    // 隐藏返回按钮与 HUD，回到主菜单
    document.getElementById('btn-back').classList.add('hidden');
    hide(hud);
    show(screenStart);
  }

  document.getElementById('btn-back').addEventListener('click', () => {
    goToMenu();
  });

  /* ---------- tutorial flow (=== Anti-Crowd + Tutorial Choice ===) ---------- */
  function openTutorial(opts) {
    // opts: { onStart, markSeen, startLabel }
    tutorialOverlay.classList.remove('hidden');
    tutorialActions.classList.add('hidden');      // 开始时隐藏操作按钮
    btnTutorialStart.textContent = opts.startLabel || '▶ Start Game'; // === V2 Full Release ===

    let stepIdx = 0;
    let textTimer = null;

    function startAnimation() {
      const ctx = tutorialCanvas.getContext('2d');
      ctx.clearRect(0, 0, tutorialCanvas.width, tutorialCanvas.height);
      stepIdx = 0;
      tutorialStep.textContent = TUTORIAL_STEPS[0];
      tutorialDots.forEach((d, i) => d.classList.toggle('active', i === 0));
      tutorialActions.classList.add('hidden');

      // 演示动画；自然结束 → 显示操作按钮，停在结束画面
      tutorialRafStop = engine.runTutorial(tutorialCanvas, () => {
        tutorialActions.classList.remove('hidden');
        tutorialStep.textContent = 'Ready?'; // === V2 Full Release ===
        tutorialDots.forEach((d) => d.classList.remove('active'));
      });
    }

    // 文字自动切换（仅在前 3 步）
    function startTextTimer() {
      textTimer = setInterval(() => {
        if (tutorialActions.classList.contains('hidden')) {
          stepIdx = Math.min(stepIdx + 1, 2);
          tutorialStep.textContent = TUTORIAL_STEPS[stepIdx];
          tutorialDots.forEach((d, i) => d.classList.toggle('active', i === stepIdx));
        }
        if (stepIdx >= 2) clearInterval(textTimer);
      }, 1500);
    }

    startAnimation();
    startTextTimer();

    // 再看一遍（重新跑动画 + 文字轮播）
    btnTutorialReplay.onclick = () => {
      if (textTimer) clearInterval(textTimer);
      if (tutorialRafStop) tutorialRafStop();
      startAnimation();
      startTextTimer();
    };

    // 开始游戏 / 关闭
    btnTutorialStart.onclick = () => {
      if (textTimer) clearInterval(textTimer);
      if (tutorialRafStop) tutorialRafStop();
      tutorialOverlay.classList.add('hidden');
      if (opts.markSeen) {
        try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) { /* 隐私模式忽略 */ }
        try { localStorage.setItem(ONBOARD_KEY, 'true'); } catch (e) { /* 隐私模式忽略 */ } // === Onboarding + Rotate Warning === 看完教程也算「已引导」
        // === GA4 Events === 教程完成埋点
        if (typeof gtag !== 'undefined') gtag('event', 'tutorial_complete', { source: 'onboarding' });
      }
      if (typeof opts.onStart === 'function') opts.onStart();
    };

    // 关闭 ✕（不记录，下次还会自动弹）
    btnTutorialClose.onclick = () => {
      if (textTimer) clearInterval(textTimer);
      if (tutorialRafStop) tutorialRafStop();
      tutorialOverlay.classList.add('hidden');
    };
  }

  // 首次进入：结束画面「Start Game」直接开局并记录已看过
  function showTutorial() {
    // === GA4 Events === 教程开始埋点
    if (typeof gtag !== 'undefined') gtag('event', 'tutorial_begin', { source: 'onboarding' });
    openTutorial({ onStart: startNormalGame, markSeen: true, startLabel: '▶ Start Game' });
  }

  // 帮助入口：主菜单"?"按钮 → 打开自包含演示弹窗（不再复用首次教程）
  function showTutorialForHelp() {
    // === GA4 Events === 点击「?」帮助/演示按钮埋点
    if (typeof gtag !== 'undefined') gtag('event', 'open_help', { event_category: 'engagement' });
    openHelpDemo();
  }

  /* ---------- help demo (=== Refactor Tutorial Demo ===) ---------- */
  // 演示弹窗的 DOM（遮罩 + 400x300 小 Canvas + 关闭按钮 + 文字 div）全部由
  // JS 动态创建；与首次游玩教程（openTutorial / showTutorial）完全独立。
  let demoTextEl = null;      // 当前演示弹窗的文字 div，供 showTopText('demo') 写入
  let gameStepTextEl = null;  // 正式游戏顶部步骤文字条（在棋盘上方 HUD 与棋盘之间的条带）

  // 通用顶部文字函数：target 区分 'demo'（演示弹窗文字条）与 'game'（正式游戏
  // 顶部文字条）。演示与正式关卡共用同一入口。
  window.showTopText = function (text, duration, target) {
    if (target === 'demo') {
      if (demoTextEl) {
        demoTextEl.textContent = (text == null) ? '' : String(text);
        demoTextEl.style.color = '#FFFFFF'; // 每次写入重置默认白（成功/失败色由调用方覆盖）
      }
      return;
    }
    if (target === 'game') {
      // 截图里的"上方方框"在白色棋盘上方、HUD 下方的紫色条带，已超出 Canvas
      // 范围，因此正式游戏改用 JS 动态创建的 DOM 文字条；同时清空 engine._stepText
      // 防止 canvas 内重复绘制。
      if (engine) engine._stepText = '';
      const el = ensureGameStepText();
      if (el) {
        el.textContent = (text == null) ? '' : String(text);
        el.style.display = 'flex';
      }
      return;
    }
  };

  // 动态创建正式游戏顶部步骤文字条（插入 #game-container，位于 HUD 与棋盘之间），
  // 宽度与棋盘对齐，白字加粗 + 黑色描边式 text-shadow，任何背景下清晰。
  function ensureGameStepText() {
    if (gameStepTextEl) return gameStepTextEl;
    if (typeof document === 'undefined') return null;
    const container = document.getElementById('game-container');
    if (!container) return null;
    const el = document.createElement('div');
    el.id = 'game-step-text';
    // 放在 HUD 下方、白色棋盘上方的紫色条带中（截图红框位置）。
    // 不再 append 到容器末尾（会在 canvas 之后），而是插入到 #canvas-wrap 之前，
    // 确保自然叠在棋盘上方。
    el.style.cssText =
      'position:absolute;top:86px;left:50%;transform:translateX(-50%);' +
      'width:min(400px, 95vw);height:32px;display:flex;align-items:center;justify-content:center;' +
      'color:#FF0000;font-weight:800;font-size:22px;font-family:"SimSun","宋体",Georgia,serif;' +
      'text-shadow:0 0 6px rgba(255,255,255,0.6), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0,0,0,0.5);' +
      'pointer-events:none;z-index:100;text-align:center;box-sizing:border-box;padding:0 12px;';
    const canvasWrap = document.getElementById('canvas-wrap');
    if (canvasWrap) {
      container.insertBefore(el, canvasWrap);
    } else {
      container.appendChild(el);
    }
    gameStepTextEl = el;
    return el;
  }

  // 回主菜单时隐藏并清空顶部步骤文字条
  function hideGameStepText() {
    if (gameStepTextEl) {
      gameStepTextEl.textContent = '';
      gameStepTextEl.style.display = 'none';
    }
  }

  function openHelpDemo() {
    // 1. 动态创建遮罩层 + 容器 + 文字 div + 小 Canvas + 关闭按钮
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:2000;' +
      'display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText =
      'position:relative;width:400px;height:354px;background:#1a1030;' +
      'border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.5);' +
      'display:flex;flex-direction:column;';

    // 上方固定文字条（约 54px，半透明黑底，z-index 高于小 Canvas，永远在画面最上方，不遮挡球）
    const textDiv = document.createElement('div');
    textDiv.style.cssText =
      'flex:0 0 54px;height:54px;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,0.55);color:#fff;font-weight:700;font-size:17px;' +
      'font-family:"Nunito",Arial,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,0.6);' +
      'text-align:center;padding:0 12px;box-sizing:border-box;z-index:2;pointer-events:none;';

    // 下方演示动画区（400x300 小 Canvas，与文字条分上下两区，球绝不进入文字条）
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    canvas.style.cssText = 'display:block;width:400px;height:300px;flex:0 0 300px;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText =
      'position:absolute;top:8px;right:8px;width:30px;height:30px;border:none;' +
      'border-radius:50%;background:rgba(255,255,255,0.15);color:#fff;' +
      'font-size:20px;line-height:1;cursor:pointer;z-index:3;';
    closeBtn.title = 'Close';

    box.appendChild(textDiv);
    box.appendChild(canvas);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    demoTextEl = textDiv;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const r = 26;

    // 2. 4 个球：3 个标记（金边 + 星），1 个无标记；物理与正式游戏一致（线性 + 碰墙反弹）
    const demoBalls = [
      { x: W * 0.28, y: H * 0.45, vx:  1.6, vy:  1.2, marked: true  },
      { x: W * 0.55, y: H * 0.30, vx: -1.4, vy:  1.7, marked: true  },
      { x: W * 0.72, y: H * 0.62, vx:  1.3, vy: -1.6, marked: true  },
      { x: W * 0.40, y: H * 0.72, vx: -1.7, vy: -1.3, marked: false }
    ];

    // 3. 运行状态与清理登记
    const state = {
      running: true,
      moving: false,
      step: 1,
      successFlash: false,
      errorFlash: false,
      rafId: null,
      timers: []
    };
    const pushTimer = (id) => { state.timers.push(id); return id; };

    function clearAll() {
      state.running = false;
      if (state.rafId != null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(state.rafId);
      }
      state.timers.forEach((t) => clearTimeout(t));
      state.timers = [];
    }
    function removeAll() {
      clearAll();
      if (typeof bgmManager !== 'undefined') bgmManager.stopAndReset(); // === BGM (H5) === 关闭教程弹窗停乐并归零
      demoTextEl = null;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    closeBtn.addEventListener('click', removeAll);

    // 演示顶部文字统一走全局 showTopText('demo')（DOM 文字条，绝不用 ctx.fillText）
    const setStep = (t) => window.showTopText(t, 0, 'demo');
    // 成功/失败：写入文字后临时改色（覆盖 showTopText 的默认白）
    const setStepColor = (t, color) => {
      window.showTopText(t, 0, 'demo');
      if (demoTextEl) demoTextEl.style.color = color;
    };

    // 4. 步骤推进（Step 1 静止 → Step 2 运动 → Step 3 等待点击，循环）
    function enterStep(n) {
      state.step = n;
      if (n === 1) {
        state.moving = false;
        setStep('Remember these highlighted balls');
        pushTimer(setTimeout(() => { if (state.running) enterStep(2); }, 1800));
      } else if (n === 2) {
        state.moving = true;
        setStep('Watch them move');
        pushTimer(setTimeout(() => { if (state.running) enterStep(3); }, 1800));
      } else if (n === 3) {
        state.moving = false;
        setStep('Tap the original ones');
        // 等待用户点击（无定时器）
      }
    }

    // 5. 点击判定（仅 Step 3 且非反馈态生效）
    canvas.addEventListener('click', (e) => {
      if (state.step !== 3 || state.successFlash || state.errorFlash) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (W / rect.width);
      const y = (e.clientY - rect.top) * (H / rect.height);
      let hit = null;
      for (const b of demoBalls) {
        if (Math.hypot(b.x - x, b.y - y) <= r + 4) { hit = b; break; }
      }
      if (!hit) return; // 点空白忽略
      if (hit.marked) {
        state.successFlash = true;
        setStepColor('✓ Success', '#43E97B'); // 绿色成功反馈，写入上方文字条（DOM，非 Canvas）
        pushTimer(setTimeout(() => {
          if (!state.running) return;
          state.successFlash = false;
          enterStep(1);
        }, 1000));
      } else {
        state.errorFlash = true;
        setStepColor('✗ Try again', '#FF6B6B'); // 红色失败反馈 + 标记球闪红（见 drawDemoBall）
        pushTimer(setTimeout(() => {
          if (!state.running) return;
          state.errorFlash = false;
          enterStep(1);
        }, 1500));
      }
    });

    // 6. 绘制单个演示球（标记 = 金色发光边框 + 顶部 ★；错误反馈时整组变红）
    function drawDemoBall(b) {
      ctx.save();
      ctx.shadowColor = 'rgba(62,31,109,0.4)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 3;
      const grad = ctx.createRadialGradient(
        b.x - r * 0.35, b.y - r * 0.35, r * 0.05, b.x, b.y, r
      );
      grad.addColorStop(0, '#E8D5F5');
      grad.addColorStop(0.55, '#C8A2E8');
      grad.addColorStop(1, '#9B6FC7');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 高光点
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.arc(b.x - r * 0.3, b.y - r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (b.marked) {
        const ring = state.errorFlash ? '#FF1744' : '#FFD54F';
        ctx.save();
        ctx.shadowColor = ring;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = ring;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = ring;
        ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', b.x, b.y - r - 13);
        ctx.restore();
      }
    }

    // 7. 主循环（自动循环播放）
    let last = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    function loop(now) {
      if (!state.running) return;
      const dt = Math.min((now || last) - last, 100);
      last = now || last;
      const frameScale = (dt / 1000) * 60;

      if (state.moving) {
        for (const b of demoBalls) {
          b.x += b.vx * frameScale;
          b.y += b.vy * frameScale;
          if (b.x <= r)     { b.x = r;     b.vx =  Math.abs(b.vx); }
          if (b.x >= W - r) { b.x = W - r; b.vx = -Math.abs(b.vx); }
          if (b.y <= r)     { b.y = r;     b.vy =  Math.abs(b.vy); }
          if (b.y >= H - r) { b.y = H - r; b.vy = -Math.abs(b.vy); }
        }
      }

      ctx.clearRect(0, 0, W, H);
      for (const b of demoBalls) drawDemoBall(b);

      state.rafId = requestAnimationFrame(loop);
    }

    enterStep(1);
    state.rafId = requestAnimationFrame(loop);
  }

  /* ---------- start screen (=== Practice Mode + Unified Wallbounce ===) ---------- */
  // === Practice Difficulty Select === Practice 按钮 → 打开难度选择弹窗
  btnPractice.addEventListener('click', () => {
    document.getElementById('practice-modal').classList.remove('hidden');
  });

  // 难度选择 → 开始练习（隐藏弹窗 + 开始界面，显示 HUD，按难度随机选关）
  function startPracticeWithDifficulty(diff) {
    warmUpBgm();
    // === GA4 Events === 开始游戏埋点（Practice 模式）
    if (typeof gtag !== 'undefined') gtag('event', 'game_start', { event_category: 'engagement', mode: 'practice', difficulty: diff });
    if (typeof bgmManager !== 'undefined') bgmManager.setMode('practice'); // === BGM (H5) ===
    document.getElementById('practice-modal').classList.add('hidden');
    screenStart.classList.add('hidden');
    show(hud);
    document.getElementById('btn-back').classList.remove('hidden'); // === Back to Menu ===
    engine.setMode('practice');
    engine.setPracticeDifficulty(diff);
    engine.startPractice();
  }

  document.getElementById('btn-practice-easy').addEventListener('click', () => {
    // === GA4 Events === 选择难度埋点
    if (typeof gtag !== 'undefined') gtag('event', 'select_difficulty', { difficulty: 'easy' });
    startPracticeWithDifficulty('easy');
  });
  document.getElementById('btn-practice-medium').addEventListener('click', () => {
    // === GA4 Events === 选择难度埋点
    if (typeof gtag !== 'undefined') gtag('event', 'select_difficulty', { difficulty: 'medium' });
    startPracticeWithDifficulty('medium');
  });
  document.getElementById('btn-practice-hard').addEventListener('click', () => {
    // === GA4 Events === 选择难度埋点
    if (typeof gtag !== 'undefined') gtag('event', 'select_difficulty', { difficulty: 'hard' });
    startPracticeWithDifficulty('hard');
  });

  // 取消按钮 → 关闭弹窗，留在开始界面
  document.getElementById('btn-practice-cancel').addEventListener('click', () => {
    document.getElementById('practice-modal').classList.add('hidden');
  });

  // 闯关模式
  btnCampaign.addEventListener('click', () => {
    if (!localStorage.getItem(TUTORIAL_KEY)) {
      showTutorial();
      return;
    }
    startNormalGame();
  });

  // 每日挑战
  btnDaily.addEventListener('click', () => {
    // === GA4 Events === 选择每日挑战埋点
    if (typeof gtag !== 'undefined') {
      const today = new Date().toISOString().slice(0, 10);
      gtag('event', 'select_content', {
        content_type: 'daily_challenge',
        item_id: 'daily_' + today
      });
    }
    startDailyGame();
  });

  // 开始界面「如何游玩」帮助按钮 → 打开教程（不自动开局）
  if (btnHelp) {
    btnHelp.addEventListener('click', showTutorialForHelp);
  }

  // 右上角静音开关：切换全局 muted 状态（作用于 audio.muted，非 volume=0），
  // 图标同步 🔊 ↔ 🔇。与游戏逻辑完全解耦——不触发小球运动/停止/任何玩法。
  function updateMuteIcon() {
    if (!btnMute) return;
    const muted = (typeof bgmManager !== 'undefined') && bgmManager.isMuted();
    btnMute.textContent = muted ? '🔇' : '🔊';
    btnMute.title = muted ? 'Unmute' : 'Mute';
  }
  if (btnMute) {
    btnMute.addEventListener('click', () => {
      if (typeof bgmManager === 'undefined') return;
      bgmManager.setMuted(!bgmManager.isMuted());
      updateMuteIcon();
    });
    updateMuteIcon(); // 初始为 🔊（未静音）
  }

  /* ---------- game over screen ---------- */
  btnRetry.addEventListener('click', () => {
    if (engine.isDailyChallenge) {
      alert('Come back tomorrow!');
      return;
    }
    hide(screenGameover);
    show(hud);
    engine.startLevel(engine.currentLevel, false);
  });

  btnHome.addEventListener('click', () => {
    hide(screenGameover);
    engine.stop();
    hide(hud);
    show(screenStart);
    updateBest();
  });

  // === Share Targets V2 === 社交分享按钮事件绑定（URL Intent 方式，纯前端）
  // 社交平台按钮：循环绑定 data-target
  document.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      const seed = engine.dailySeed || ('L' + engine.currentLevel);
      const acc = engine.getAccuracy(); // game.js 实际字段：accuracyTracker.hits/misses
      const mode = engine.mode || 'campaign';
      const text = getShareText(seed, acc, mode);
      const url = getShareUrl(mode, seed);
      openShare(target, text, url);
    });
  });

  // 复制链接（V2 新 ID，避免与原 btn-copy-link 冲突）
  document.getElementById('btn-copy-link-v2').addEventListener('click', () => {
    const seed = engine.dailySeed || ('L' + engine.currentLevel);
    const acc = engine.getAccuracy();
    const mode = engine.mode || 'campaign';
    const text = getShareText(seed, acc, mode);
    const url = getShareUrl(mode, seed);
    copyToClipboard(url);
  });

  // 保存图片（V2 新 ID，从 game-canvas 截图加水印导出）
  document.getElementById('btn-save-image-v2').addEventListener('click', () => {
    const canvasEl = document.getElementById('result-canvas');
    const gameCanvas = document.getElementById('game-canvas'); // 实际 canvas id 为 game-canvas
    canvasEl.width = gameCanvas.width;
    canvasEl.height = gameCanvas.height;
    const ctx2 = canvasEl.getContext('2d');
    ctx2.drawImage(gameCanvas, 0, 0);
    const seed = engine.dailySeed || ('L' + engine.currentLevel);
    const acc = engine.getAccuracy();
    ctx2.fillStyle = 'rgba(0,0,0,0.6)';
    ctx2.fillRect(0, canvasEl.height - 40, canvasEl.width, 40);
    ctx2.fillStyle = '#FFF';
    ctx2.font = 'bold 18px Nunito, sans-serif';
    ctx2.fillText('EyeTrack · ' + seed + ' · Acc ' + acc + '%', 12, canvasEl.height - 14);
    saveAsImage(canvasEl, 'eyetrack-' + seed + '.png');
  });

  /* ---------- pointer input (mouse + touch unified) ---------- */
  function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX, clientY;
    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const pos = getPointerPos(e);
    engine.handlePointerDown(pos.x, pos.y);
  });

  /* ---------- onboarding + orientation (=== Onboarding + Rotate Warning ===) ---------- */
  const ONBOARD_KEY = 'eyeTrack_onboarded';
  const isFirstVisit = !localStorage.getItem(ONBOARD_KEY);

  // 检测横屏/竖屏
  // 用户反馈：手机横版提示在主菜单并不合适，因此始终隐藏 #rotate-warning。
  function checkOrientation() {
    const warning = document.getElementById('rotate-warning');
    if (warning) warning.classList.add('hidden');
  }

  // 初始检测 + 监听变化
  checkOrientation();
  window.addEventListener('orientationchange', checkOrientation);
  window.addEventListener('resize', checkOrientation);

  // === Share Targets V2 === 分享链接（?seed=...&mode=daily）直接进入 daily 关卡，跳过引导页
  const autoDaily = engine.handleUrlParams();
  if (autoDaily) {
    document.getElementById('onboarding-overlay').classList.add('hidden');
    document.getElementById('screen-start').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
  } else if (isFirstVisit) {
    document.getElementById('onboarding-overlay').classList.remove('hidden');
    document.getElementById('screen-start').classList.add('hidden');
  }

  // 引导页「开始游戏」→ 标记已引导 → 显示开始界面
  document.getElementById('btn-onboarding-start').addEventListener('click', () => {
    try { localStorage.setItem(ONBOARD_KEY, 'true'); } catch (e) { /* 隐私模式忽略 */ }
    document.getElementById('onboarding-overlay').classList.add('hidden');
    document.getElementById('screen-start').classList.remove('hidden');
  });

  // 引导页「看演示」→ 打开教程（复用已有流程，需先显示 screen-start 让教程可见）
  document.getElementById('btn-onboarding-replay').addEventListener('click', () => {
    document.getElementById('onboarding-overlay').classList.add('hidden');
    screenStart.classList.remove('hidden');
    showTutorial();
  });

  /* ---------- Global Leaderboard (Vercel KV) ---------- */
  // 首页滚动全球榜：轮询 /api/rank，渲染 Top 50；空榜诚实显示占位。
  // 纯 CSS 滚动动画（.leaderboard-list 的 marquee），不碰游戏主循环。
  function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    fetch('/api/rank')
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.ok === false || !Array.isArray(j.top) || j.top.length === 0) {
          list.innerHTML = '<li class="leaderboard-empty">Be the first to rank!</li>';
          return;
        }
        const rows = j.top.map((p) => {
          const modeIcon = p.mode === 'campaign' ? '▶' : p.mode === 'daily' ? '📅' : '🏋️';
          return '<li class="leaderboard-row">' +
            '<span class="lb-rank">#' + p.rank + '</span>' +
            '<span class="lb-tag">' + p.anonTag + '</span>' +
            '<span class="lb-mode">' + modeIcon + '</span>' +
            '<span class="lb-level">L' + p.maxLevel + '</span>' +
            '<span class="lb-acc">' + p.accuracy + '%</span>' +
            '</li>';
        }).join('');
        // 复制一份实现无缝循环滚动
        list.innerHTML = rows + rows;
      })
      .catch(() => {
        list.innerHTML = '<li class="leaderboard-empty">Be the first to rank!</li>';
      });
  }

  // 每 30 秒刷新一次（榜单一变化即更新，又不至于压垮 KV）
  function startLeaderboardPoll() {
    renderLeaderboard();
    setInterval(renderLeaderboard, 30000);
  }
  startLeaderboardPoll();

  /* ---------- boot ---------- */
  updateBest();
});

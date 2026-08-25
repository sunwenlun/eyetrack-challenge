// Headless smoke tests for game.js (trajectory system). Not part of the game.
// Simulate browser globals: levels.js resolves CONFIG via window/globalThis
// only (no Node require fallback), so we wire them up before loading game.js.
globalThis.CONFIG = require('./config.js');
globalThis.Levels = require('./levels.js');
const GameEngine = require('./game.js');
const PHASE = GameEngine.PHASE;

// Fake canvas with a no-op 2d context (property sets allowed under strict mode)
function fakeCanvas(w, h) {
  const noop = () => {};
  const gradStub = { addColorStop: noop };
  const ctx = new Proxy({}, {
    get: (_, prop) => {
      // gradient creators must return an object with addColorStop()
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => gradStub;
      }
      return noop;
    },
    set: () => true
  });
  return { width: w, height: h, getContext: () => ctx };
}

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + label);
  if (!cond) failures++;
}

/** Drives an engine from startLevel to the INPUT phase. */
function driveToInput(eng, moveMs) {
  eng.update(2000); // SHOW -> TRANSITION
  eng.update(500); // TRANSITION -> MOVE
  for (let t = 0; t < moveMs + 16.7; t += 16.7) eng.update(16.7); // MOVE -> STOP
  eng.update(16.7); // STOP -> INPUT (single frame)
}

/* ==================== levels.js (new schema) ==================== */

const lc1 = Levels.getLevelConfig(1);
check('L1 mot schema fields', lc1.trajType === 'mot' && lc1.freqRange === 0.4 && lc1.ampRange === 40 && lc1.noiseAmount === 0 && lc1.noiseSpeed === 0);
check('L1 has 8 balls / 3360ms', lc1.ballCount === 8 && lc1.duration === 3360);
const lc15 = Levels.getLevelConfig(15);
check('L15 mot + noise fields', lc15.trajType === 'mot' && lc15.noiseAmount === 35 && lc15.noiseSpeed === 1.5);
const dl = Levels.generateDailyLevel();
check('daily carries traj fields', typeof dl.trajType === 'string' && typeof dl.freqRange === 'number' && typeof dl.ampRange === 'number' && Array.isArray(dl.targets));
// === Daily starts at L16 === daily is fixed at L16, seed = 'YYYY-MM-DD-L16'
check('daily fixed at L16 with -L16 seed', dl.level === 16 && /-L16$/.test(dl.seed));
console.log('     daily today: L' + dl.level, dl.trajType, 'seed=' + dl.seed, 'targets=' + JSON.stringify(dl.targets));

/* ==================== V2: 30 levels + infinite + distractions ==================== */

check('L30 exists with mot cap params', Levels.getLevelConfig(30).level === 30 && Levels.getLevelConfig(30).ballCount === 10);
check('L1-L15 carry empty distractions', [1, 5, 10, 15].every((n) => Levels.getLevelConfig(n).distractions.length === 0));
// === Distraction Overhaul V2 === speedMult 梯度（L16=1.2 → L30=2.6，每关 +0.1）
const lc16 = Levels.getLevelConfig(16);
check('L16 has brain distraction (speedMult 1.2, color)', lc16.distractions.length === 1 && lc16.distractions[0].type === 'brain' && lc16.distractions[0].opacity === 0.15 && lc16.distractions[0].speedMult === 1.2 && lc16.distractions[0].color === '#2D2040');
const lc21 = Levels.getLevelConfig(21);
check('L21 has brain + rotating star (speedMult 1.7, sizeMult 1.5)', lc21.distractions.length === 2 && lc21.distractions[1].type === 'star' && lc21.distractions[1].rotation === true && lc21.distractions[1].speedMult === 1.7 && lc21.distractions[1].sizeMult === 1.5);
const lc26 = Levels.getLevelConfig(26);
check('L26 has brain + star + earth (speedMult 2.2)', lc26.distractions.length === 3 && lc26.distractions[2].type === 'earth' && lc26.distractions.every((d) => d.speedMult === 2.2));
check('speedMult gradient +0.1/level, L30 = 2.6', (() => {
  for (let n = 16; n <= 30; n++) {
    const want = Math.round((1.2 + (n - 16) * 0.1) * 10) / 10;
    const ds = Levels.getLevelConfig(n).distractions;
    if (!ds.every((d) => d.speedMult === want)) return false;
  }
  return true;
})());
const lcInf = Levels.getLevelConfig(42);
check('infinite mode: L42 = L30 params, level number 42, speedMult capped 2.6', lcInf.level === 42 && lcInf.speed === 3.2 && lcInf.ballCount === 10 && lcInf.distractions.length === 3 && lcInf.distractions[0].speedMult === 2.6);
const lcInf2 = Levels.getLevelConfig(999);
check('infinite mode: L999 still capped, own copy', lcInf2.level === 999 && lcInf2.distractions !== lcInf.distractions);

/* ==================== Phase machine regression ==================== */

const eng = new GameEngine(fakeCanvas(400, 560));
const seen = [];
eng.onPhaseChange = (p) => seen.push(p);
eng.startLevel(1);
check('L1 spawns 8 balls', eng.balls.length === 8);
check('L1 has 3 targets', eng.balls.filter((b) => b.isTarget).length === 3);
check(
  'balls carry mot (swim) params',
  eng.balls.every((b) => b.trajType === 'mot' && b.swimAmp > 0 && b.swimFreq > 0 && b.speedFactor > 0 && typeof b.burstT === 'number' && b.angle >= 0)
);
driveToInput(eng, eng.levelConfig.duration);
check('phase sequence 1>2>3>4>5', seen.join('>') === '1>2>3>4>5');
check('STOP auto-advances to INPUT', eng.phase === PHASE.INPUT);
check('labels assigned 1..N', eng.balls.every((b, i) => b.numberLabel === i + 1));

/* ==================== Trajectory system ==================== */

// --- travel: every ball actually moves during MOVE ---
const eng5 = new GameEngine(fakeCanvas(400, 560));
eng5.startLevel(1);
eng5.update(2000);
eng5.update(500);
const p0 = eng5.balls.map((b) => ({ x: b.x, y: b.y }));
let travel = 0;
const prev = eng5.balls.map((b) => ({ x: b.x, y: b.y }));
for (let t = 0; t < 1000; t += 16.7) {
  eng5.update(16.7);
  eng5.balls.forEach((b, i) => {
    travel += Math.hypot(b.x - prev[i].x, b.y - prev[i].y);
    prev[i] = { x: b.x, y: b.y };
  });
}
console.log('     total travel in 1s: ' + travel.toFixed(0) + 'px across ' + eng5.balls.length + ' balls');
check('balls travel during MOVE (>100px total)', travel > 100);

// --- bounds: L13 (12 balls, wallbounce) stays inside the board ---
const eng6 = new GameEngine(fakeCanvas(400, 560));
eng6.startLevel(13);
eng6.update(2000);
eng6.update(500);
let inBounds = true;
for (let t = 0; t < 5000; t += 16.7) {
  eng6.update(16.7);
  for (const b of eng6.balls) {
    if (b.x < 0 || b.x > 400 || b.y < 0 || b.y > 560) { inBounds = false; break; }
  }
}
check('L13 stays in bounds for full MOVE', inBounds);

/* ==================== Collision check (design guarantee) ==================== */
// === V2 Full Release === extended to all 30 levels (L16+ add distractions,
// which are visual-only and must not affect the zero-overlap invariant).
let totalOverlaps = 0;
for (let n = 1; n <= 30; n++) {
  const cg = new GameEngine(fakeCanvas(400, 560));
  cg.startLevel(n);
  cg.update(2000); // SHOW -> TRANSITION
  cg.update(500);  // -> MOVE
  const dur = cg.levelConfig.duration;
  const rr = cg.balls[0].radius;
  let overlapFrames = 0;
  for (let t = 0; t < dur + 16.7; t += 16.7) {
    cg.update(16.7);
    const bs = cg.balls;
    let overlap = false;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        if (Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y) < rr * 2 - 0.01) { overlap = true; break; }
      }
      if (overlap) break;
    }
    if (overlap) overlapFrames++;
  }
  totalOverlaps += overlapFrames;
  console.log('     L' + n + ': ' + overlapFrames + ' overlap frame(s)');
}
console.log('     TOTAL overlap frames across 30 levels: ' + totalOverlaps);
check('design guarantee: no ball overlap during MOVE (all 30 levels)', totalOverlaps === 0);

/* ==================== V2: distraction engine behaviour ==================== */

// === Distraction Overhaul V2 === 无规则游荡：随机全场出生、朝目标点匀速推进、
// speedMult 驱动实际速度、visualSize = 22*2*sizeMult、始终在界内。
const de = new GameEngine(fakeCanvas(400, 560));
de.startLevel(16);
check('L16 engine spawns 1 distraction', de.distractions.length === 1 && de.distractions[0].type === 'brain');
const b0 = de.distractions[0];
check('distraction spawns ON board (random)', b0.x >= 0 && b0.x <= 400 && b0.y >= 0 && b0.y <= 560);
check('distraction carries wander fields', typeof b0.targetX === 'number' && typeof b0.targetY === 'number' && b0.wanderInterval >= 60 && b0.wanderInterval < 180 && b0.speedMult === 1.2);
check('brain visualSize = 22*2*1.5 = 66', b0.visualSize === 66);
const dp0 = { x: b0.x, y: b0.y };
de.update(2000); // SHOW — distraction wanders during memorize phase too
check('distraction wanders during SHOW', Math.hypot(b0.x - dp0.x, b0.y - dp0.y) > 1);
de.update(500);  // -> MOVE
const dp1 = { x: b0.x, y: b0.y };
// 步进跟踪总路程：speedMult 驱动的实际速度 = 3.2*1.2 = 3.84px/帧 ≈ 230px/s
let dTravel = 0, dPrev = { x: b0.x, y: b0.y }, dInBounds = true;
for (let t = 0; t < 1000; t += 16.7) {
  de.update(16.7);
  dTravel += Math.hypot(b0.x - dPrev.x, b0.y - dPrev.y);
  dPrev = { x: b0.x, y: b0.y };
  if (b0.x < 0 || b0.x > 400 || b0.y < 0 || b0.y > 560) dInBounds = false;
}
console.log('     distraction travel in 1s: ' + dTravel.toFixed(0) + 'px (expect ~230px at 3.2x1.2)');
check('distraction wanders during MOVE at speedMult pace (>100px/s)', dTravel > 100);
check('distraction stays in bounds', dInBounds);

const de2 = new GameEngine(fakeCanvas(400, 560));
de2.startLevel(26);
check('L26 engine spawns 3 distractions (brain/star/earth)',
  de2.distractions.length === 3 && de2.distractions.map((d) => d.type).join() === 'brain,star,earth');
const starD = de2.distractions[1];
const starA0 = starD.angle;
de2.update(2000);
check('rotating star accumulates angle', starD.rotation === true && starD.angle !== starA0);
// L26 speedMult 梯度体现在引擎实例上
check('L26 sprites carry speedMult 2.2', de2.distractions.every((d) => d.speedMult === 2.2));
let distractRenderOk = true;
try { de2.render(); de2.update(500); de2.render(); } catch (e) { distractRenderOk = false; console.log('     distraction render error: ' + e.message); }
check('render() no-throw with all 3 distraction types', distractRenderOk);
check('L1 engine has no distractions', (() => { const z = new GameEngine(fakeCanvas(400, 560)); z.startLevel(1); return z.distractions.length === 0; })());

// --- 改动 4：网格排布，出生不重叠（>= 2*radius 即可）---
const ce = new GameEngine(fakeCanvas(400, 560));
ce.startLevel(1);
const rSpawn = ce.balls[0].radius;
let minPair = Infinity;
for (let i = 0; i < ce.balls.length; i++) {
  for (let j = i + 1; j < ce.balls.length; j++) {
    const d = Math.hypot(ce.balls[i].x - ce.balls[j].x, ce.balls[i].y - ce.balls[j].y);
    if (d < minPair) minPair = d;
  }
}
console.log('     min spawn gap: ' + minPair.toFixed(1) + 'px (require >= ' + (rSpawn * 2).toFixed(1) + ')');
check('spawn spacing >= 2*radius (no initial overlap)', minPair >= rSpawn * 2 - 0.5);

// --- 改动 2：匀速运动（不再有 ease-in-out 缓动）---
function travelMs(e, ms) {
  let dist = 0;
  const prev = e.balls.map((b) => ({ x: b.x, y: b.y }));
  for (let t = 0; t < ms; t += 16.7) {
    e.update(16.7);
    e.balls.forEach((b, i) => {
      dist += Math.hypot(b.x - prev[i].x, b.y - prev[i].y);
      prev[i] = { x: b.x, y: b.y };
    });
  }
  return dist;
}
const ez = new GameEngine(fakeCanvas(400, 560));
ez.startLevel(1);
ez.update(2000);
ez.update(500); // -> MOVE
const early = travelMs(ez, 150);
travelMs(ez, 1000);
const mid = travelMs(ez, 150);
console.log('     travel: early=' + early.toFixed(1) + 'px mid=' + mid.toFixed(1) + 'px (wallbounce 模型，持续运动)');
check('balls keep moving (orbit model, no stall)', early > 1 && mid > 1);
check('ease fields removed (moveDuration undefined)', typeof ez.moveDuration === 'undefined');

/* ==================== Daily determinism ==================== */

const snap = (e) =>
  JSON.stringify(
    e.balls.map((b) => [
      b.x.toFixed(4), b.y.toFixed(4), b.angle.toFixed(4), (b.swimAmp ?? b.wobbleAmp ?? 0).toFixed(4),
      (b.swimFreq ?? b.wobbleFreq ?? 0).toFixed(6), b.trajType, b.isTarget,
    ])
  );
const e1 = new GameEngine(fakeCanvas(400, 560));
const e2 = new GameEngine(fakeCanvas(400, 560));
e1.startLevel(1, true);
e2.startLevel(999, true);
check('daily layout identical across engines', snap(e1) === snap(e2));

/* ==================== Input & result (regression) ==================== */

let completePayload = null;
eng.onLevelComplete = (p) => { completePayload = p; };
const targets = eng.balls.filter((b) => b.isTarget);
targets.forEach((b) => eng.handlePointerDown(b.x, b.y));
check('3 correct picks -> RESULT', eng.phase === PHASE.RESULT);
check('picked targets ring green', targets.every((b) => b.selectedState === 1));
// === Level Clear Pause === onLevelComplete 现由 1s 停顿后的 setTimeout 异步触发，
// 故延后到定时器回调里校验（不改动游戏逻辑，仅让回归断言匹配新的异步行为）。
setTimeout(() => {
  check(
    'complete payload {level, accuracy, isDaily}',
    completePayload && completePayload.level === 1 && completePayload.accuracy === 100 && completePayload.isDaily === false
  );
}, 1100);

const eng2 = new GameEngine(fakeCanvas(400, 560));
let overPayload = null;
eng2.onGameOver = (p) => { overPayload = p; };
eng2.startLevel(1);
driveToInput(eng2, eng2.levelConfig.duration);
const t2 = eng2.balls.filter((b) => b.isTarget);
const nt2 = eng2.balls.filter((b) => !b.isTarget);
eng2.handlePointerDown(t2[0].x, t2[0].y);
eng2.handlePointerDown(nt2[0].x, nt2[0].y);
eng2.handlePointerDown(t2[1].x, t2[1].y);
check('mixed picks -> RESULT + gameover accuracy 67', eng2.phase === PHASE.RESULT && overPayload && overPayload.accuracy === 67);
check('wrong ball rings red', nt2[0].selectedState === 2);

// guards
const eng3 = new GameEngine(fakeCanvas(400, 560));
eng3.startLevel(1);
eng3.handlePointerDown(eng3.balls[0].x, eng3.balls[0].y);
check('click during SHOW ignored', eng3.selectedBalls.length === 0);
driveToInput(eng3, eng3.levelConfig.duration);
const tg = eng3.balls.find((b) => b.isTarget);
eng3.handlePointerDown(tg.x, tg.y);
eng3.handlePointerDown(tg.x, tg.y);
eng3.handlePointerDown(-50, -50);
check('duplicate + empty clicks ignored', eng3.selectedBalls.length === 1 && eng3.accuracyTracker.hits === 1);

// audio headless
let audioOk = true;
try {
  eng3._initAudio();
  eng3._playTone([880], 0.1);
  eng3._playTone([523.25, 659.25, 783.99], 0.1);
} catch (e) { audioOk = false; }
check('headless audio no-throw', audioOk);

// render smoke across phases
let renderOk = true;
try {
  const r = new GameEngine(fakeCanvas(400, 560));
  r.render();
  r.startLevel(1);
  r.render();
  r.update(2000); r.render();
  r.update(500); r.render();
  for (let t = 0; t < 2500; t += 16.7) r.update(16.7);
  r.render();
  r.update(16.7); r.render();
  r.balls.filter((b) => b.isTarget).forEach((b) => r.handlePointerDown(b.x, b.y));
  r.render();
} catch (e) {
  renderOk = false;
  console.log('     render error: ' + e.message);
}
check('render() no-throw on all phases', renderOk);

// === Level Clear Pause === 等待 1s 停顿相关的异步断言（如 complete payload）落地后再汇总
setTimeout(() => {
  console.log('----------------------------------------');
  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}, 1200);

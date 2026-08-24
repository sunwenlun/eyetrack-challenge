// ===== bgmManager.js =====
// 三模式背景音乐管理器（原生 Audio API，零第三方依赖）。
//
// 对外暴露的方法：
//   setMode(mode)      // 'practice' | 'campaign' | 'daily' —— 切换模式并加载对应 mp3
//   play()             // 小球开始运动时调用（仅在 audio.paused 时 play，音量复位 0.19）
//   duck()             // 小球停止等待点击时调用（音量减半为 0.095，不 pause）
//   pause()            // 纯暂停（仅用于解锁/内部，小球停止请改用 duck）
//   stopAndReset()     // 返回菜单 / 游戏结束 / 关闭教程（pause + currentTime=0 + 音量复位）
//   isMuted()/setMuted(m) // 全局静音开关，作用于 audio.muted（非 volume=0）
//
// 内部状态：currentAudio / currentMode / volume(0.19) / muted(false)。
// 跨环境安全：无 window / 无 Audio API / mp3 缺失时所有方法静默 no-op，
// 不影响任何玩法逻辑（物理、教程、返回键、GA4 等完全不受牵连）。
(function (root) {
  'use strict';

  /** @type {{practice:string, campaign:string, daily:string}} 模式 → mp3 文件 */
  const MODE_FILES = {
    practice: 'assets/1.mp3',
    campaign: 'assets/2.mp3',
    daily: 'assets/3.mp3'
  };

  const manager = {
    /** @type {Audio|null} 当前模式的 Audio 对象 */
    currentAudio: null,
    /** @type {'practice'|'campaign'|'daily'|null} */
    currentMode: null,
    /** 统一音量（运动状态基准），比人声略低。静止状态为 volume*0.5。 */
    volume: 0.19,
    /** 全局静音标志：true 时 audio.muted=true（保留音量层级，仅不出声） */
    muted: false,
    /** @private @type {Object<string,Audio>} 预加载缓存：mode -> Audio */
    _audios: {},

    /**
     * 切换模式并加载对应 mp3。若当前有音乐在播，先 pause()+currentTime=0。
     * @param {'practice'|'campaign'|'daily'} mode
     * @returns {void}
     */
    setMode(mode) {
      if (this.currentAudio) {
        // 切换前 stopAndReset：pause + currentTime=0 + volume 复位 0.19
        try {
          this.currentAudio.pause();
          this.currentAudio.currentTime = 0;
          this.currentAudio.volume = this.volume;
        } catch (e) { /* 忽略 */ }
      }
      this.currentMode = mode;
      this.currentAudio = this._getAudio(mode); // 新 Audio 默认 volume=0.19，muted 继承当前标志
    },

    /**
     * 预加载三个 Audio 对象（首次用户手势内调用，解锁自动播放策略）。
     * 已加载的会命中缓存，重复调用安全。
     * @returns {void}
     */
    preloadAll() {
      ['practice', 'campaign', 'daily'].forEach((m) => this._getAudio(m));
    },

    /**
     * 小球开始运动时调用（startMoving）：恢复为正常背景音量 0.19，
     * 且仅在 audio.paused 时 play，包 .catch 避免 iOS/Safari 自动播放
     * 拦截导致崩溃。绝不在此反复调用。
     * @returns {void}
     */
    play() {
      if (!this.currentAudio) return;
      try {
        this.currentAudio.volume = this.volume; // 复位到正常音量 0.19
        this.currentAudio.muted = this.muted;   // 同步全局静音标志
      } catch (e) {}
      if (this.currentAudio.paused) {
        const p = this.currentAudio.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    },

    /**
     * 小球停止等待点击时调用（stopForSelection）：音量减半为 0.095 作为氛围底噪，
     * ❌ 不 pause()，❌ 不动 currentTime，音乐持续低声播放。
     * 仅在状态切换点调用，绝不在 RAF 内反复设置。
     * @returns {void}
     */
    duck() {
      if (!this.currentAudio) return;
      try {
        this.currentAudio.volume = this.volume * 0.5; // 0.19 -> 0.095
        this.currentAudio.muted = this.muted;         // 同步全局静音标志
      } catch (e) {}
    },

    /**
     * 纯暂停（不复位音量 / 不复位 currentTime）。仅用于首次用户手势解锁
     * （play 后立刻 pause 触发浏览器自动播放策略），以及 stopAndReset 内部。
     * 注意：小球停止等待点击时【不要】用本方法，改用 duck()（音量减半）。
     * @returns {void}
     */
    pause() {
      if (!this.currentAudio) return;
      try { this.currentAudio.pause(); } catch (e) { /* 忽略 */ }
    },

    /**
     * 返回主菜单 / 游戏结束 / 关闭教程时调用（returnToMenu）。
     * audio.pause(); audio.currentTime = 0; audio.volume = 0.19（复位音量，
     * 为下次进入做准备）。静音标志 muted 不在此重置——用户设置持久保留。
     * @returns {void}
     */
    stopAndReset() {
      if (!this.currentAudio) return;
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.volume = this.volume; // 复位音量，下次进入为正常 0.19
      } catch (e) { /* 忽略 */ }
    },

    /**
     * 读取当前全局静音状态。
     * @returns {boolean}
     */
    isMuted() {
      return this.muted;
    },

    /**
     * 设置全局静音状态（muted ↔ unmuted）。
     * - 若当前有 BGM 在播（无论运动/静止）：立即同步 audio.muted，音乐继续播放只是无声。
     * - 若当前无 BGM（返回菜单）：仅切换标志，下次播放时由 _getAudio / play / duck 继承。
     * 模式切换 / 返回菜单 / 教程弹窗均不改变此状态（用户设置持久保留）。
     * @param {boolean} m
     * @returns {void}
     */
    setMuted(m) {
      this.muted = !!m;
      if (this.currentAudio) {
        try { this.currentAudio.muted = this.muted; } catch (e) { /* 忽略 */ }
      }
    },

    /**
     * 取（或创建）某模式的 Audio 对象。缺失/异常时返回 null（静默失败）。
     * @param {'practice'|'campaign'|'daily'} mode
     * @returns {Audio|null}
     * @private
     */
    _getAudio(mode) {
      if (this._audios[mode]) return this._audios[mode];
      const src = MODE_FILES[mode];
      if (!src) return null;
      let a = null;
      try {
        const AudioCtor =
          (typeof window !== 'undefined' && window.Audio) ||
          (typeof Audio !== 'undefined' ? Audio : null);
        if (!AudioCtor) return null;
        a = new AudioCtor(src);
        a.loop = true;
        a.volume = this.volume;     // 运动基准音量 0.19
        a.muted = this.muted;       // 继承当前全局静音标志（默认 false）
      } catch (e) {
        a = null; // mp3 缺失或音频不可用 → 静默失败，游戏照常运行
      }
      if (a) this._audios[mode] = a;
      return a;
    }
  };

  root.bgmManager = manager;
  if (typeof module !== 'undefined' && module.exports) module.exports = manager;
})(typeof window !== 'undefined' ? window : globalThis);

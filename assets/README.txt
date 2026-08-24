将背景音乐文件放在这里（三模式各一首，已授权可商用）：

  - assets/1.mp3   练习模式（Practice）背景音乐
  - assets/2.mp3   闯关模式（Campaign）背景音乐
  - assets/3.mp3   日常模式（Daily）背景音乐

游戏代码由 bgmManager.js 引用，按 mode 自动加载对应文件：
  - practice -> assets/1.mp3
  - campaign -> assets/2.mp3
  - daily    -> assets/3.mp3

放置要求：
  - 文件名必须是 1.mp3 / 2.mp3 / 3.mp3（与 bgmManager.js 中 MODE_FILES 一致）
  - 建议时长 30~90 秒、可无缝循环（bgmManager 内部已设 audio.loop = true）
  - 统一音量已由 bgmManager 设为 0.38（比人声略低），无需在文件里调整

注意：缺少某个 mp3 时游戏不会崩溃——bgmManager 的 play()/setMode()
失败会被 .catch(()=>{}) / try-catch 静默吞掉，玩法逻辑完全不受影响。

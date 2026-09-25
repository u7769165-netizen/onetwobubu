/* ================= audio.js =================
   音频：WebAudio 音效（beep/sfx*）与程序化背景音乐（旋律/贝斯/浪漫轨调度）
   由 index.html 模块化拆分而来（原单文件 >144KB）。加载顺序：
   levels.js → audio.js → ui.js → game.js（index.html 中的 script 标签顺序）
   跨文件引用说明：本文件顶层只声明、不在加载时调用其他模块的函数（启动逻辑统一在 game.js 末尾）。
   ================================================================ */
/* ================= 简易音效（WebAudio 提示音） ================= */
let audioCtx = null;
function ensureCtx() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  } catch (e) {}
  return audioCtx;
}
function beep(freq, dur, type, vol) {
  if (!save.settings.sfx || paused) return;
  const v = (vol || 0.12) * (save.settings.volSfx / 100);
  if (v <= 0.0005) return;
  try {
    if (!ensureCtx()) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(v, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
function sfxDeath() { beep(180, 0.35, 'sawtooth', 0.1); }
function sfxWin() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.12), i * 110)); }
function sfxJump() {
  if (!save.settings.sfx || paused) return;
  const v = 0.09 * (save.settings.volSfx / 100);
  if (v <= 0.0005) return;
  try {
    ensureCtx();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(720, t + 0.12);   // 上滑「嗖」声
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.18);
  } catch (e) {}
}

/* ---- 轻快背景音乐：程序化 WebAudio 循环（旋律 + 贝斯 + 反拍打点） ---- */
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
/* C 大调五声音阶，128 BPM 八分音符，32 步两小节循环（0 = 休止） */
const MELODY = [76,79,81,79, 76,74,72,74, 76,79,84,81, 79,76,74,0,
                76,79,81,79, 76,74,72,67, 69,72,74,76, 79,76,74,72];
const BASS   = [48,0,0,0, 43,0,0,0, 45,0,0,0, 43,0,0,0,
                48,0,0,0, 43,0,0,0, 45,0,0,0, 48,0,50,0];
/* 浪漫主题：F 大调柔板 88 BPM，长音旋律 + 柔和贝斯（恋爱空间 / 爱之圣殿播放） */
const LOVE_MELODY = [69,0,72,0, 76,0,74,72, 69,0,65,0, 67,0,0,0,
                     72,0,74,0, 76,0,79,0, 77,76,74,72, 69,0,0,0];
const LOVE_BASS   = [41,0,0,0, 0,0,0,0, 48,0,0,0, 0,0,0,0,
                     41,0,0,0, 0,0,0,0, 43,0,0,0, 0,0,0,0];
const MUS_STEP = 60 / 128 / 2;
let romanticMusic = false;   // true 时播放浪漫轨
const musStepDur = () => romanticMusic ? 60 / 88 / 2 : MUS_STEP;
let musicTimer = null, musicStep = 0, musicNext = 0;
function musicNote(freq, t, dur, type, vol) {
  const v = vol * (save.settings.volMusic / 100);
  if (v <= 0.0005) return;   // 音乐音量为 0 时完全静音
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
/* ---- 背景音乐播放列表（文件音频，交叉渐变循环） ----
   bgm0.wav = 原程序化 BGM 前 30 秒离线渲染；bgm1~7 = 「背景音乐音频」文件夹 7 个 m4a（已复制为 bgm/ 下 ASCII 名）。
   两个播放选项：'exclusive'=「一二布布专属bgm」（bgm1~7 从第一首起顺序播放、末首播完回绕，不含原版）；
   'classic'=「原版经典旋律」（bgm0 单曲循环）。轨间 BGM_FADE 秒交叉渐变；解码失败全部回退程序化音乐。 */
const BGM_FILES = ['bgm/bgm0.wav', 'bgm/bgm1.m4a', 'bgm/bgm2.m4a', 'bgm/bgm3.m4a', 'bgm/bgm4.m4a', 'bgm/bgm5.m4a', 'bgm/bgm6.m4a', 'bgm/bgm7.m4a'];
const BGM_FADE = 2.5;          // 交叉渐变时长（秒）
let bgmBuffers = null;         // 解码完成的 AudioBuffer 数组（null=尚无成功轨）
let bgmDecodeFailed = false;   // 已尝试的池全部解码失败 → 程序化回退
let bgmLoading = false;        // 一批加载任务进行中
let bgmSlots = new Array(BGM_FILES.length).fill(undefined);  // undefined=未加载 null=失败 AudioBuffer=就绪（P2-A 按模式池增量加载）
let bgmIdx = 0;                // 当前轨在 bgmBuffers 内的位置（起播时由 bgmPool 对齐到列表第一首，无随机）
let bgmTrackIds = [];                // bgmBuffers 各轨对应的 BGM_FILES 原始下标（解码失败剔除后仍对齐曲目归属）
let bgmCur = null, bgmNext = null;   // {src, gain, endAt}

function bgmVol() { return 0.8 * (save.settings.volMusic / 100); }
/* 选曲模式：save.settings.bgmMode = 'exclusive'（专属 7 曲顺序播放）| 'classic'（原版循环）。
   旧档兼容：'auto'/数字等历史值统一迁移（0→classic，其余→exclusive）。 */
function bgmMode() {
  const m = save.settings.bgmMode;
  return (m === 'classic' || m === 0) ? 'classic' : 'exclusive';
}
/* 当前模式的播放池（bgmBuffers 位置数组，保持曲序）：classic=[原版轨]，exclusive=[7 首专属轨] */
function bgmPool() {
  const all = bgmBuffers.map((_, i) => i);
  const classic = bgmMode() === 'classic';
  const p = [];
  for (let i = 0; i < bgmTrackIds.length; i++) if (classic ? bgmTrackIds[i] === 0 : bgmTrackIds[i] >= 1) p.push(i);
  return p.length ? p : all;   // 目标轨全部解码失败时回退到全部可播轨，保证有声
}
/* P2-A 懒加载：只加载当前模式所需音轨（classic=1 轨 wav / exclusive=7 轨 m4a），
   每轨解码完成即并入播放列表（首轨就绪即可起播，不再等全部 8 轨）；切模式时补载缺失轨 */
function bgmPoolIds(mode) { return mode === 'classic' ? [0] : [1, 2, 3, 4, 5, 6, 7]; }
function bgmRebuild() {   // 由 bgmSlots 重建 bgmBuffers/bgmTrackIds（按 BGM_FILES 原始曲序）
  bgmBuffers = []; bgmTrackIds = [];
  for (let i = 0; i < bgmSlots.length; i++) if (bgmSlots[i]) { bgmBuffers.push(bgmSlots[i]); bgmTrackIds.push(i); }
  if (!bgmBuffers.length) bgmBuffers = null;
}
let bgmAfterLoad = null;   // 一批加载完成后的回调（切模式补载就绪后再执行交叉渐变）
function bgmDecodePool() {
  if (bgmLoading) return;
  const todo = bgmPoolIds(bgmMode()).filter(i => bgmSlots[i] === undefined);
  if (!todo.length) return;
  bgmLoading = true;
  Promise.all(todo.map(i =>
    fetch(BGM_FILES[i]).then(r => { if (!r.ok) throw new Error(BGM_FILES[i]); return r.arrayBuffer(); })
      .then(b => audioCtx.decodeAudioData(b))
      .then(buf => { bgmSlots[i] = buf; bgmRebuild(); })
      .catch(() => { bgmSlots[i] = null; })
  )).then(() => {
    bgmLoading = false;
    if (!bgmBuffers) bgmDecodeFailed = true;   // 所有已尝试轨均失败 → 程序化回退
    if (bgmAfterLoad) { const f = bgmAfterLoad; bgmAfterLoad = null; f(); }
  });
}
function bgmStartTrack(idx, fade) {
  const buf = bgmBuffers[((idx % bgmBuffers.length) + bgmBuffers.length) % bgmBuffers.length];
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  const now = audioCtx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(Math.max(bgmVol(), 0.0001), now + fade);
  src.connect(g); g.connect(audioCtx.destination);
  src.start(now);
  return { src, gain: g, endAt: now + buf.duration };
}
function bgmStartPlaylist() {
  if (!bgmBuffers) { bgmDecodePool(); return; }
  const pool = bgmPool();
  if (pool.indexOf(bgmIdx) < 0) bgmIdx = pool[0];   // 模式切换/首次起播：对齐到列表第一首（顺序播放，无随机）
  if (!bgmCur) bgmCur = bgmStartTrack(bgmIdx, 1.2);   // 首轨淡入
  const now = audioCtx.currentTime;
  if (!bgmNext && now >= bgmCur.endAt - BGM_FADE) {
    // 交叉渐变：下一轨淡入，当前轨同步淡出，播完在 onended 交接
    // exclusive：按池内曲序推进（末首回绕第一首）；classic：池长 1，交接即同曲循环
    bgmIdx = pool[(pool.indexOf(bgmIdx) + 1) % pool.length];
    bgmNext = bgmStartTrack(bgmIdx, BGM_FADE);
    const cur = bgmCur;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
    cur.gain.gain.linearRampToValueAtTime(0.0001, now + BGM_FADE);
    cur.src.onended = () => { if (bgmCur === cur) { bgmCur = bgmNext; bgmNext = null; } };
    try { cur.src.stop(now + BGM_FADE + 0.05); } catch (e) {}
  }
}
function bgmStopPlaylist(fade = 0.5) {
  if (!bgmCur && !bgmNext) return;
  const now = audioCtx.currentTime;
  for (const c of [bgmCur, bgmNext]) {
    if (!c) continue;
    try {
      c.gain.gain.cancelScheduledValues(now);
      c.gain.gain.setValueAtTime(c.gain.gain.value, now);
      c.gain.gain.linearRampToValueAtTime(0.0001, now + fade);
      c.src.stop(now + fade + 0.05);
    } catch (e) {}
  }
  bgmCur = bgmNext = null;
}
/* 选项切换：'exclusive'（一二布布专属bgm 顺序播放）/ 'classic'（原版经典旋律 循环）。
   未在播放时仅保存设置，下次起播自然生效；播放中则交叉渐变到目标列表第一首。 */
function bgmSwitchTo(mode) {
  save.settings.bgmMode = (mode === 'classic') ? 'classic' : 'exclusive';
  persistSave();
  const want = bgmMode();
  // P2-A：目标池尚未加载（懒加载下首次切模式）→ 先补载，就绪回调后再走交叉渐变
  if (bgmPoolIds(want).some(i => bgmSlots[i] === undefined)) {
    bgmDecodeFailed = false;
    bgmAfterLoad = () => { if (bgmMode() === want) bgmSwitchTo(want); };
    bgmDecodePool();
    return;
  }
  if (!bgmBuffers || bgmDecodeFailed || !bgmCur) return;
  const pool = bgmPool();
  if (bgmIdx === pool[0]) return;   // 正在播目标列表第一首：不打断
  bgmIdx = pool[0];
  const now = audioCtx.currentTime;
  if (bgmNext) {   // 已有交接轨在淡入：先快速淡出它
    const n = bgmNext; bgmNext = null;
    try {
      n.gain.gain.cancelScheduledValues(now);
      n.gain.gain.setValueAtTime(n.gain.gain.value, now);
      n.gain.gain.linearRampToValueAtTime(0.0001, now + 0.3);
      n.src.stop(now + 0.35);
    } catch (e) {}
  }
  const cur = bgmCur;
  const track = bgmStartTrack(bgmIdx, 1.0);   // 目标轨 1s 淡入
  cur.gain.gain.cancelScheduledValues(now);
  cur.gain.gain.setValueAtTime(cur.gain.gain.value, now);
  cur.gain.gain.linearRampToValueAtTime(0.0001, now + 1.0);
  cur.src.onended = () => { if (bgmCur === cur) bgmCur = track; };   // 播完再交接，避免双重淡入
  try { cur.src.stop(now + 1.05); } catch (e) {}
}
function bgmApplyVol() {   // 音量滑条实时跟随
  const now = audioCtx.currentTime, v = Math.max(bgmVol(), 0.0001);
  for (const c of [bgmCur, bgmNext]) {
    if (!c) continue;
    c.gain.gain.cancelScheduledValues(now);
    c.gain.gain.setValueAtTime(c.gain.gain.value, now);
    c.gain.gain.linearRampToValueAtTime(v, now + 0.15);
  }
}

function musicTick() {
  if (!audioCtx) return;
  const playing = screenMode === 'play' || screenMode === 'love' || screenMode === 'album';
  if (paused || !playing) { bgmStopPlaylist(0.4); musicNext = audioCtx.currentTime + 0.1; return; }  // 暂停/离场静音
  if (romanticMusic) {
    bgmStopPlaylist(0.8);   // 浪漫轨：淡出播放列表，程序化长音更贴合恋爱氛围
  } else if (!bgmDecodeFailed) {
    if (bgmBuffers) bgmStartPlaylist();
    else bgmDecodePool();   // 首次进入：启动当前模式池的懒加载（完成前程序化轨静音等待）
  } else {
    bgmStopPlaylist(0.3);   // 全部解码失败：回退程序化欢快轨（下方排程）
  }
  const sd = musStepDur();
  // 程序化排程：浪漫轨始终走这里；欢快轨仅在文件 BGM 不可用时回退
  if (romanticMusic || bgmDecodeFailed || !bgmBuffers) {
    if (musicNext < audioCtx.currentTime) musicNext = audioCtx.currentTime + 0.05;   // 文件 BGM 期间调度器停摆，重新进入程序化轨时重同步防爆音
    while (musicNext < audioCtx.currentTime + 0.3) {
      const s = musicStep % 32, t = musicNext;
      if (romanticMusic) {
        if (LOVE_MELODY[s]) musicNote(midiHz(LOVE_MELODY[s]), t, sd * 1.6, 'sine', 0.055);
        if (LOVE_BASS[s])   musicNote(midiHz(LOVE_BASS[s]), t, sd * 3, 'triangle', 0.05);
      } else if (!bgmLoading) {   // 解码中先静音等待，避免与文件 BGM 重叠
        if (MELODY[s]) musicNote(midiHz(MELODY[s]), t, sd * 0.9, 'triangle', 0.05);
        if (BASS[s])   musicNote(midiHz(BASS[s]), t, sd * 1.8, 'sine', 0.07);
        if (s % 4 === 2) musicNote(2400, t, 0.03, 'square', 0.012);   // 轻反拍打点
      }
      musicNext += sd;
      musicStep++;
    }
  }
}
function updateMusic() {
  // 浪漫轨：恋爱空间/纪念册界面 或 「爱之圣殿」主关卡游玩中
  romanticMusic = screenMode === 'love' || screenMode === 'album' || (LOVE_TEMPLE_MAJOR >= 0 && screenMode === 'play' && majorOf(curLevel) >= LOVE_TEMPLE_MAJOR);
  const want = !!save.settings.music && (screenMode === 'play' || screenMode === 'love' || screenMode === 'album');
  if (want && !musicTimer) {
    ensureCtx();
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      musicNext = audioCtx.currentTime + 0.1; musicStep = 0;
      musicTimer = setInterval(musicTick, 90);
    }
  } else if (!want && musicTimer) {
    clearInterval(musicTimer); musicTimer = null;
    bgmStopPlaylist(0.6);   // 关闭开关/离开界面：淡出停止文件 BGM
  }
  if (want && bgmCur) bgmApplyVol();
}

function sfxLoveUp() { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'sine', 0.12), i * 90)); }
function sfxHeart() { beep(880, 0.1, 'sine', 0.08); setTimeout(() => beep(1175, 0.14, 'sine', 0.08), 70); }
function sfxShield() { beep(392, 0.15, 'triangle', 0.1); setTimeout(() => beep(587, 0.25, 'triangle', 0.1), 120); }

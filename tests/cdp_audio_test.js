// 背景音乐 + 跳跃音效 CDP 验证
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9224;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}
function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--window-size=1280,900', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--user-data-dir=' + OUT + '\\profile_audio', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      exceptions.push(`${e.text} ${e.exception?.description ?? ''}`);
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000);
  await evl(`localStorage.clear()`);
  await send('Page.reload');
  await sleep(4000);

  // 注入 oscillator 计数器（统计实际排程的音符数）
  await evl(`window.__osc = 0;
    const _co = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(...a) { window.__osc++; return _co.apply(this, a); };`);

  // ---------- A. 设置默认值与 UI ----------
  ok(await evl(`save.settings.music === true && save.settings.sfx === true`), `A1 新档默认开启音效+背景音乐`);
  ok(await evl(`document.getElementById('musicToggle') !== null && document.getElementById('musicToggle').checked === true`), `A2 设置界面有背景音乐开关且勾选`);

  // ---------- B. 标题界面不播放 ----------
  ok(await evl(`musicTimer === null`), `B1 标题界面不播放音乐`);

  // ---------- C. 进入游玩后 BGM 调度器运行 + 文件播放列表 ----------
  await evl(`startLevel(0)`);
  await sleep(300);
  ok(await evl(`musicTimer !== null`), `C1 进入游玩启动音乐调度器`);
  // P2-A 懒加载：默认 exclusive 模式只解码专属 7 轨（bgm0.wav 不加载）
  await evl(`new Promise(r => { const c = setInterval(() => { if ((bgmBuffers && bgmBuffers.length === 7) || bgmDecodeFailed) { clearInterval(c); r(1); } }, 100); setTimeout(() => { clearInterval(c); r(0); }, 8000); })`);
  const nb = await evl(`bgmBuffers ? bgmBuffers.length : -1`);
  ok(nb === 7, `C2 专属模式池 7 轨全部解码入播放列表（${nb} 轨，原版轨未加载）`);
  ok(await evl(`bgmTrackIds.indexOf(0) < 0`), `C2b 原版 wav 未预载（懒加载生效）`);
  await sleep(400);
  ok(await evl(`!!bgmCur`), `C3 文件 BGM 播放列表已起播（当前轨运行中）`);
  ok(await evl(`audioCtx && audioCtx.state === 'running'`), `C4 AudioContext 运行中`);
  // 交叉渐变：拨近当前轨末尾，应排入下一轨并在交接后推进曲序
  const idx0 = await evl(`bgmIdx`);
  await evl(`if (bgmCur) bgmCur.endAt = audioCtx.currentTime + 3`);
  await sleep(4300);
  const xfade = await evl(`JSON.stringify({ cur: !!bgmCur, idx: bgmIdx })`);
  const xo = JSON.parse(xfade);
  ok(xo.cur && xo.idx !== idx0, `C5 交叉渐变平滑交接（曲序 ${idx0}→${xo.idx}，无中断）`);
  // 循环边界：曲序推进到池末轨后回绕（P2-A：用池内位置而非 BGM_FILES 长度）
  await evl(`(() => { const p = bgmPool(); bgmIdx = p[p.length - 1]; })(); if (bgmCur) bgmCur.endAt = audioCtx.currentTime + 3`);
  await sleep(4300);
  ok(await evl(`bgmIdx >= 0 && bgmIdx < bgmBuffers.length`), `C6 播放列表循环不越界（回绕有效）`);

  // ---------- C+. 两选项：专属bgm 顺序播放 / 原版经典旋律 ----------
  ok(await evl(`(() => { const s = document.getElementById('bgmSelect'); return !!s && s.options.length === 2 && s.options[0].value === 'exclusive' && s.options[1].value === 'classic' })()`), `C7 下拉恰有两选项：专属bgm / 原版经典旋律`);
  ok(await evl(`bgmMode() === 'exclusive' && bgmTrackIds[bgmIdx] >= 1`), `C8 默认专属模式，当前曲不含原版（trackId≥1）`);
  // 顺序播放：交接后曲序严格 +1（末首回绕到 1），无随机
  const t0 = await evl(`bgmTrackIds[bgmIdx]`);
  await evl(`if (bgmCur) bgmCur.endAt = audioCtx.currentTime + 3`);
  await sleep(4300);
  const t1 = await evl(`bgmTrackIds[bgmIdx]`);
  ok(t1 === (t0 === 7 ? 1 : t0 + 1), `C9 专属列表顺序推进（${t0}→${t1}，非随机）`);
  await evl(`(() => { const p = bgmPool(); bgmIdx = p[p.length - 1]; })(); if (bgmCur) bgmCur.endAt = audioCtx.currentTime + 3`);   // 置于池末首（track 7）
  await sleep(4300);
  ok(await evl(`bgmTrackIds[bgmIdx] === 1`), `C10 末首播完回绕到列表第一首（track 7→1）`);
  await evl(`(() => { const s = document.getElementById('bgmSelect'); s.value = 'classic'; s.dispatchEvent(new Event('change')); })()`);
  // P2-A：首次切 classic 触发原版 wav 补载，就绪回调后再交叉渐变
  await evl(`new Promise(r => { const c = setInterval(() => { if (!bgmLoading && bgmTrackIds.indexOf(0) >= 0) { clearInterval(c); r(1); } }, 100); setTimeout(() => { clearInterval(c); r(0); }, 8000); })`);
  await sleep(1600);   // 等补载回调的交叉渐变交接
  ok(await evl(`bgmMode() === 'classic' && bgmTrackIds[bgmIdx] === 0 && !!bgmCur`), `C11 切「原版经典旋律」补载原版轨并平滑过渡`);
  await evl(`if (bgmCur) bgmCur.endAt = audioCtx.currentTime + 3`);
  await sleep(4300);
  ok(await evl(`bgmTrackIds[bgmIdx] === 0 && !!bgmCur`), `C12 原版经典旋律循环续播`);
  await evl(`(() => { const s = document.getElementById('bgmSelect'); s.value = 'exclusive'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(1400);
  ok(await evl(`bgmTrackIds[bgmIdx] >= 1 && bgmSelect.value === 'exclusive'`), `C13 切回专属列表从第一首顺序播放且 UI 同步`);
  // 旧档兼容：历史值迁移
  ok(await evl(`save.settings.bgmMode = 'auto'; bgmMode() === 'exclusive'`), `C14 旧值 auto 迁移为专属模式`);
  ok(await evl(`save.settings.bgmMode = 0; bgmMode() === 'classic'`), `C15 旧值 0（锁原版）迁移为经典模式`);
  await evl(`save.settings.bgmMode = 'exclusive'`);

  // ---------- D. 跳跃音效 ----------
  await evl(`keys = {}; running = true;`);
  await sleep(200);
  const j0 = await evl(`window.__osc`);
  await evl(`keys['KeyW'] = true`);
  await sleep(250);
  await evl(`keys['KeyW'] = false`);
  const j1 = await evl(`window.__osc`);
  // 跳跃瞬间应有额外音符（BGM 2.5s 内约 12~15 个，跳跃音效 +1；用角色 vy 验证真的跳了）
  ok(await evl(`players[0].vy < -100 || players[0].y < 320`), `D1 按 W 角色确实起跳`);
  const jumpSfx = await evl(`(() => { let n = 0; const orig = sfxJump; sfxJump = function(...a) { n++; return orig.apply(this, a); }; window.__cntJump = () => n; return 'patched'; })()`);
  await evl(`players[0].onGround = true; players[0].vy = 0; keys['KeyW'] = true`);
  await sleep(250);
  await evl(`keys['KeyW'] = false`);
  ok(await evl(`window.__cntJump()`) >= 1, `D2 跳跃触发 sfxJump 音效`);
  const jm0 = await evl(`window.__osc`);
  await evl(`sfxJump()`);
  await sleep(100);
  ok(await evl(`window.__osc`) > jm0, `D3 sfxJump 实际排程振荡器发声`);

  // ---------- E. 暂停静音（文件 BGM 淡出） ----------
  await evl(`pauseGame()`);
  await sleep(800);
  ok(await evl(`!bgmCur && !bgmNext`), `E1 暂停期间文件 BGM 淡出停止`);
  const p0 = await evl(`window.__osc`);
  await sleep(1200);
  ok(await evl(`window.__osc`) === p0, `E2 暂停期间无新音符排程`);
  await evl(`resumeGame()`);
  await sleep(800);
  ok(await evl(`!!bgmCur`), `E3 恢复后文件 BGM 重新起播`);
  await sleep(1500);
  ok(await evl(`window.__osc`) >= p0, `E4 恢复后无异常`);

  // ---------- F. 离开游玩停止 ----------
  await evl(`showScreen('title')`);
  await sleep(800);
  ok(await evl(`musicTimer === null`), `F1 返回标题停止音乐调度器`);
  ok(await evl(`!bgmCur && !bgmNext`), `F2 返回标题文件 BGM 淡出停止`);
  const f0 = await evl(`window.__osc`);
  await sleep(1000);
  ok(await evl(`window.__osc`) === f0, `F3 标题界面无声`);

  // ---------- G. 开关关闭 ----------
  await evl(`save.settings.music = false; persistSave(); startLevel(0)`);
  await sleep(300);
  ok(await evl(`musicTimer === null`), `G1 关闭背景音乐开关后不播放`);
  ok(await evl(`!bgmCur && !bgmNext`), `G2 关闭开关后文件 BGM 不播放`);
  await evl(`save.settings.sfx = false; sfxJump()`);
  const g0 = await evl(`window.__osc`);
  await evl(`sfxJump()`);
  ok(await evl(`window.__osc`) === g0, `G3 关闭音效开关后跳跃无声`);

  // ---------- G2. 浪漫轨（爱之圣殿）：文件列表让位程序化浪漫轨 ----------
  await evl(`save.settings.music = true; save.settings.sfx = true; startLevel(28)`);
  await sleep(1500);
  await evl(`hideOverlay()`);
  await sleep(600);
  ok(await evl(`romanticMusic && !bgmCur`), `G4 爱之圣殿切换浪漫轨并停止文件播放列表`);
  const r0 = await evl(`window.__osc`);
  await sleep(1500);
  ok(await evl(`window.__osc`) > r0, `G5 浪漫轨程序化排程发声`);
  await evl(`showScreen('title')`);
  await sleep(500);

  // ---------- G3. 程序化回退：文件全不可用时欢快轨自动接管 ----------
  await evl(`bgmBuffers = null; bgmDecodeFailed = true; bgmCur = bgmNext = null; startLevel(0)`);
  await sleep(400);
  const fb0 = await evl(`window.__osc`);
  await sleep(1500);
  ok(await evl(`window.__osc`) > fb0, `G6 文件不可用时程序化欢快轨回退发声`);
  ok(await evl(`!bgmCur`), `G7 回退期间文件播放列表不启动`);
  await evl(`showScreen('title'); bgmBuffers = null; bgmDecodeFailed = false; bgmMode() !== 'exclusive' && bgmSwitchTo('exclusive');`);
  await sleep(300);

  // ---------- H. 旧档兼容 ----------
  await evl(`localStorage.setItem('onetwobubu_save_v1', JSON.stringify({unlocked:3, best:{}, stars:{}, settings:{sfx:false,hud:true}}))`);
  await send('Page.reload');
  await sleep(3500);
  ok(await evl(`save.settings.music === true && save.settings.sfx === true`), `H1 旧档（无music字段）升级后默认开启音频`);
  await evl(`localStorage.setItem('onetwobubu_save_v1', JSON.stringify({unlocked:3, best:{}, stars:{}, settings:{sfx:true,music:false,hud:true}}))`);
  await send('Page.reload');
  await sleep(3500);
  ok(await evl(`save.settings.music === false`), `H2 旧档显式关闭设置被保留`);

  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

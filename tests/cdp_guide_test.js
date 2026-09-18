/* 新手引导迁移至规则界面 + 设置增强（音量滑条/按键指南）专项测试 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9251;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let passed = 0, failed = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail ? '→ ' + detail : ''}`); fails.push(name); }
}
let chrome;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--user-data-dir=' + OUT + '\\profile_guide', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 250)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__EVAL_ERR__:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 200);
    return r.result?.result?.value; };
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\guide_${name}.png`, Buffer.from(s.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); location.reload()`);
  await sleep(4000);

  /* ===== 1. 引导 overlay 系统已移除 ===== */
  let r = await evl(`JSON.stringify({ guides: typeof GUIDES, lg: typeof levelGuides, gh: typeof guidesHTML, box: document.querySelectorAll('.guide-box').length })`);
  let o = JSON.parse(r);
  ok(o.guides === 'undefined' && o.lg === 'undefined' && o.gh === 'undefined' && o.box === 0, `1.1 GUIDES/levelGuides/guidesHTML/.guide-box 已全部移除`, r);
  r = await evl(`(() => { save.unlocked = 5; startLevel(5);
    return JSON.stringify({ detail: document.getElementById('detailBox').innerHTML.length,
      title: document.querySelector('#overlay .title').textContent }) })()`);
  o = JSON.parse(r);
  ok(o.detail === 0 && o.title.includes('颠倒之厅'), `1.2 第6关开场 overlay 干净无引导卡`, r);
  await shot('level6');
  r = await evl(`(() => { save.unlocked = 6; startLevel(6); return document.getElementById('detailBox').innerHTML.length })()`);
  ok(r === 0, `1.3 Boss 关开场 overlay 干净（${r}）`);
  // 旧档带 guides 字段：加载不崩溃且忽略
  await evl(`(() => { const s = JSON.parse(localStorage.getItem('onetwobubu_save_v1'));
    s.guides = { pad: true }; localStorage.setItem('onetwobubu_save_v1', JSON.stringify(s)) })(); location.reload()`);
  await sleep(4000);
  r = await evl(`JSON.stringify({ g: save.guides, u: save.unlocked })`);
  o = JSON.parse(r);
  ok(o.g === undefined && typeof o.u === 'number', `1.4 旧档 guides 字段被忽略且不崩溃`, r);

  /* ===== 2. 引导内容完整迁移至规则界面 ===== */
  await evl(`showScreen('help')`); await sleep(400);
  r = await evl(`(() => { const t = document.getElementById('helpScreen').innerText;
    return JSON.stringify({
      pad: t.includes('同时站上去') && t.includes('蓄力') && t.includes('一起高高弹起') && t.includes('微调落点') && t.includes('单人站上去不会蓄力'),
      grav: t.includes('飘向天花板') && t.includes('向下方跳') && t.includes('掉出世界') && t.includes('重力立即恢复'),
      boss: t.includes('短暂虚弱') && t.includes('冰蓝核') && t.includes('布布（火）') && t.includes('一二（水）') && t.includes('跳起') && t.includes('6 次')
    }) })()`);
  o = JSON.parse(r);
  ok(o.pad, '2.1 弹跳台引导内容完整（同站蓄力/一起弹起/微调落点/单人不可）');
  ok(o.grav, '2.2 重力反转引导内容完整（飘向天花板/向下跳/掉出世界/走出恢复）');
  ok(o.boss, '2.3 Boss 破核引导内容完整（虚弱/蓝核布布/火核一二/跳起躲避/6次即胜）');
  r = await evl(`(() => { const secs = document.querySelectorAll('#helpScreen .help-sec');
    const boss = document.getElementById('h-boss');
    return JSON.stringify({ n: secs.length, bossP1: boss.innerHTML.includes('class="p1"'), bossP2: boss.innerHTML.includes('class="p2"') }) })()`);
  o = JSON.parse(r);
  ok(o.n === 8 && o.bossP1 && o.bossP2, `2.4 规则界面 8 节 + Boss 节保留角色分工配色`, r);
  await shot('help');

  /* ===== 3. 目录导航交互 ===== */
  r = await evl(`document.querySelectorAll('#helpToc .toc-btn').length`);
  ok(r === 8, `3.1 目录按钮 8 个（${r}）`);
  r = await evl(`(() => { const body = document.getElementById('helpBody'); body.scrollTop = 0;
    document.querySelector('#helpToc [data-sec="h-boss"]').click();
    return JSON.stringify({ target: !!document.getElementById('h-boss') }) })()`);
  await sleep(800);
  r = await evl(`JSON.stringify({ top: document.getElementById('helpBody').scrollTop, hl: document.getElementById('h-boss').classList.contains('hl') })`);
  o = JSON.parse(r);
  ok(o.top > 0 && o.hl, `3.2 点击目录平滑滚动到 Boss 节并高亮（scrollTop=${o.top}）`, r);
  await shot('help_toc');
  await sleep(700);
  r = await evl(`document.getElementById('h-boss').classList.contains('hl')`);
  ok(r === false, '3.3 高亮 1.2s 后自动消退');
  r = await evl(`(() => { document.getElementById('helpBody').scrollTop = 300;
    document.getElementById('helpBtn').click(); return document.getElementById('helpBody').scrollTop })()`);
  ok(r === 0, `3.4 重新进入规则界面滚动位置复位（${r}）`);

  /* ===== 4. 音量滑条 UI 与持久化 ===== */
  await evl(`showScreen('settings')`); await sleep(300);
  r = await evl(`JSON.stringify({ sfxS: !!document.getElementById('volSfxSlider'), musS: !!document.getElementById('volMusicSlider'),
    sfxV: document.getElementById('volSfxVal').textContent, kg: !!document.querySelector('.key-guide') })`);
  o = JSON.parse(r);
  ok(o.sfxS && o.musS && o.sfxV === '100%' && o.kg, `4.1 设置界面含双音量滑条+按键指南`, r);
  r = await evl(`(() => { const s = document.getElementById('volSfxSlider'); s.value = 30;
    s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    return JSON.stringify({ v: save.settings.volSfx, t: document.getElementById('volSfxVal').textContent,
      ls: JSON.parse(localStorage.getItem('onetwobubu_save_v1')).settings.volSfx }) })()`);
  o = JSON.parse(r);
  ok(o.v === 30 && o.t === '30%' && o.ls === 30, `4.2 音效音量拖动即时生效+持久化`, r);
  r = await evl(`(() => { const s = document.getElementById('volMusicSlider'); s.value = 55;
    s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    return save.settings.volMusic })()`);
  ok(r === 55, `4.3 音乐音量滑条生效（${r}）`);
  await shot('settings');
  await evl(`location.reload()`); await sleep(4000);
  r = await evl(`JSON.stringify({ s: save.settings.volSfx, m: save.settings.volMusic })`);
  o = JSON.parse(r);
  ok(o.s === 30 && o.m === 55, `4.4 音量设置刷新后持久`, r);
  await evl(`(() => { const s = JSON.parse(localStorage.getItem('onetwobubu_save_v1'));
    delete s.settings.volSfx; delete s.settings.volMusic; localStorage.setItem('onetwobubu_save_v1', JSON.stringify(s)) })()`);
  await evl(`location.reload()`); await sleep(4000);
  r = await evl(`JSON.stringify({ s: save.settings.volSfx, m: save.settings.volMusic })`);
  o = JSON.parse(r);
  ok(o.s === 100 && o.m === 100, `4.5 旧档缺音量字段默认 100`, r);
  r = await evl(`(() => { const s = JSON.parse(localStorage.getItem('onetwobubu_save_v1'));
    s.settings.volSfx = 999; localStorage.setItem('onetwobubu_save_v1', JSON.stringify(s)) })(); location.reload()`);
  await sleep(4000);
  r = await evl(`save.settings.volSfx`);
  ok(r === 100, `4.6 越界音量钳制到 100（${r}）`);

  /* ===== 5. 音量实际作用于音频输出（OscillatorNode.start 探针） ===== */
  r = await evl(`(() => {
    let n = 0; const orig = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { n++; return orig.apply(this, a) };
    save.settings.sfx = true;
    save.settings.volSfx = 0; beep(880, 0.1, 'sine', 0.1); const zero = n;
    save.settings.volSfx = 100; beep(880, 0.1, 'sine', 0.1); const full = n;
    save.settings.volSfx = 30; sfxJump(); const jump = n;
    OscillatorNode.prototype.start = orig;
    return JSON.stringify({ zero, full: full - zero, jump: jump - (full - zero) - zero }) })()`);
  o = JSON.parse(r);
  ok(o.zero === 0 && o.full >= 1, `5.1 音效音量 0 静音 / 100 发声`, r);
  r = await evl(`(() => {
    ensureCtx(); let n = 0; const orig = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { n++; return orig.apply(this, a) };
    startLevel(0); running = true; save.settings.music = true; updateMusic();
    const _b = bgmBuffers, _f = bgmDecodeFailed;   // 文件 BGM 可用时程序化轨不排程：强制回退态测音量门控
    bgmBuffers = null; bgmDecodeFailed = true;
    save.settings.volMusic = 0; musicNext = audioCtx.currentTime; musicTick(); const zero = n;
    save.settings.volMusic = 100; musicNext = audioCtx.currentTime; musicTick(); const full = n;
    bgmBuffers = _b; bgmDecodeFailed = _f;
    OscillatorNode.prototype.start = orig;
    return JSON.stringify({ zero, full }) })()`);
  o = JSON.parse(r);
  ok(o.zero === 0 && o.full >= 2, `5.2 音乐音量 0 静音 / 100 发声`, r);

  /* ===== 6. 按键指南内容 ===== */
  await evl(`showScreen('settings')`); await sleep(300);
  r = await evl(`(() => { const kg = document.querySelector('.key-guide');
    return JSON.stringify({ hasA: !!kg.querySelector('kbd'), txt: kg.textContent }) })()`);
  o = JSON.parse(r);
  ok(o.hasA && o.txt.includes('A') && o.txt.includes('W') && o.txt.includes('←') && o.txt.includes('↑') && o.txt.includes('R') && o.txt.includes('Esc'),
    `6.1 按键指南覆盖双人+通用键`, o.txt.slice(0, 60));

  /* ===== 7. 无 JS 异常 ===== */
  const realEx = exceptions.filter(e => !/favicon/i.test(e));
  ok(realEx.length === 0, `7.1 全程无未捕获异常（${realEx.length}）`, realEx.slice(0, 2).join(' | '));

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (fails.length) console.log('FAILED:', fails.join(', '));
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); try { chrome.kill(); } catch (_) {} process.exit(2); });

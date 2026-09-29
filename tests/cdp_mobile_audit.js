/* 移动视口兼容性审计（CDP headless Chrome）
   4 视口（640×360 小横屏 / 844×390 iPhone 横屏 / 360×640 竖屏 / 1080×2400 高分竖屏）
   × 逐个菜单界面断言：无横向溢出 / 纵向超高必须可滚（防居中顶裁切）/ 首个可交互控件可达 / 无 JS 异常
   截图产物：每视口 title + net 两张 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9255;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let passed = 0, failed = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); fails.push(name); }
}
const VIEWPORTS = [
  { w: 640, h: 360 }, { w: 844, h: 390 }, { w: 360, h: 640 }, { w: 1080, h: 2400 },
];
const SCREENS = [
  ['title', 'titleScreen'], ['levels', 'levelScreen'], ['settings', 'settingsScreen'],
  ['net', 'netScreen'], ['auth', 'authScreen'], ['subpick', 'subPick'], ['map', 'mapScreen'],
  ['help', 'helpScreen'], ['love', 'loveScreen'], ['photos', 'photoScreen'], ['album', 'albumScreen'],
];
const CHECK_EXPR = `(() => {
  const vis = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden'));
  if (!vis) return { err: 'no-visible-screen' };
  const cs = getComputedStyle(vis);
  const scrollY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
  const iw = window.innerWidth, ih = window.innerHeight;
  const sbw = vis.offsetWidth - vis.clientWidth;   // 经典滚动条占宽需从横向溢出判定中扣除
  const hOver = Math.max(vis.scrollWidth - vis.clientWidth - sbw, document.documentElement.scrollWidth - iw);
  const vOver = vis.scrollHeight - vis.clientHeight;
  const btn = [...vis.querySelectorAll('button, input, select, a')].find(x => x.offsetParent !== null);
  let btnOk = true;
  if (btn) { const r = btn.getBoundingClientRect(); btnOk = r.left >= -1 && r.right <= iw + 1 && (r.bottom <= ih + 1 || scrollY); }
  return { id: vis.id, hOver, vOver, clipped: vOver > 2 && !scrollY, btnOk };
})()`;
let chrome;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1100,800', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_audit', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }
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
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}`, Buffer.from(s.result.data, 'base64')); };

  await send('Runtime.enable'); await send('Page.enable');
  for (const vp of VIEWPORTS) {
    const tag = `${vp.w}x${vp.h}`;
    await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
    await send('Page.navigate', { url: 'http://localhost:8765/' });
    await sleep(3500);
    await evl(`localStorage.removeItem('onetwobubu_save_v1'); localStorage.setItem('onetwobubu_touchguide_seen','1')`);
    for (const [name, expectId] of SCREENS) {
      await evl(`showScreen('${name}')`); await sleep(180);
      const r = await evl(CHECK_EXPR);
      if (typeof r === 'string') { ok(false, `${tag}/${name} 检查`, r); continue; }
      const good = r.id === expectId && r.hOver <= 2 && !r.clipped && r.btnOk;
      ok(good, `${tag}/${name} 无溢出·可滚·控件可达`, good ? '' : JSON.stringify(r));
      if (name === 'title') await shot(`mobile_audit_${tag}_title.png`);
      if (name === 'net') await shot(`mobile_audit_${tag}_net.png`);
    }
    ok(exceptions.length === 0, `${tag} 全程无未捕获异常（${exceptions.length}）`, exceptions.slice(0, 2).join(' | '));
    exceptions.length = 0;
  }
  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FATAL', e); try { chrome && chrome.kill(); } catch (_) {} process.exit(1); });

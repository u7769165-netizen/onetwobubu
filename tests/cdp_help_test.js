// 验证：游戏规则移到主菜单 + 顶部提示不再占用画面
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9229;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}`); } };
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--user-data-dir=' + OUT + '\\profile_help', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  ok(await evl(`document.querySelectorAll('.hint').length === 0 && document.querySelectorAll('h1').length === 0`), `H1 页面顶部玩法提示/h1 已移除，不再占用前端空间`);
  ok(await evl(`!!document.getElementById('helpBtn') && !document.getElementById('helpBtn').closest('.screen.hidden')`), `H2 主菜单有「游戏规则」入口按钮`);
  await evl(`showScreen('help')`); await sleep(400);
  ok(await evl(`screenMode === 'help' && !document.getElementById('helpScreen').classList.contains('hidden')`), `H3 点击可打开规则界面`);
  const secs = await evl(`document.querySelectorAll('#helpScreen .help-sec').length`);
  ok(secs === 8, `H4 规则界面分节完整（${secs} 节：操作/克制/机关/多层协作/Boss破核/收集评分/情侣默契/关卡结构）`);
  ok(await evl(`document.getElementById('helpScreen').innerText.includes('紫色弹跳台') && document.getElementById('helpScreen').innerText.includes('金色悬空平台')`), `H5 规则含弹跳台与悬空平台说明`);
  ok(await evl(`(() => { const t = document.getElementById('helpScreen').innerText;
    return t.includes('飘向天花板') && t.includes('属性破核') && t.includes('破核') })()`), `H5b 原新手引导内容（重力反转/Boss破核）已迁移入规则`);
  const toc = await evl(`document.querySelectorAll('#helpToc .toc-btn').length`);
  ok(toc === 8, `H5c 目录导航按钮 ${toc} 个与分节一一对应`);
  await evl(`document.getElementById('helpBackBtn').click()`); await sleep(300);
  ok(await evl(`screenMode === 'title'`), `H6 返回按钮回到主菜单`);
  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

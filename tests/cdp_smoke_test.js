// 全 40 层关卡冒烟测试：逐层加载→实体解析→渲染帧→无JS异常→出生点安全
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9231;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}`); } };
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_smoke', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; exceptions.push(`${e.text} ${e.exception?.description ?? ''}`); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000); await evl(`localStorage.clear()`); await send('Page.reload'); await sleep(4500);

  const N = await evl(`LEVELS.length`);
  ok(N === 40, `S0 共 ${N} 层关卡`);
  let bad = [];
  for (let i = 0; i < N; i++) {
    // 逐层：加载→跑60帧→采集状态
    const st = JSON.parse(await evl(`(() => { try {
      loadLevel(${i}, true);
      for (let f = 0; f < 60; f++) { tick(); }
      const rows = LEVELS[${i}];
      return JSON.stringify({
        ok: true,
        name: LEVEL_NAMES[${i}],
        players: players.length,
        pads: pads.length,
        plats: plats.length,
        gems: gems.length,
        starsTotal: starsTotal,
        spikes: spikes.length,
        flames: flames.length,
        slimes: slimes.length,
        doors: doors.length,
        buttons: buttons.length,
        cols: rows[0].length, rows: rows.length,
        died: dead, won: won,
        camX: camX
      });
    } catch (e) { return JSON.stringify({ ok: false, err: String(e && e.stack || e) }); } })()`));
    if (!st.ok) { bad.push(`层${i + 1} 加载异常: ${st.err}`); continue; }
    if (st.cols !== 48 || st.rows !== 10) bad.push(`层${i + 1} ${st.name} 尺寸异常 ${st.cols}x${st.rows}`);
    if (st.players !== 2) bad.push(`层${i + 1} ${st.name} 玩家数异常`);
    if (st.died) bad.push(`层${i + 1} ${st.name} 出生60帧内死亡（出生点危险）`);
    if (i >= 5 && st.pads < 1) bad.push(`层${i + 1} ${st.name} 第6关起应有弹跳台但 pads=${st.pads}`);
    if (i < 5 && st.pads > 0) bad.push(`层${i + 1} ${st.name} 前5关不应有弹跳台`);
  }
  ok(bad.length === 0, `S1 全部 ${N} 层：加载/渲染/实体解析/出生安全 通过${bad.length ? '\n      ' + bad.slice(0, 8).join('\n      ') : ''}`);
  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `S2 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);
  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

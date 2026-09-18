// 多层级结构 CDP 验证：前5关单层、第6关起每关2~3层、协作跳峰值可达对应层、层间距统一
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9227;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}`); } };
function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_multi', 'about:blank'], { stdio: 'ignore' });
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
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000); await evl(`localStorage.clear()`); await send('Page.reload'); await sleep(4500);

  // ---------- A：结构统计（数据层） ----------
  const stats = JSON.parse(await evl(`JSON.stringify(LEVELS.map((rows,i) => {
    const s = rows.join('');
    // 二层=row5实心台(排除row8贴地台阶)；三层=row2悬空云台
    const hasSecond = rows[5].slice(1, -1).includes('#');
    const hasThird = rows[2].slice(1, -1).includes('=');
    return { i, H: (s.match(/H/g)||[]).length, eq: (s.match(/=/g)||[]).length, hasSecond, hasThird };
  }))`));
  const first5 = stats.slice(0, 5);
  ok(first5.every(s => s.H === 0 && s.eq === 0 && !s.hasSecond), `A1 前5关为单层（无弹跳台/悬空台/二层实心台）`);
  const rest = stats.slice(5);
  ok(rest.every(s => s.H >= 1 && s.hasSecond), `A2 第6关起每关都有弹跳台 + 二层实心台(row5 顶200px)`);
  ok(rest.every(s => s.H === 1 || s.H === 2), `A3 每关弹跳台 1~2 个（两层1台/三层2台）`);
  const three = rest.filter(s => s.H === 2);
  ok(three.every(s => s.eq >= 4 && s.hasThird), `A4 三层关(${three.length}个)含悬空云台(row2 顶96px)，层间距统一`);
  const two = rest.filter(s => s.H === 1);
  ok(two.every(s => s.eq === 0), `A5 两层关(${two.length}个)无三层云台（限时关降低挫败）`);

  // ---------- B：协作跳峰值可达性（物理层） ----------
  // 对每个含弹跳台的关卡：双人站地面台→弹射峰值脚位应 ≤ 200（够上二层顶）
  async function peakFromPad(padTopY) {
    await evl(`(() => { const pad = pads.find(p => p.y === ${padTopY}); if (!pad) return 0;
      players[0].x = pad.x + 4; players[0].y = pad.y - 38; players[0].vx = 0; players[0].vy = 0;
      players[1].x = pad.x + 20; players[1].y = pad.y - 38; players[1].vx = 0; players[1].vy = 0; return 1; })()`);
    return JSON.parse(await evl(`(() => new Promise(res => {
      let n = 0, minF = 9999, launched = false;
      const iv = setInterval(() => {
        n++;
        if (Math.abs(players[0].vy) > 500) launched = true;
        if (launched) { const f = players[0].y + 38; if (f < minF) minF = f; }
        if (n > 90) { clearInterval(iv); res(JSON.stringify({ minF, launched })); }
      }, 16); }))()`));
  }
  // 抽查：第6关(两层)、第8关(三层)、第13关(三层)、第20关(限时两层)
  const samples = [
    { flat: 5, label: '关6 颠倒之厅(两层)', need2: true, need3: false },
    { flat: 7, label: '关8 水晶矿脉(三层)', need2: true, need3: true },
    { flat: 12, label: '关13 晶廊回环(三层)', need2: true, need3: true },
    { flat: 19, label: '关20 逆风阶地(限时两层)', need2: true, need3: false },
  ];
  for (const sp of samples) {
    await evl(`loadLevel(${sp.flat}, true)`); await sleep(250);
    const p2 = await peakFromPad(320);   // 地面台顶320（脚320）
    ok(p2.launched && p2.minF <= 200, `B ${sp.label} 地面台协作跳峰值脚=${p2.minF.toFixed(0)} ≤ 二层顶200`);
    if (sp.need3) {
      const p3 = await peakFromPad(200);  // 二层台顶200（脚200）
      ok(p3.launched && p3.minF <= 96, `B ${sp.label} 二层台协作跳峰值脚=${p3.minF.toFixed(0)} ≤ 三层顶96`);
    }
  }

  // ---------- C：单人普通跳够不到二层（协作必要性） ----------
  await evl(`loadLevel(7, true)`); await sleep(200);
  await evl(`(() => { players[1].x = 4; players[1].y = 322; players[0].x = 10*40+8; players[0].y = 322; players[0].vx=0; players[0].vy=0; return 1; })()`);
  await evl(`(() => { window.__min = 9999; const iv = setInterval(() => { const f = players[0].y + 38; if (f < window.__min) window.__min = f; }, 8); keys.KeyW = true; setTimeout(() => { keys.KeyW = false; clearInterval(iv); }, 1200); return 1; })()`);
  await sleep(1500);
  const soloPeak = await evl(`window.__min`);
  ok(soloPeak > 205, `C1 关8 单人普通跳峰值脚=${soloPeak.toFixed(0)}px > 二层顶200px（必须协作）`);

  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);
  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

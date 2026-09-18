// 性能基准：node bench_perf.js <标签>（如 pre/post）
// 测量：① 静态资源服务端响应（首轮 200 + 二轮条件请求）② 游戏 render 单帧耗时（重载关=冰火双子Boss关）③ rAF 帧率 ④ JS 堆
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9277;
const TAG = process.argv[2] || 'run';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function httpJson(path) {
  return new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
}
function get(urlPath, headers = {}) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    http.get({ host: '127.0.0.1', port: 8765, path: urlPath, headers }, r => {
      let bytes = 0; r.on('data', c => bytes += c.length);
      r.on('end', () => res({ status: r.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6, bytes, etag: r.headers.etag || '' }));
    }).on('error', rej);
  });
}
(async () => {
  const out = { tag: TAG, ts: new Date().toISOString(), static: {}, game: {} };

  // ===== 1. 静态资源（服务端处理效率）=====
  const files = ['/', '/game.js', '/ui.js', '/levels.js', '/audio.js', '/style.css', '/一二.png', '/img/微信图片_20260917172505_169_32.jpg'];
  for (const f of files) {
    const a = await get(encodeURI(f));
    const b = await get(encodeURI(f), { 'If-None-Match': a.etag });   // 条件请求（支持 ETag 的服务器应回 304）
    out.static[f] = { first_ms: +a.ms.toFixed(2), status: a.status, bytes: a.bytes, revalidate_ms: +b.ms.toFixed(2), revalidate_status: b.status };
  }

  // ===== 2. 游戏渲染（CDP）=====
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--user-data-dir=' + __dirname + '\\profile_bench', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__ERR__:' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200);
    return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(5000);
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); location.reload()`);
  await sleep(4500);

  // 重载场景：Boss 关（史莱姆+火焰+移动平台+Boss 弹幕）
  await evl(`startLevel(6)`);
  await sleep(1500);
  await evl(`hideOverlay()`);
  await sleep(300);
  out.game.boss_render = JSON.parse(await evl(`(() => {
    const ts = []; for (let i = 0; i < 200; i++) { const t0 = performance.now(); render(); ts.push(performance.now() - t0); }
    ts.sort((a,b)=>a-b); return JSON.stringify({ avg: +(ts.reduce((s,v)=>s+v,0)/ts.length).toFixed(3), p95: +ts[190].toFixed(3), max: +ts[199].toFixed(3) });
  })()`));
  // 大地图关（48 列全实体：迷雾深渊首层）
  await evl(`startLevel(14)`);
  await sleep(1500);
  await evl(`hideOverlay()`);
  await sleep(300);
  out.game.maze_render = JSON.parse(await evl(`(() => {
    const ts = []; for (let i = 0; i < 200; i++) { const t0 = performance.now(); render(); ts.push(performance.now() - t0); }
    ts.sort((a,b)=>a-b); return JSON.stringify({ avg: +(ts.reduce((s,v)=>s+v,0)/ts.length).toFixed(3), p95: +ts[190].toFixed(3), max: +ts[199].toFixed(3) });
  })()`));
  // tick 逻辑帧耗时
  out.game.tick = JSON.parse(await evl(`(() => {
    const ts = []; for (let i = 0; i < 200; i++) { const t0 = performance.now(); tick(); ts.push(performance.now() - t0); }
    ts.sort((a,b)=>a-b); return JSON.stringify({ avg: +(ts.reduce((s,v)=>s+v,0)/ts.length).toFixed(3), p95: +ts[190].toFixed(3) });
  })()`));
  // rAF 实际帧率（2 秒采样）
  out.game.fps = await evl(`new Promise(r => { let n = 0; const t0 = performance.now();
    const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
    requestAnimationFrame(f); })`);
  const pm = await send('Performance.getMetrics', {});
  const mm = Object.fromEntries(pm.result.metrics.map(x => [x.name, x.value]));
  out.game.heap_mb = +((mm.JSHeapUsedSize || 0) / 1048576).toFixed(1);
  out.game.nodes = mm.Nodes || 0;

  fs.writeFileSync(`${__dirname}\\bench_${TAG}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  ws.close(); chrome.kill();
  process.exit(0);
})();

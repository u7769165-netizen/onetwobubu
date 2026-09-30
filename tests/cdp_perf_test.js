/* 游玩帧率优化专项测试（CDP headless Chrome，桌面 640 逻辑视口）
   覆盖：perfStats 计数器存在 / 菜单不逐帧渲染 / 游玩中 renders 与 ticks 持续增长 /
   暂停 2s 不渲染 / 恢复立即补渲 / won 仍渲染 / 单帧补步上限 5（P1）/
   setDpr 画布尺寸与变换正确且触发补渲（P2）/ solidSet 数值键（P3）/ 无未捕获异常 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9262;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let passed = 0, failed = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); fails.push(name); }
}
const getStats = async () => JSON.parse(await evl(`JSON.stringify({ r: perfStats.renders, t: perfStats.ticks, m: perfStats.maxSteps })`));
let chrome;
let evl;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=900,460', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_perf', 'about:blank'], { stdio: 'ignore' });
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
  evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__EVAL_ERR__:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 200);
    return r.result?.result?.value; };
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}`, Buffer.from(s.result.data, 'base64')); };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);

  /* ===== A. perfStats 与菜单跳帧（P0） ===== */
  let r = await evl(`typeof perfStats === 'object' && perfStats !== null && typeof perfStats.renders === 'number'`);
  ok(r === true, 'A1 perfStats 计数器已暴露');
  r = await evl(`perfStats.renders >= 1`);
  ok(r === true, 'A2 首帧补渲：title 界面至少渲染过 1 帧（needRender 初值）');
  let s0 = await getStats();
  await sleep(1200);
  let s1 = await getStats();
  ok(s1.r === s0.r, `A3 菜单界面不再逐帧渲染（1.2s 内 renders ${s0.r}→${s1.r}）`, JSON.stringify({ s0, s1 }));

  /* ===== B. 游玩中持续增长 ===== */
  await evl(`showScreen('play'); loadLevel(0, true)`); await sleep(300);
  s0 = await getStats();
  await sleep(1000);
  s1 = await getStats();
  ok(s1.r - s0.r >= 30, `B1 游玩 1s renders 增长 ${s1.r - s0.r}（≥30，60fps 半速下限）`, JSON.stringify({ s0, s1 }));
  ok(s1.t - s0.t >= 30, `B2 游玩 1s ticks 增长 ${s1.t - s0.t}`, JSON.stringify({ s0, s1 }));
  await shot('perf_play.png');

  /* ===== C. 暂停不渲染 / 恢复补渲（P0） ===== */
  await evl(`pauseGame()`); await sleep(250);   // 等暂停生效，消费掉可能的补渲帧
  s0 = await getStats();
  await sleep(2000);
  s1 = await getStats();
  ok(s1.r === s0.r, `C1 暂停 2s renders 不增长（${s0.r}→${s1.r}）`, JSON.stringify({ s0, s1 }));
  await shot('perf_pause.png');
  await evl(`resumeGame()`); await sleep(300);
  s1 = await getStats();
  ok(s1.r > s0.r, `C2 恢复后立即补渲（renders ${s0.r}→${s1.r}）`, JSON.stringify({ s0, s1 }));

  /* ===== D. won 状态仍渲染通关动效 ===== */
  await evl(`won = true`); await sleep(250);
  s0 = await getStats();
  await sleep(600);
  s1 = await getStats();
  await evl(`won = false`);
  ok(s1.r - s0.r >= 15, `D1 won=true 时仍持续渲染（0.6s 增长 ${s1.r - s0.r}）`, JSON.stringify({ s0, s1 }));

  /* ===== E. 单帧补步上限 5（P1） ===== */
  r = await evl(`(() => { perfStats.maxSteps = 0; acc = 0.5; return 'ok' })()`);
  await sleep(150);
  s1 = await getStats();
  r = await evl(`acc`);
  ok(s1.m === 5, `E1 积压 0.5s（30 步）单帧最多补 5 步（实测 maxSteps=${s1.m}）`, JSON.stringify(s1));
  ok(typeof r === 'number' && r < 1 / 60 + 1e-9, `E2 超限积压已丢弃（acc=${r}）`, String(r));

  /* ===== F. solidSet 数值键（P3） ===== */
  r = JSON.parse(await evl(`JSON.stringify({ size: solidSet.size, n: solids.length, str: [...solidSet].some(v => typeof v === 'string') })`));
  ok(r.size === r.n && !r.str, `F1 solidSet 全数值键且与 solids 数量一致（${r.size}）`, JSON.stringify(r));

  /* ===== G. 自适应 DPR 切换（P2，手动触发验证尺寸链路） ===== */
  r = JSON.parse(await evl(`(() => { setDpr(1.5); return JSON.stringify({ dpr: DPR, lw: LOGICAL_W, w: canvas.width, h: canvas.height, tf: ctx.getTransform().a, nr: needRender }) })()`));
  ok(r.dpr === 1.5 && r.w === r.lw * 1.5 && r.h === 600 && r.tf === 1.5,
    `G1 setDpr(1.5)：缓冲 ${r.w}×${r.h}、transform=${r.tf}`, JSON.stringify(r));
  ok(r.nr === true, 'G2 setDpr 置 needRender 触发补渲');
  await sleep(250);
  r = await evl(`needRender === false`);
  ok(r === true, 'G3 补渲一帧后 needRender 复位');
  r = JSON.parse(await evl(`(() => { setDpr(2); return JSON.stringify({ dpr: DPR, lw: LOGICAL_W, w: canvas.width, h: canvas.height, tf: ctx.getTransform().a }) })()`));
  ok(r.dpr === 2 && r.w === r.lw * 2 && r.h === 800 && r.tf === 2,
    `G4 setDpr(2) 回升：缓冲 ${r.w}×${r.h}、transform=${r.tf}`, JSON.stringify(r));
  r = await evl(`(() => { const before = canvas.width; setDpr(2); return before === canvas.width })()`);
  ok(r === true, 'G5 setDpr 同值调用不重设缓冲（幂等）');

  /* ===== H. 游玩后回菜单再次冻结 ===== */
  await evl(`showScreen('title')`); await sleep(400);   // 消费界面切换可能的补渲
  s0 = await getStats();
  await sleep(1200);
  s1 = await getStats();
  ok(s1.r === s0.r, `H1 游玩后回 title 不再逐帧渲染（${s0.r}→${s1.r}）`, JSON.stringify({ s0, s1 }));

  /* ===== I. 帧时间监控状态存在 ===== */
  r = await evl(`typeof ftEma === 'number' && typeof setDpr === 'function'`);
  ok(r === true, 'I1 帧时间 EMA 与 setDpr 全局可用');

  ok(exceptions.length === 0, `J1 全程无未捕获异常（${exceptions.length}）`, exceptions.slice(0, 2).join(' | '));

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FATAL', e); try { chrome && chrome.kill(); } catch (_) {} process.exit(1); });

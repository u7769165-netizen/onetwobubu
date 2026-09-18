// 双人联机快照插值验证：两个独立 headless Chrome 实例（各单标签页，避免后台 rAF/WS 节流）
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(port, path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

function makeClient(port, userDataDir) {
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    '--window-size=1280,800', '--no-first-run', '--mute-audio',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--user-data-dir=' + userDataDir, 'about:blank'
  ], { stdio: 'ignore' });

  const wsHolder = { ws: null };
  let id = 0; const pending = new Map(); const exceptions = [];
  function attach() {
    return new Promise((res, rej) => {
      wsHolder.ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        if (m.method === 'Runtime.exceptionThrown') {
          const e = m.params.exceptionDetails;
          exceptions.push(`[EXCEPTION] ${e.text} ${e.exception?.description ?? ''} @${e.url ?? ''}:${e.lineNumber ?? ''}`);
        }
      };
      res();
    });
  }
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); wsHolder.ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EVAL_ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
    return r.result?.result?.value;
  };
  return { chrome, wsHolder, attach, send, evalJs, exceptions };
}

async function waitDevtools(port) {
  for (let i = 0; i < 40; i++) { try { return await httpJson(port, '/json'); } catch (e) { await sleep(500); } }
  throw new Error('devtools not ready on ' + port);
}

async function boot(client, port) {
  const targets = await waitDevtools(port);
  const page = targets.find(t => t.type === 'page');
  client.wsHolder.ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => client.wsHolder.ws.onopen = r);
  await client.attach();
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500); // 加载 + 抠图
}

(async () => {
  const A = makeClient(9331, OUT + '\\pA');
  const B = makeClient(9332, OUT + '\\pB');
  const log = [];
  let pass = true;
  const check = (name, ok, detail) => { log.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); if (!ok) pass = false; };
  try {
    await boot(A, 9331); await boot(B, 9332);

    // 注入探针：主机统计 netSend 各类型；客机统计 netOnMsg 到达 + netApplySnapshot 调用/异常
    await A.evalJs(`(() => { const _s = netSend; window.__sent = {}; netSend = function(o){ window.__sent[o.t] = (window.__sent[o.t]||0)+1; return _s(o); }; return 'hp'; })()`);
    await B.evalJs(`(() => { const _o = netOnMsg; window.__got = {}; netOnMsg = function(m){ window.__got[m.t] = (window.__got[m.t]||0)+1; return _o(m); }; const _a = netApplySnapshot; window.__apply = 0; window.__applyErr = null; window.__reload = 0; netApplySnapshot = function(m){ window.__apply++; try { return _a(m); } catch(e){ window.__applyErr = String((e && e.stack) || e); throw e; } }; const _g = netGuestLoadLevel; netGuestLoadLevel = function(i,v,h){ window.__reload++; return _g(i,v,h); }; return 'gp'; })()`);

    // A 建主机
    await A.evalJs(`(() => { net.leaving=false; if(!net.connected) netConnect('create','ZZ99'); return 'a'; })()`);
    await sleep(1200);
    let ra = JSON.parse(await A.evalJs(`JSON.stringify({role:net.role,conn:net.connected})`));
    check('A 主机连接', ra.role === 'host' && ra.conn === true, JSON.stringify(ra));

    // B 建客机（选布布）
    await B.evalJs(`(() => { net.leaving=false; document.getElementById('netChar').value='1'; if(!net.connected) netConnect('join','ZZ99'); return 'b'; })()`);
    await sleep(1500);
    ra = JSON.parse(await A.evalJs(`JSON.stringify({peer:net.peerOnline})`));
    check('A 收到队友上线', ra.peer === true, JSON.stringify(ra));
    let rb = JSON.parse(await B.evalJs(`JSON.stringify({role:net.role,idx:net.idx})`));
    check('B 客机身份', rb.role === 'guest' && rb.idx === 1, JSON.stringify(rb));

    // A 进第 1 关
    await A.evalJs(`(() => { loadLevel(0,true); showScreen('play'); return 'l'; })()`);
    await sleep(1500);
    rb = JSON.parse(await B.evalJs(`JSON.stringify({screen:screenMode,n:players.length})`));
    check('B 同步进关', rb.screen === 'play' && rb.n === 2, JSON.stringify(rb));

    // 基线：客机已应用快照数
    let base = JSON.parse(await B.evalJs(`window.__apply || 0`));

    // A 按住右移（真实 rAF 广播）
    await A.evalJs(`(() => { players[0].x = 100; keys['KeyD']=true; return 'go'; })()`);
    await sleep(700);
    // 移动中采样客机快照序列（缓冲应含递增的 x）
    const mid = JSON.parse(await B.evalJs(`JSON.stringify({xs:net.snapBuf.map(s=>Math.round(s.m.p[0][0]))})`));
    await sleep(600);
    await A.evalJs(`(() => { keys['KeyD']=false; return 'stop'; })()`);
    const hostX = await A.evalJs(`Math.round(players[0].x)`);

    await sleep(400);
    rb = JSON.parse(await B.evalJs(`JSON.stringify({snaps:net.snapBuf.length, yiyiX:Math.round(players[0].x), bubuX:Math.round(players[1].x), xs:net.snapBuf.map(s=>Math.round(s.m.p[0][0]))})`));
    rb.xs = mid.xs; // 用移动中的序列做递增判定

    const nowApply = JSON.parse(await B.evalJs(`window.__apply`));
    const grew = nowApply - base >= 5;
    check('客机持续收到快照(apply增长)', grew, `base=${base} now=${nowApply} xs=${JSON.stringify(rb.xs)}`);
    const diff = Math.abs(rb.yiyiX - hostX);
    check('客机插值跟随主机', diff < 80, `hostX=${hostX} guestX=${rb.yiyiX} diff=${diff}`);
    const inc = rb.xs.length >= 2 && rb.xs[rb.xs.length - 1] > rb.xs[0];
    check('快照序列递增', inc, JSON.stringify(rb.xs));

    // 截图
    const shot = async (c, name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '\\' + name, Buffer.from(r.result.data, 'base64')); };
    await shot(B, 'net_guest.png');
    await shot(A, 'net_host.png');

    const ping = await B.evalJs(`net.ping`);
    log.push(`INFO | 客机往返延迟 ping=${ping}ms`);
    const sent = await A.evalJs(`JSON.stringify(window.__sent)`);
    const got = await B.evalJs(`JSON.stringify({got:window.__got, apply:window.__apply, reload:window.__reload, applyErr:window.__applyErr, ver:net.ver, cur:curLevel})`);
    log.push(`PROBE | host netSend counts = ${sent}`);
    log.push(`PROBE | guest ${got}`);
    if (A.exceptions.length) log.push('A exceptions:\n' + A.exceptions.join('\n'));
    if (B.exceptions.length) log.push('B exceptions:\n' + B.exceptions.join('\n'));
  } catch (e) {
    log.push('ERROR: ' + e.message); pass = false;
  } finally {
    console.log(log.join('\n'));
    console.log(pass ? '=== NET INTERPOLATION PASS ===' : '=== NET INTERPOLATION FAIL ===');
    A.chrome.kill(); B.chrome.kill();
    setTimeout(() => process.exit(pass ? 0 : 1), 300);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

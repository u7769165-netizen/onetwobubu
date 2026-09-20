// 账号系统 UI 级测试：游客联机门禁 / UI 注册恢复码 / Cookie 登录恢复 / needauth 弹回 / 游客单人回归
// 两个独立 headless Chrome（全新 profile，无历史 Cookie）。需服务器在 8765 运行（建议 AUTH_RATE_LIMIT=0）。
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

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
  await sleep(4500); // 加载 + 抠图 + /api/me 启动探测
}

(async () => {
  // 全新 profile：清掉上次运行的 Cookie，保证游客断言成立
  for (const d of ['pAu1', 'pAu2']) { try { fs.rmSync(OUT + '\\' + d, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {} }
  const A = makeClient(9341, OUT + '\\pAu1');
  const B = makeClient(9342, OUT + '\\pAu2');
  const log = [];
  let pass = true, npass = 0, nfail = 0;
  const check = (name, ok, detail) => { log.push(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); if (ok) npass++; else { nfail++; pass = false; } };
  const uname = 'ui' + Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 1e4);
  const room = 'AU' + Math.floor(10 + Math.random() * 90);   // 服务端要求 4 位字母数字
  try {
    await boot(A, 9341); await boot(B, 9342);

    // 1. 游客点「双人联机」→ 弹登录屏（门禁），登录后回跳目标为 net
    await A.evalJs(`document.getElementById('netBtn').click()`);
    await sleep(300);
    let ra = JSON.parse(await A.evalJs(`JSON.stringify({screen:screenMode,login:!document.getElementById('auPLogin').classList.contains('hidden'),after:authAfter})`));
    check('游客点联机→登录屏', ra.screen === 'auth' && ra.login === true && ra.after === 'net', JSON.stringify(ra));

    // 2. 游客单人回归：开始游戏无需登录
    await A.evalJs(`document.getElementById('playBtn').click()`);
    await sleep(200);
    let s = await A.evalJs(`screenMode`);
    check('游客免登录可开始游戏', s === 'levels', String(s));
    await A.evalJs(`showScreen('title')`);

    // 3. 再点联机 → 切注册页签 → 填表提交 → 恢复码面板 + 登录态生效
    await A.evalJs(`document.getElementById('netBtn').click(); document.getElementById('auTReg').click();`);
    await sleep(200);
    await A.evalJs(`(() => { const $=id=>document.getElementById(id); $('rgName').value='${uname}'; $('rgPass').value='UiTest1234'; $('rgPass2').value='UiTest1234'; $('rgQ').value='pet'; $('rgA').value='tom'; $('auRegBtn').click(); return 'sent'; })()`);
    await sleep(2500);
    ra = JSON.parse(await A.evalJs(`JSON.stringify({codePanel:!document.getElementById('auPCode').classList.contains('hidden'),codes:document.getElementById('auCodesList').children.length,name:authName})`));
    check('UI注册→恢复码面板(10组)', ra.codePanel === true && ra.codes === 10 && ra.name === uname, JSON.stringify(ra));

    // 4. 确认已保存恢复码 → 因 authAfter==='net' 回到联机大厅
    await A.evalJs(`document.getElementById('auCodesOkBtn').click()`);
    await sleep(300);
    s = await A.evalJs(`screenMode`);
    check('注册确认后回联机大厅', s === 'net', String(s));

    // 5. 重新加载页面：httpOnly Cookie 自动恢复登录态（/api/me）
    await A.send('Page.navigate', { url: 'http://localhost:8765/' });
    await sleep(4500);
    ra = JSON.parse(await A.evalJs(`JSON.stringify({name:authName,chip:document.getElementById('authChip').textContent})`));
    check('刷新后Cookie恢复登录', ra.name === uname && String(ra.chip).includes(uname), JSON.stringify(ra));

    // 6. 已登录建房：WS 升级携带 Cookie → 直接 welcome
    await A.evalJs(`(() => { net.leaving=false; netConnect('create','${room}'); return 'c'; })()`);
    await sleep(1500);
    ra = JSON.parse(await A.evalJs(`JSON.stringify({role:net.role,conn:net.connected,room:net.room})`));
    check('登录后Cookie建房', ra.role === 'host' && ra.conn === true && ra.room === room, JSON.stringify(ra));

    // 7. 页 B（全新 profile 游客）点联机 → 登录屏
    await B.evalJs(`document.getElementById('netBtn').click()`);
    await sleep(300);
    let rb = JSON.parse(await B.evalJs(`JSON.stringify({screen:screenMode,name:authName})`));
    check('B游客点联机→登录屏', rb.screen === 'auth' && !rb.name, JSON.stringify(rb));

    // 8. B 未登录直接 join 房间 → 服务端 needauth → 弹回登录屏并提示
    await B.evalJs(`(() => { net.leaving=false; if(!net.connected) netConnect('join','${room}'); return 'j'; })()`);
    await sleep(1500);
    rb = JSON.parse(await B.evalJs(`JSON.stringify({screen:screenMode,status:document.getElementById('netStatus').textContent,conn:net.connected})`));
    check('B未登录join→needauth弹回', rb.screen === 'auth' && /请先登录/.test(rb.status) && rb.conn === false, JSON.stringify(rb));

    // 9. B 游客单人回归
    await B.evalJs(`showScreen('title'); document.getElementById('playBtn').click();`);
    await sleep(200);
    s = await B.evalJs(`screenMode`);
    check('B游客免登录可开始游戏', s === 'levels', String(s));

    if (A.exceptions.length) log.push('A exceptions:\n' + A.exceptions.join('\n'));
    if (B.exceptions.length) log.push('B exceptions:\n' + B.exceptions.join('\n'));
    if (A.exceptions.length || B.exceptions.length) { pass = false; nfail++; }
  } catch (e) {
    log.push('ERROR: ' + e.message); pass = false; nfail++;
  } finally {
    console.log(log.join('\n'));
    console.log(`===== RESULT: ${npass} passed, ${nfail} failed =====`);
    console.log(pass ? '=== AUTH UI PASS ===' : '=== AUTH UI FAIL ===');
    A.chrome.kill(); B.chrome.kill();
    setTimeout(() => process.exit(pass ? 0 : 1), 300);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

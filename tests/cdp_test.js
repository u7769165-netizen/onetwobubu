// CDP-based game test: navigate, screenshot, console capture, key events
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    '--window-size=1280,800', '--no-first-run', '--mute-audio',
    '--user-data-dir=' + OUT + '\\profile', 'about:blank'
  ], { stdio: 'ignore' });

  // wait for devtools
  let targets = null;
  for (let i = 0; i < 30; i++) {
    try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); }
  }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const pending = new Map();
  const consoleMsgs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      consoleMsgs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      consoleMsgs.push(`[EXCEPTION] ${e.text} ${e.exception?.description ?? ''} at ${e.url ?? ''}:${e.lineNumber ?? ''}`);
    }
    if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      consoleMsgs.push(`[LOG-${e.level}] ${e.text} (${e.url ?? ''})`);
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(2000); // load
  await sleep(3000); // 抠图处理

  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '\\' + name, Buffer.from(r.result.data, 'base64'));
    console.log('saved', name);
  };

  await shot('1_initial.png');

  // canvas info
  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({title: document.title, canvas: !!document.querySelector('canvas'), w: document.querySelector('canvas')?.width, h: document.querySelector('canvas')?.height})`,
    returnByValue: true
  });
  console.log('page info:', info.result?.result?.value);

  // click center of canvas
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });
  await sleep(500);

  // hold D for 1s
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(1000);
  await shot('2_moving.png');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyD', key: 'd', windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 });
  await sleep(600);
  await shot('3_idle.png');

  console.log('=== CONSOLE ===');
  console.log(consoleMsgs.length ? consoleMsgs.join('\n') : '(no console messages)');

  ws.close(); chrome.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });

/* 合照收藏功能专项测试（CDP headless Chrome）
   覆盖：数据接线 / 解锁逻辑 / 收藏界面 / 大图预览 / 持久化 / 旧档兼容 / 响应式 / 无异常 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9248;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let passed = 0, failed = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail ? '→ ' + detail : ''}`); fails.push(name); }
}
let chrome;
let r;   // 各段共用的求值结果暂存
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--user-data-dir=' + OUT + '\\profile_photo', 'about:blank'], { stdio: 'ignore' });
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
  const press = async code => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code }); };
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\photo_${name}.png`, Buffer.from(s.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); save = JSON.parse(JSON.stringify(save)); location.reload()`);
  await sleep(4000);

  // ===== 1. 数据接线 =====
  r = JSON.parse(await evl(`JSON.stringify({ n: PHOTOS.length, majors: MAJOR_COUNT, files: PHOTO_FILES.length })`));
  ok(r.n === 20 && r.majors === 23 && r.files === 20, `1.1 PHOTOS=20（前19关+1彩蛋），主关已扩至23章`, JSON.stringify(r));
  r = await evl(`PHOTOS.every(p => p.src.startsWith('img/'))`);
  ok(r === true, '1.2 所有 src 指向 img/ 目录');
  // 图片可访问性：逐一 HEAD
  const bad = JSON.parse(await evl(`(async () => {
    const bad = [];
    for (let i = 0; i < PHOTOS.length; i++) {
      const res = await fetch(PHOTOS[i].src, { method: 'GET' });
      if (!res.ok) bad.push(i + ':' + res.status);
    }
    return JSON.stringify(bad);
  })()`));
  ok(bad.length === 0, `1.3 全部 20 张图片可加载（HTTP 200）`, JSON.stringify(bad));

  // ===== 2. 主菜单入口 =====
  r = await evl(`!!document.getElementById('photoBtn')`);
  ok(r === true, '2.1 主菜单存在「📷 小熊合照」按钮');
  r = await evl(`(() => { const w = document.getElementById('wrap').getBoundingClientRect();
    const t = document.querySelector('.game-title').getBoundingClientRect();
    const b = document.getElementById('settingsBtn').getBoundingClientRect();
    return t.top >= w.top - 1 && b.bottom <= w.bottom + 1 })()`);
  ok(r === true, '2.2 8 按钮两列布局后标题与设置按钮均完整可见');
  await evl(`document.getElementById('photoBtn').click()`); await sleep(300);
  r = await evl(`screenMode`);
  ok(r === 'photos', `2.3 点击进入收藏界面（${r}）`);

  // ===== 3. 收藏界面：锁定态 =====
  r = JSON.parse(await evl(`JSON.stringify({ cells: document.querySelectorAll('.ph-cell').length,
    locked: document.querySelectorAll('.ph-cell.locked').length,
    tip: document.getElementById('photoTip').textContent })`));
  ok(r.cells === 20 && r.locked === 20 && r.tip.includes('0 / 20'), `3.1 新档 20 格全锁定（cells=${r.cells} locked=${r.locked}）`, r.tip);
  r = await evl(`document.querySelectorAll('.ph-cell.locked .ph-lock small')[0].textContent`);
  ok(String(r).includes('青草地'), `3.2 锁定格提示对应关卡名`, String(r));
  await shot('locked');

  // ===== 4. 解锁逻辑 =====
  // 模拟：通关单层主关（idx0 青草地）→ 解锁 0 号合照（recordWin 内部会置 subs=true，需预置 false 模拟首通）
  r = await evl(`(() => {
    save.subs[0] = [false]; newPhotoIdx = -1;
    curLevel = 0;
    recordWin('A');
    return JSON.stringify({ photos: save.photos, npi: newPhotoIdx });
  })()`);
  ok(JSON.parse(r).photos.includes(0) && JSON.parse(r).npi === 0, `4.1 单层主关全通解锁 0 号合照`, r);
  // 多层关：只通第一层不解锁
  r = await evl(`(() => {
    save.subs[12] = [false, false]; newPhotoIdx = -1; curLevel = MAJORS[12].first;
    recordWin('A');
    return JSON.stringify({ has12: save.photos.includes(12), npi: newPhotoIdx });
  })()`);
  ok(JSON.parse(r).has12 === false && JSON.parse(r).npi === -1, `4.2 多层关仅通首层不解锁`, r);
  // 补齐第二层 → 解锁
  r = await evl(`(() => {
    newPhotoIdx = -1; curLevel = MAJORS[12].first + 1;
    recordWin('S');
    return JSON.stringify({ has12: save.photos.includes(12), npi: newPhotoIdx });
  })()`);
  ok(JSON.parse(r).has12 === true && JSON.parse(r).npi === 12, `4.3 补齐末层解锁对应合照`, r);
  // 重复通关不重复解锁
  r = await evl(`(() => { newPhotoIdx = -1; recordWin('S'); return newPhotoIdx })()`);
  ok(r === -1, `4.4 重复通关不再解锁`, String(r));
  // 全通关彩蛋：其余全通，首通最后一关末层 → 解锁 20 号
  r = await evl(`(() => {
    MAJORS.forEach((m, mi) => { if (mi !== MAJORS.length - 1) save.subs[mi] = m.subs.map(() => true); });
    save.subs[MAJORS.length - 1] = [true, true, false]; newPhotoIdx = -1; curLevel = LEVELS.length - 1;
    recordWin('S');
    return JSON.stringify({ easter: save.photos.includes(PHOTOS.length - 1), npi: newPhotoIdx });
  })()`);
  ok(JSON.parse(r).easter === true && JSON.parse(r).npi === 19, `4.5 全部通关解锁 20 号彩蛋照`, r);

  // ===== 5. 收藏界面：解锁态渲染 =====
  await evl(`buildPhotoScreen()`); await sleep(400);
  // 等待全部缩略图解码完成（大图 PNG 解码需要时间）
  await evl(`Promise.all([...document.querySelectorAll('.ph-cell img')].map(im => im.decode().catch(() => {})))`);
  await sleep(300);
  r = JSON.parse(await evl(`JSON.stringify({ unlocked: document.querySelectorAll('.ph-cell:not(.locked)').length,
    n: save.photos.length,
    imgs: document.querySelectorAll('.ph-cell img').length, tip: document.getElementById('photoTip').textContent })`));
  ok(r.unlocked === r.n && r.tip.includes('/ 20'), `5.1 解锁格渲染图片（unlocked=${r.unlocked} n=${r.n}）`, JSON.stringify(r));
  // 图片实际加载成功（naturalWidth>0）
  r = await evl(`(() => { const img = document.querySelector('.ph-cell:not(.locked) img');
    return img.complete && img.naturalWidth > 0 })()`);
  ok(r === true, '5.2 缩略图真实解码成功（naturalWidth>0）');
  await shot('unlocked');

  // ===== 6. 大图预览 =====
  await evl(`document.querySelector('.ph-cell:not(.locked)').click()`); await sleep(400);
  r = JSON.parse(await evl(`JSON.stringify({ open: !document.getElementById('photoView').classList.contains('hidden'),
    cap: document.getElementById('pvCap').textContent,
    loaded: (() => { const im = document.getElementById('pvImg'); return im.complete && im.naturalWidth > 0 })() })`));
  ok(r.open && r.loaded, `6.1 点击缩略图打开大图预览且图片加载`, JSON.stringify(r));
  ok(r.cap.includes('回忆') || r.cap.includes('纪念'), `6.2 预览标题正确`, r.cap);
  await shot('preview');
  // ←→ 切换：解锁了 0 和 12，右移应到 12
  await press('ArrowRight'); await sleep(300);
  r = await evl(`document.getElementById('pvCap').textContent`);
  ok(String(r).startsWith('13 /'), `6.3 → 切到下一张已解锁（13号=双塔秘境）`, String(r));
  await press('ArrowLeft'); await sleep(300);
  r = await evl(`document.getElementById('pvCap').textContent`);
  ok(String(r).startsWith('1 /'), `6.4 ← 切回上一张（1号）`, String(r));
  // 点击照片本体不关闭
  await evl(`document.getElementById('pvImg').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(200);
  r = await evl(`document.getElementById('photoView').classList.contains('hidden')`);
  ok(r === false, '6.5 点击照片本体不关闭预览');
  // 点击空白关闭
  await evl(`document.getElementById('photoView').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(200);
  r = await evl(`document.getElementById('photoView').classList.contains('hidden')`);
  ok(r === true, '6.6 点击空白关闭预览');
  // Esc 关闭
  await evl(`openPhotoView(0)`); await sleep(200);
  await press('Escape'); await sleep(200);
  r = await evl(`document.getElementById('photoView').classList.contains('hidden')`);
  ok(r === true, '6.7 Esc 关闭预览');

  // ===== 7. 持久化与旧档兼容 =====
  await evl(`location.reload()`); await sleep(4000);
  r = await evl(`JSON.stringify(save.photos)`);
  ok(JSON.parse(r).includes(0) && JSON.parse(r).includes(19), `7.1 合照解锁刷新后持久`, r);
  r = await evl(`(() => { showScreen('title'); return document.getElementById('progressLine').textContent })()`);
  ok(String(r).includes('📷'), `7.2 主菜单进度行显示合照收集数`, String(r));
  // 旧档无 photos 字段
  await evl(`(() => { const s = JSON.parse(localStorage.getItem('onetwobubu_save_v1')); delete s.photos;
    localStorage.setItem('onetwobubu_save_v1', JSON.stringify(s)); })()`);
  await evl(`location.reload()`); await sleep(4000);
  r = await evl(`JSON.stringify({ photos: Array.isArray(save.photos), len: save.photos.length, unlocked: save.unlocked })`);
  const oc = JSON.parse(r);
  ok(oc.photos && oc.len === 0 && oc.unlocked > 0, `7.3 旧档缺 photos 字段自动补空数组且保留进度`, r);
  r = await evl(`(() => { showScreen('photos'); return document.querySelectorAll('.ph-cell.locked').length })()`);
  ok(r === 20, `7.4 旧档收藏界面全锁定（${r}）`);

  // ===== 8. 重置进度清合照 =====
  await evl(`window.confirm = () => true; showScreen('settings'); document.getElementById('resetProgressBtn').click()`);
  await sleep(300);
  r = await evl(`JSON.stringify({ photos: save.photos.length, unlocked: save.unlocked })`);
  ok(JSON.parse(r).photos === 0 && JSON.parse(r).unlocked === 0, `8.1 重置进度清空合照收藏`, r);

  // ===== 9. 响应式 =====
  for (const [w, h, label] of [[375, 667, 'iPhone'], [768, 1024, 'iPad'], [1920, 1080, 'FHD']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await evl(`save.subs[0] = [true]; recordWin('A'); showScreen('photos')`); await sleep(300);
    r = JSON.parse(await evl(`JSON.stringify((() => {
      const grid = document.getElementById('phGrid');
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const wrap = document.getElementById('wrap').getBoundingClientRect();
      const g = grid.getBoundingClientRect();
      return { cols, inView: g.top >= wrap.top - 2 && g.bottom <= wrap.bottom + 2, scroll: grid.scrollHeight > grid.clientHeight };
    })())`));
    ok(r.inView || r.scroll, `9.1 ${label} ${w}x${h} 收藏网格适配（${r.cols}列）`, JSON.stringify(r));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await shot('grid');

  // ===== 11. 通关瞬间合照弹出 =====
  await evl(`showScreen('title')`); await sleep(200);
  // 11.1 弹出/收起基础
  r = await evl(`(() => { openPhotoReveal(0);
    return JSON.stringify({ shown: !document.getElementById('photoReveal').classList.contains('hidden'),
      src: document.getElementById('prImg').getAttribute('src'),
      cap: document.getElementById('prCap').textContent }) })()`);
  const pr = JSON.parse(r);
  ok(pr.shown && pr.cap.includes('回忆'), `11.1 合照弹出显示大图与题注`, r);
  r = await evl(`document.getElementById('prImg').getAttribute('src') === 'img/' + PHOTO_FILES[0]`);
  ok(r === true, '11.1b 弹出图片 src 对应解锁合照');
  await shot('reveal');
  r = await evl(`(() => { closePhotoReveal();
    return JSON.stringify({ hidden: document.getElementById('photoReveal').classList.contains('hidden'), t: prTimer }) })()`);
  ok(JSON.parse(r).hidden === true && JSON.parse(r).t === null, '11.2 收起后清除弹层与兜底定时器');
  // 11.3 非末层：收起后安排自动进层（subTransTimer 被调度）
  r = await evl(`(() => { pendingSubAdvance = true; openPhotoReveal(0); closePhotoReveal();
    const scheduled = subTransTimer !== null; if (subTransTimer) clearTimeout(subTransTimer); subTransTimer = null; pendingSubAdvance = false;
    return scheduled })()`);
  ok(r === true, '11.3 非末层合照收起后调度自动进层');
  // 11.4 弹出时点击画面：只收合照，不触发 advanceAfterWin（won 状态下 curLevel 不变）
  r = await evl(`(() => {
    startLevel(0); return new Promise(res => setTimeout(() => {
      won = true; running = false; openPhotoReveal(0);
      const before = curLevel;
      document.getElementById('wrap').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(() => res(JSON.stringify({ before, after: curLevel,
        hidden: document.getElementById('photoReveal').classList.contains('hidden'), won: won })), 400);
    }, 600)) })()`);
  const rc = JSON.parse(r);
  ok(rc.before === rc.after && rc.hidden === true && rc.won === true, `11.4 弹出时点击画面只收合照不跳关`, r);
  // 11.5 真实通关触发：单层主关首通 → tick 内自动弹出
  r = await evl(`(() => {
    save.subs[0] = [false]; save.photos = save.photos.filter(x => x !== 0); persistSave();
    startLevel(0); return new Promise(res => setTimeout(() => {
      // 把两人直接传送到出口（贴地 y=322）并恢复 running，触发 tick 内 checkExit
      won = false; running = true; paused = false;
      players[0].x = 44 * 40 + 4; players[0].y = 322; players[0].vx = players[0].vy = 0;
      players[1].x = 45 * 40 + 4; players[1].y = 322; players[1].vx = players[1].vy = 0;
      setTimeout(() => res(JSON.stringify({
        shown: !document.getElementById('photoReveal').classList.contains('hidden'),
        photos: save.photos.includes(0), won: won })), 1200);
    }, 600)) })()`);
  const rw = JSON.parse(r);
  ok(rw.shown === true && rw.photos === true && rw.won === true, `11.5 真实通关瞬间自动放出合照`, r);
  await shot('reveal_win');
  await evl(`closePhotoReveal(); showScreen('title')`); await sleep(200);

  // ===== 12. 无 JS 异常 =====
  const realEx = exceptions.filter(e => !/favicon/i.test(e));
  ok(realEx.length === 0, `10.1 全程无未捕获异常（${realEx.length}）`, realEx.slice(0, 2).join(' | '));

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (fails.length) console.log('FAILED:', fails.join(', '));
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); try { chrome.kill(); } catch (_) {} process.exit(2); });

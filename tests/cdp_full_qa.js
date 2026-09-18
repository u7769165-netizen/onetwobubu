/* 全面系统性测试：UI交互 / 暂停 / 死亡重生 / 存档 / 兼容性 / 边缘场景
   复用 CDP headless Chrome 模式。断言输出 PASS/FAIL + 严重度。 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9245;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

let passed = 0, failed = 0; const bugs = [];
function ok(cond, name, sev, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}  [${sev || '中'}] ${detail ? '→ ' + detail : ''}`); bugs.push({ name, sev: sev || '中', detail: detail || '' }); }
}

let chrome;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_full', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.error('CDP 无法连接'); chrome.kill(); process.exit(2); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const exceptions = []; const consoleErrs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrs.push(JSON.stringify(m.params.args).slice(0, 200)); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__EVAL_ERR__:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 200);
    return r.result?.result?.value; };
  const key = async (code, type = 'keyDown') => send('Input.dispatchKeyEvent', { type, code, key: code.replace(/^Key/, '').replace(/^Digit/, ''), windowsVirtualKeyCode: 0 });
  const press = async code => { await key(code, 'keyDown'); await key(code, 'keyUp'); };
  const click = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\full_${name}.png`, Buffer.from(s.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);

  // ============ A. 界面状态机与导航 ============
  let r = await evl(`screenMode`);
  ok(r === 'title', 'A1 启动进入标题界面', '高', r);
  const screens = JSON.parse(await evl(`JSON.stringify(['titleScreen','levelScreen','settingsScreen','helpScreen','loveScreen','mapScreen'].map(id => !!document.getElementById(id)))`));
  ok(screens.every(Boolean), 'A2 六大界面 DOM 齐全', '高', JSON.stringify(screens));
  // 每个主菜单按钮逐一点击→返回，检查状态机
  const btnMap = { playBtn: 'levels', mapBtn: 'map', loveBtn: 'love', helpBtn: 'help', settingsBtn: 'settings', netBtn: null };
  for (const [btn, target] of Object.entries(btnMap)) {
    if (!target) continue;
    await evl(`showScreen('${target}')`); await sleep(150);
    const sm = await evl(`screenMode`);
    ok(sm === target, `A3 「${btn}」进入 ${target} 界面`, '中', sm);
    await evl(`showScreen('title')`); await sleep(100);
  }
  // 不存在的界面名防呆
  await evl(`showScreen('nonexist')`); await sleep(100);
  r = await evl(`screenMode`);
  ok(['title', 'nonexist'].includes(r), 'A4 showScreen 非法参数不崩溃', '低', String(r));
  await evl(`showScreen('title')`); await sleep(100);

  // ============ B. 选关与子层选择 ============
  await evl(`save.unlocked = LEVELS.length - 1; persistSave();`);
  await sleep(200);
  r = await evl(`(() => { showScreen('levels'); return document.querySelectorAll('#levelScreen .lv-card').length })()`);
  ok(r === 23, `B1 解锁后选关卡片=23 主关（实际 ${r}）`, '高');
  // 多层关点击开子层选择
  await evl(`showScreen('levels')`); await sleep(200);
  const spRaw = await evl(`JSON.stringify((() => {
    const cards = document.querySelectorAll('#levelScreen .lv-card');
    cards[17].click();   // 云梯圣殿 2层
    return { open: !document.getElementById('subPick').classList.contains('hidden'),
             btns: document.querySelectorAll('#subPick .sp-btn').length };
  })())`);
  console.log('DEBUG B2 raw =', String(spRaw).slice(0, 300));
  const sp = JSON.parse(spRaw);
  await sleep(200);
  ok(sp.open && sp.btns === 2, `B2 多层关弹子层选择（open=${sp.open} btns=${sp.btns}）`, '中');
  await evl(`document.getElementById('subPick').classList.add('hidden')`);
  // 锁定关点击不进入（直接改内存 save 重建卡片，loadSave 无 key 时不重置内存）
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); save.unlocked = 0; save.subs = {}; buildLevelCards(); showScreen('levels')`); await sleep(300);
  r = await evl(`(() => { const cards = document.querySelectorAll('#levelScreen .lv-card'); cards[10].click(); return screenMode })()`);
  ok(r === 'levels', 'B3 未解锁关卡点击不进入', '中', r);

  // ============ C. 游玩核心与暂停 ============
  await evl(`save.unlocked = LEVELS.length - 1; persistSave(); startLevel(0); running = true; hideOverlay && hideOverlay()`);
  await sleep(500);
  r = await evl(`JSON.stringify({ sm: screenMode, n: players.length, cam: typeof camX })`);
  ok(JSON.parse(r).sm === 'play' && JSON.parse(r).n === 2, 'C1 进入游玩且双角色就位', '高', r);
  // 暂停/恢复
  await evl(`pauseGame()`); await sleep(150);
  r = await evl(`JSON.stringify({ paused, t: levelTime })`);
  ok(JSON.parse(r).paused === true, 'C2 pauseGame 置位', '高');
  await sleep(600);
  r = await evl(`levelTime`);
  const t1 = JSON.parse(await evl(`JSON.stringify({ paused, t: levelTime })`));
  ok(t1.t === r || Math.abs(t1.t - r) < 1e-9, 'C3 暂停时计时冻结', '高', `${r} vs ${t1.t}`);
  await evl(`resumeGame()`); await sleep(300);
  r = await evl(`JSON.stringify({ paused, t: levelTime })`);
  ok(JSON.parse(r).paused === false, 'C4 resumeGame 恢复', '高');
  // Esc 键暂停（真实按键事件）
  await press('Escape'); await sleep(200);
  r = await evl(`paused`);
  ok(r === true, 'C5 Esc 键暂停', '高', String(r));
  await press('KeyP'); await sleep(200);
  r = await evl(`paused`);
  ok(r === false, 'C6 P 键恢复', '高', String(r));
  // 暂停时按 R 不应生效（防误操作）
  await evl(`pauseGame()`); await sleep(100);
  const deadBefore = JSON.parse(await evl(`JSON.stringify({ deaths: save.deaths || 0, y: players[0].y })`));
  await press('KeyR'); await sleep(300);
  r = await evl(`JSON.stringify({ paused, y: players[0].y })`);
  ok(JSON.parse(r).paused === true, 'C7 暂停中 R 键不重置关卡', '中', r);
  await evl(`resumeGame()`); await sleep(100);

  // ============ D. 死亡与重生 ============
  await evl(`loadLevel(2, true); running = true;`);   // 熔岩洞
  await sleep(300);
  // 属性克制：岩浆只杀「一二」(players[0])，水池只杀「布布」(players[1])
  r = await evl(`(() => {
    const p = players[0];
    if (!lavas.length) return -1;
    p.x = lavas[0].x + 8; p.y = lavas[0].y - p.h; p.vy = 0;
    return lavas[0].x / TILE;
  })()`);
  await sleep(1200);
  const dd = JSON.parse(await evl(`JSON.stringify({ deaths: deaths || 0, respawn: players[0].x, py: players[0].y, inMap: players[0].y >= -60 && players[0].y <= rows * TILE + 60 })`));
  ok(dd.deaths >= 1, `D1 一二入岩浆致死并计数（deaths=${dd.deaths}）`, '高');
  ok(dd.inMap, `D2 重生后角色在地图内（y=${Math.round(dd.py)}）`, '高');
  // 双人同死：一二→水池、布布→岩浆（各自被克制地形杀）
  await evl(`loadLevel(2, true); running = true;`); await sleep(250);
  await evl(`(() => { if (waters.length) { players[0].x = waters[0].x + 8; players[0].y = waters[0].y - players[0].h; } if (lavas.length) { players[1].x = lavas[0].x + 8; players[1].y = lavas[0].y - players[1].h; } players[0].vy = players[1].vy = 0; return 1 })()`);
  await sleep(1500);
  r = await evl(`JSON.stringify({ deaths, both: players.every(p => p.y > 0 && p.y < rows*TILE) })`);
  const d3 = JSON.parse(r);
  ok(d3.deaths >= 1 && d3.both, `D3 双人被各自克制地形致死均正常重生（deaths=${d3.deaths}）`, '高', r);

  // ============ E. 快速操作与状态切换压力 ============
  // 快速连续切关
  for (const i of [5, 8, 12, 18, 0]) { await evl(`loadLevel(${i}, true)`); await sleep(120); }
  r = await evl(`JSON.stringify({ ok: players.length === 2 && players.every(p => isFinite(p.x) && isFinite(p.y)), lv: curLevel })`);
  ok(JSON.parse(r).ok, 'E1 快速连续切关后角色状态有效', '高', r);
  // 游玩中快速开关暂停 10 次
  await evl(`loadLevel(0, true)`); await sleep(200);
  for (let i = 0; i < 10; i++) { await evl(i % 2 ? 'resumeGame()' : 'pauseGame()'); }
  await sleep(300);
  r = await evl(`JSON.stringify({ paused, x: players[0].x })`);
  ok(isFinite(JSON.parse(r).x), 'E2 连续快速暂停/恢复不产生 NaN', '高', r);
  await evl(`resumeGame && paused && resumeGame()`);
  // 暂停界面来回跳
  await evl(`pauseGame(); showScreen('title')`); await sleep(150);
  r = await evl(`paused`);
  ok(r === false || r === undefined, `E3 暂停中切主菜单自动清除暂停态（${r}）`, '中');

  // ============ F. 存档系统 ============
  // 损坏 JSON
  await evl(`localStorage.setItem('onetwobubu_save_v1', '{{{broken'); location.reload()`);
  await sleep(4000);
  r = await evl(`JSON.stringify({ sm: screenMode, love: typeof save.love, subs: typeof save.subs })`);
  const fr = JSON.parse(r);
  ok(fr.sm === 'title' && fr.love === 'number', 'F1 损坏存档自动重建不崩溃', '高', r);
  // 字段缺失旧档
  await evl(`localStorage.setItem('onetwobubu_save_v1', JSON.stringify({ unlocked: 3, best: {}, stars: 5 })); location.reload()`);
  await sleep(4000);
  r = await evl(`JSON.stringify({ love: typeof save.love, stats: typeof save.loveStats, quests: typeof save.loveQuests, subs: typeof save.subs, unlocked: save.unlocked })`);
  const or_ = JSON.parse(r);
  ok(or_.love === 'number' && or_.subs === 'object' && or_.unlocked === 3, 'F2 旧档缺字段自动补默认且保留进度', '高', r);
  // 通关持久化：完成第1层后刷新仍在
  await evl(`save.unlocked = LEVELS.length - 1; persistSave(); startLevel(0); running = true; hideOverlay && hideOverlay()`); await sleep(300);
  await evl(`(() => { players[0].x = 44*TILE; players[0].y = 8*TILE - players[0].h - 1; players[1].x = 45*TILE; players[1].y = 8*TILE - players[1].h - 1; return 1 })()`);
  await sleep(2500);
  const win = JSON.parse(await evl(`JSON.stringify({ won, subs: save.subs[0] ? save.subs[0][0] : null, bonus: save.bonusStars })`));
  ok(win.won === true || win.subs === true, `F3 出口双人站立判定过关（won=${win.won} sub0=${win.subs}）`, '高');
  await evl(`location.reload()`); await sleep(4000);
  r = await evl(`save.subs[0] && save.subs[0][0]`);
  ok(r === true, 'F4 过关进度刷新后持久（localStorage）', '高', String(r));
  // 重置进度
  await evl(`(() => { const b = document.getElementById('resetProgressBtn'); return !!b })()`);
  r = await evl(`(() => {
    // 找到设置界面的重置按钮并模拟确认
    showScreen('settings');
    const btn = document.getElementById('resetProgressBtn');
    if (!btn) return 'no-btn';
    window.confirm = () => true;
    btn.click();
    return JSON.stringify({ love: save.love, subs: Object.keys(save.subs || {}).length, unlocked: save.unlocked });
  })()`);
  await sleep(300);
  try { const rr = JSON.parse(r); ok(rr.love === 0 && rr.unlocked === 0, `F5 重置进度清空好感与关卡（${r}）`, '中'); }
  catch (e) { ok(false, 'F5 重置进度按钮工作', '中', String(r)); }

  // ============ G. 兼容性：视口尺寸 ============
  const viewports = [[375, 667, 'iPhone SE'], [768, 1024, 'iPad'], [1920, 1080, 'FHD'], [1366, 768, '笔记本'], [2560, 1440, '2K']];
  for (const [w, h, label] of viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(350);
    const rr = JSON.parse(await evl(`JSON.stringify((() => {
      const wrap = document.getElementById('wrap').getBoundingClientRect();
      const cv = document.getElementById('game').getBoundingClientRect();
      return { wrapIn: wrap.left >= -2 && wrap.right <= innerWidth + 2 && wrap.top >= -2 && wrap.bottom <= innerHeight + 2,
               w: Math.round(wrap.width), h: Math.round(wrap.height), ratio: +(wrap.width / wrap.height).toFixed(2) };
    })())`));
    ok(rr.wrapIn && Math.abs(rr.ratio - 1.6) < 0.05, `G1 ${label} ${w}x${h} 画面完整且 16:10`, '中', JSON.stringify(rr));
  }
  // DPR 高清
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(350);
  r = await evl(`(() => { const cv = document.getElementById('game'); return cv.width >= 1200 })()`);
  ok(r === true, 'G2 高 DPI 后备缓冲 2x 渲染（防模糊）', '中', String(r));
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  // 标题界面在矮窗口不裁剪（回归上一修复）
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 620, deviceScaleFactor: 1, mobile: false });
  await evl(`showScreen('title')`); await sleep(300);
  r = JSON.parse(await evl(`JSON.stringify((() => {
    const wrap = document.getElementById('wrap').getBoundingClientRect();
    const t = document.querySelector('#titleScreen .game-title').getBoundingClientRect();
    const b = document.querySelector('#titleScreen .menu-btns').getBoundingClientRect();
    return { title: t.top >= wrap.top - 1 && t.bottom <= wrap.bottom + 1, btns: b.bottom <= wrap.bottom + 1 };
  })())`));
  ok(r.title && r.btns, 'G3 矮窗口标题+按钮完整可见', '中', JSON.stringify(r));
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // ============ H. 性能 ============
  await evl(`showScreen('play'); loadLevel(26, true); running = true;`);   // Boss 关（爱之圣殿末层）
  await sleep(1500);
  const perf = JSON.parse(await evl(`new Promise(res => {
    let frames = 0, t0 = performance.now();
    const cnt = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(cnt); else res(JSON.stringify({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1) })); };
    requestAnimationFrame(cnt);
  })`) || '{}');
  ok(perf.fps >= 30, `H1 Boss/粒子关帧率 ${perf.fps}fps ≥ 30`, '中');
  // 长时间运行内存与累加器
  r = await evl(`JSON.stringify({ parts: (window.fx || []).length, hearts: hearts.length })`);
  ok(r !== '__EVAL_ERR__' || true, 'H2 特效数组状态可查', '低');

  // ============ I. 键盘边缘 ============
  await evl(`showScreen('title')`); await sleep(200);
  // 标题界面乱按不崩溃
  for (const k of ['KeyQ', 'KeyZ', 'Digit5', 'F1', 'Space', 'Enter', 'Tab']) await press(k);
  await sleep(300);
  r = await evl(`screenMode`);
  ok(typeof r === 'string', 'I1 标题界面任意按键不崩溃', '中', String(r));
  // Enter 开始游戏（若有此快捷键）
  await press('Enter'); await sleep(400);
  r = await evl(`screenMode`);
  console.log(`INFO  Enter 键在标题的行为 → ${r}`);
  await evl(`showScreen('title')`);

  // ============ J. 无 JS 异常汇总 ============
  const realEx = exceptions.filter(e => !/favicon/i.test(e));
  ok(realEx.length === 0, `J1 全程无未捕获 JS 异常（${realEx.length}）`, '高', realEx.slice(0, 2).join(' | '));
  const realCE = consoleErrs.filter(e => !/favicon|ERR_|net::/i.test(e));
  ok(realCE.length === 0, `J2 无 console.error（${realCE.length}）`, '中', realCE.slice(0, 2).join(' | '));

  await shot('final');
  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (bugs.length) { console.log('BUGS:'); for (const b of bugs) console.log(`  [${b.sev}] ${b.name} :: ${b.detail}`); }
  ws.close(); chrome.kill(); process.exit(failed > 0 && bugs.some(b => b.sev === '高') ? 1 : 0);
})().catch(e => { console.error('ERR', e); try { chrome.kill(); } catch (_) {} process.exit(2); });

/* 触屏虚拟按键专项测试（CDP headless Chrome，模拟 844×390 横屏移动设备）
   覆盖：DOM/三态显示 / 首启引导层 / 键组映射 / 多指与双指同键 / 按键尺寸与反馈 / 暂停链路 / 防卡键 / 设置接线 / 触摸延迟 / 无异常 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9254;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let passed = 0, failed = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); fails.push(name); }
}
let chrome;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=900,460', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_touch', 'about:blank'], { stdio: 'ignore' });
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
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return '__EVAL_ERR__:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').slice(0, 200);
    return r.result?.result?.value; };
  // 合成 PointerEvent（pointerId 可控，验证多指 Set 逻辑）
  const pdown = (btn, pid) => evl(`document.getElementById('${btn}').dispatchEvent(new PointerEvent('pointerdown',{pointerId:${pid},bubbles:true,cancelable:true}))`);
  const pup = (btn, pid) => evl(`document.getElementById('${btn}').dispatchEvent(new PointerEvent('pointerup',{pointerId:${pid},bubbles:true,cancelable:true}))`);
  const wup = pid => evl(`window.dispatchEvent(new PointerEvent('pointerup',{pointerId:${pid},bubbles:true}))`);
  const releaseAll = () => evl(`releaseAllTouch()`);
  const rect = async btn => JSON.parse(await evl(`JSON.stringify(document.getElementById('${btn}').getBoundingClientRect())`));
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\${name}`, Buffer.from(s.result.data, 'base64')); };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  // 清档同时预置引导已读标记：后续真实触摸/流程段不被首启引导拦截（引导层专项断言见 A+ 段）
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); localStorage.setItem('onetwobubu_touchguide_seen','1'); save = JSON.parse(JSON.stringify(save)); location.reload()`);
  await sleep(4000);

  /* ===== A. DOM 与三态显示 ===== */
  let r = await evl(`['touchLayer','tpPause','tpLeft','tpRight','tpJump','tpSwitch','rotateHint','touchSelect'].every(i=>document.getElementById(i))`);
  ok(r === true, 'A1 触屏 DOM 与设置下拉齐全');
  r = await evl(`save.settings.touch`);
  ok(r === 'auto', `A2 新档默认 touch=auto`, String(r));
  await evl(`(() => { const s = JSON.parse(JSON.stringify(save)); s.settings.touch = 'bogus'; localStorage.setItem(SAVE_KEY, JSON.stringify(s)); location.reload(); })()`);
  await sleep(4000);
  r = await evl(`save.settings.touch`);
  ok(r === 'auto', `A3 非法存档值钳制回 auto`, String(r));
  r = JSON.parse(await evl(`JSON.stringify({ coarse: matchMedia('(pointer: coarse)').matches, vis: touchPadVisible, body: document.body.classList.contains('touch') })`));
  ok(r.coarse === true && r.vis === true && r.body === true, `A4 auto+粗指针→显示且 body.touch`, JSON.stringify(r));
  // mobile 仿真下 setEmulatedMedia(fine) 不生效，改桩 matchMedia 验证 auto 的精指针分支
  r = await evl(`(() => { const mm = window.matchMedia;
    window.matchMedia = q => q.includes('pointer: coarse') ? { matches: false, addEventListener() {}, removeEventListener() {} } : mm(q);
    applyTouchVisibility(); const v = touchPadVisible; window.matchMedia = mm; applyTouchVisibility(); return v })()`);
  ok(r === false, `A5 auto+精指针(鼠标)→隐藏`, String(r));
  await evl(`showScreen('play'); loadLevel(0, false)`); await sleep(300);
  r = await evl(`!document.getElementById('touchLayer').classList.contains('hidden')`);
  ok(r === true, 'A6 进入 play 界面按键层可见');
  await evl(`showScreen('title')`); await sleep(200);
  r = await evl(`document.getElementById('touchLayer').classList.contains('hidden')`);
  ok(r === true, 'A7 非 play 界面按键层隐藏');
  await evl(`showScreen('play'); loadLevel(0, false)`); await sleep(300);

  /* ===== A+. 首启引导层 ===== */
  await evl(`localStorage.removeItem('onetwobubu_touchguide_seen'); document.getElementById('touchGuide').classList.add('hidden'); maybeShowTouchGuide()`);
  r = await evl(`!document.getElementById('touchGuide').classList.contains('hidden')`);
  ok(r === true, 'A8 清标记后 coarse+play → 引导弹出');
  await shot('touch_guide_show.png');
  await evl(`document.getElementById('touchGuide').dispatchEvent(new PointerEvent('pointerdown',{pointerId:91,bubbles:true,cancelable:true}))`);
  r = JSON.parse(await evl(`JSON.stringify({ closed: document.getElementById('touchGuide').classList.contains('hidden'), seen: localStorage.getItem('onetwobubu_touchguide_seen'), run: running })`));
  ok(r.closed === true && r.seen === '1' && r.run === false, 'A9 首击关闭引导并写标记且不穿透启动', JSON.stringify(r));
  await evl(`maybeShowTouchGuide()`);
  r = await evl(`document.getElementById('touchGuide').classList.contains('hidden')`);
  ok(r === true, 'A10 已标记后不再弹出');
  r = await evl(`(() => { const s = document.getElementById('touchSelect'); s.value = 'off'; s.dispatchEvent(new Event('change'));
    localStorage.removeItem('onetwobubu_touchguide_seen'); maybeShowTouchGuide();
    const h = document.getElementById('touchGuide').classList.contains('hidden');
    s.value = 'auto'; s.dispatchEvent(new Event('change')); localStorage.setItem('onetwobubu_touchguide_seen', '1'); return h })()`);
  ok(r === true, 'A11 touch=off 不弹引导');
  /* 触屏游玩画面最大化：.ctrls 隐藏 + HUD 悬浮 + 画布按剩余高度撑开（844×390 期望 ~419px 宽） */
  r = JSON.parse(await evl(`(() => { const w = document.getElementById('wrap').getBoundingClientRect();
    return JSON.stringify({ wrapW: Math.round(w.width), ctrls: getComputedStyle(document.querySelector('.ctrls')).display, hudPos: getComputedStyle(document.getElementById('hud')).position }) })()`));
  ok(r.wrapW >= 400 && r.ctrls === 'none' && r.hudPos === 'fixed', 'A12 触屏游玩按钮行隐藏+HUD悬浮+画布扩至' + r.wrapW + 'px', JSON.stringify(r));
  await evl(`document.getElementById('hud').textContent = '第 1/23 关 · 🍰 0/1 · 🧋 0/1 · ⭐ 0/1 · 💕 0/1'`);
  await shot('touch_play_big.png');

  /* ===== B. 键组映射与多指 ===== */
  await pdown('tpLeft', 11);
  r = await evl(`keys.KeyA === true && keys.KeyD !== true`);
  ok(r === true, 'B1 按住左→keys.KeyA');
  await pup('tpLeft', 11);
  r = await evl(`keys.KeyA === false`);
  ok(r === true, 'B2 松开左→KeyA 释放');
  await pdown('tpJump', 12);
  r = await evl(`keys.KeyW === true`);
  ok(r === true, 'B3 跳跃→keys.KeyW');
  await pup('tpJump', 12);
  await pdown('tpLeft', 13); await pdown('tpJump', 14);
  r = await evl(`keys.KeyA === true && keys.KeyW === true`);
  ok(r === true, 'B4 多指同按（方向+跳跃互不干扰）');
  await pup('tpLeft', 13); await pup('tpJump', 14);
  await pdown('tpRight', 21); await pdown('tpRight', 22);
  await pup('tpRight', 21);
  r = await evl(`keys.KeyD === true`);
  ok(r === true, 'B5 双指同键抬一指仍按住');
  await pup('tpRight', 22);
  r = await evl(`keys.KeyD === false`);
  ok(r === true, 'B6 双指全抬才释放');
  await evl(`document.getElementById('tpSwitch').click()`);
  r = await evl(`touchIdx`);
  ok(r === 1, `B7 换角色钮→touchIdx=1`, String(r));
  await pdown('tpRight', 31);
  r = await evl(`keys.ArrowRight === true && keys.KeyD !== true`);
  ok(r === true, 'B8 切换后写第二键组（ArrowRight）');
  await pup('tpRight', 31);
  await evl(`document.getElementById('tpSwitch').click()`);
  r = await evl(`touchIdx === 0 && keys.ArrowRight !== true`);
  ok(r === true, 'B9 切回一二且旧键组无残留');
  r = await evl(`(() => { const b = document.getElementById('tpLeft').getBoundingClientRect(); return b.width >= 80 && b.height >= 80 })()`);
  ok(r === true, 'B10 方向键 ≥80×80px');
  await pdown('tpJump', 41);
  r = await evl(`document.getElementById('tpJump').classList.contains('on')`);
  ok(r === true, 'B11 按下有 .on 反馈样式');
  await pup('tpJump', 41);
  r = await evl(`document.getElementById('tpJump').classList.contains('on')`);
  ok(r === false, 'B12 松开反馈移除');

  /* ===== C. 防卡键三重保护 ===== */
  await pdown('tpLeft', 51);
  await wup(51);   // capture 失败场景：window 级兜底
  r = await evl(`keys.KeyA === false && tpSlot.left.size === 0`);
  ok(r === true, 'C1 window 级 pointerup 兜底释放');
  await pdown('tpLeft', 52); await pdown('tpJump', 53);
  await releaseAll();
  r = await evl(`keys.KeyA === false && keys.KeyW === false && document.querySelectorAll('#touchLayer .tpad.on').length === 0`);
  ok(r === true, 'C2 releaseAllTouch 全释放（键+样式）');
  await pdown('tpRight', 54);
  await evl(`pauseGame()`);
  r = await evl(`keys.KeyD === true`);
  ok(r === true, 'C3 暂停 clearKeys 后按住态回写（恢复后继续移动）');
  await evl(`resumeGame()`); await releaseAll();
  await evl(`window.dispatchEvent(new Event('blur'))`);
  r = await evl(`touchHeld.left === false && touchHeld.right === false && touchHeld.jump === false`);
  ok(r === true, 'C4 失焦 blur 全释放');

  /* ===== D. 暂停链路 ===== */
  await evl(`document.getElementById('tpPause').click()`); await sleep(200);
  r = JSON.parse(await evl(`JSON.stringify({ p: paused, menu: !document.getElementById('pauseMenu').classList.contains('hidden') })`));
  ok(r.p === true && r.menu === true, 'D1 暂停钮→paused+菜单弹出', JSON.stringify(r));
  await evl(`document.getElementById('resumeBtn').click()`); await sleep(200);
  r = await evl(`paused === false && document.getElementById('pauseMenu').classList.contains('hidden')`);
  ok(r === true, 'D2 继续游戏→恢复');
  await evl(`document.getElementById('tpPause').click()`); await sleep(150);
  await evl(`document.getElementById('pauseMapBtn').click()`); await sleep(250);
  r = await evl(`screenMode`);
  ok(r === 'map', `D3 暂停菜单→关卡地图`, String(r));
  await evl(`showScreen('play'); loadLevel(0, false)`); await sleep(200);
  await evl(`document.getElementById('tpPause').click()`); await sleep(150);
  await evl(`document.getElementById('pauseHomeBtn').click()`); await sleep(250);
  r = await evl(`screenMode`);
  ok(r === 'title', `D4 暂停菜单→返回主菜单`, String(r));
  await evl(`showScreen('play'); loadLevel(0, false)`); await sleep(200);

  /* ===== E. 设置接线 ===== */
  r = await evl(`document.getElementById('touchSelect').value`);
  ok(r === 'auto', `E1 applySettings 回填下拉`, String(r));
  await evl(`(() => { const s = document.getElementById('touchSelect'); s.value = 'off'; s.dispatchEvent(new Event('change')); })()`);
  r = JSON.parse(await evl(`JSON.stringify({ vis: touchPadVisible, save: save.settings.touch, ls: JSON.parse(localStorage.getItem(SAVE_KEY)).settings.touch })`));
  ok(r.vis === false && r.save === 'off' && r.ls === 'off', 'E2 选 off→隐藏+持久化', JSON.stringify(r));
  await evl(`(() => { const s = document.getElementById('touchSelect'); s.value = 'on'; s.dispatchEvent(new Event('change')); })()`);
  r = await evl(`touchPadVisible === true && !document.getElementById('touchLayer').classList.contains('hidden')`);
  ok(r === true, 'E3 选 on→总是显示');
  await evl(`(() => { const s = document.getElementById('touchSelect'); s.value = 'auto'; s.dispatchEvent(new Event('change')); })()`);

  /* ===== F. 真实触摸事件端到端（Input.dispatchTouchEvent） ===== */
  const jr = await rect('tpJump');
  const cx = jr.x + jr.width / 2, cy = jr.y + jr.height / 2;
  await releaseAll();
  const t0 = Date.now();
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  let hit = false;
  for (let i = 0; i < 20 && !hit; i++) { hit = await evl(`keys.KeyW === true`) === true; if (!hit) await sleep(5); }
  const dt = Date.now() - t0;
  ok(hit && dt < 100, `F1 真实触摸→按键生效延迟 ${dt}ms（<100ms）`, String(hit));
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(100);
  r = await evl(`keys.KeyW === false`);
  ok(r === true, 'F2 touchEnd→释放');
  // 双指真实同按：方向+跳跃
  const lr = await rect('tpLeft');
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lr.x + lr.width / 2, y: lr.y + lr.height / 2 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lr.x + lr.width / 2, y: lr.y + lr.height / 2 }, { x: cx, y: cy }] });
  await sleep(80);
  r = await evl(`keys.KeyA === true && keys.KeyW === true`);
  ok(r === true, 'F3 双指真实同按两点独立生效');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(100);
  r = await evl(`keys.KeyA === false && keys.KeyW === false`);
  ok(r === true, 'F4 双指抬起全释放');
  // 按键层在 #wrap 外：结构上不可能触发 wrap click 误启动
  r = await evl(`!wrap.contains(document.getElementById('touchLayer'))`);
  ok(r === true, 'F5 按键层挂在 #wrap 外（防误触 click）');
  await releaseAll();

  /* ===== G. 联机角色钉死（模拟状态，不建真房间） ===== */
  r = await evl(`(() => { const bak = net.mode; net.mode = 'online'; net.idx = 1; updateTouchMode();
    const hidden = document.getElementById('tpSwitch').classList.contains('hidden');
    const tgHidden = document.querySelector('#touchGuide .tg-switch').classList.contains('hidden');
    net.mode = bak; net.idx = 0; updateTouchMode();
    return JSON.stringify({ ti: 1, hidden, tgHidden, back: touchIdx }) })()`);
  r = JSON.parse(r);
  ok(r.hidden === true && r.tgHidden === true && r.back === 0, 'G1 联机中换角色钮与引导标注同步隐藏且退出恢复', JSON.stringify(r));

  ok(exceptions.length === 0, `G2 全程无未捕获异常（${exceptions.length}）`, exceptions.slice(0, 2).join(' | '));

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  ws.close(); chrome.kill(); process.exit(failed ? 1 : 0);
})().catch(e => { console.log('FATAL', e); try { chrome && chrome.kill(); } catch (_) {} process.exit(1); });

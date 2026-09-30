/* 触屏虚拟按键专项测试（CDP headless Chrome，模拟 844×390 横屏移动设备 + 400×800 竖屏旋转段）
   覆盖：DOM/三态显示 / 首启引导层 / 横屏全屏 / 竖屏旋转全屏 / 键组映射 / 多指与双指同键 / 按键尺寸与反馈 / 暂停链路 / 防卡键 / 设置接线 / 触摸延迟 / 无异常 */
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
  let r = await evl(`['touchLayer','tpPause','tpLeft','tpRight','tpJump','tpSwitch','tpFlip','rotateHint','touchSelect'].every(i=>document.getElementById(i))`);
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
  /* 触屏横屏无黑边全屏：#wrap 铺满视口 + 画布缓冲随设备比例（844×390→逻辑 866×400×DPR2）+ CSS 无拉伸 */
  r = JSON.parse(await evl(`(() => { const w = document.getElementById('wrap').getBoundingClientRect(); const cv = document.getElementById('game').getBoundingClientRect();
    return JSON.stringify({ wrapW: Math.round(w.width), wrapH: Math.round(w.height), logW: LOGICAL_W, bufW: canvas.width, bufH: canvas.height, tf: ctx.getTransform().a,
      cvW: cv.width, cvH: cv.height, ctrls: getComputedStyle(document.querySelector('.ctrls')).display, hudPos: getComputedStyle(document.getElementById('hud')).position }) })()`));
  const ratioDiff = Math.abs(r.cvW / r.cvH - r.bufW / r.bufH);
  ok(r.wrapW >= 840 && r.wrapH >= 385 && r.logW === 866 && r.bufW === 1732 && r.bufH === 800 && r.tf === 2 && ratioDiff < 0.01 && r.ctrls === 'none' && r.hudPos === 'fixed',
    'A12 横屏全屏：wrap 铺满+缓冲 866×400×2+无拉伸(Δ比例 ' + ratioDiff.toFixed(4) + ')', JSON.stringify(r));
  await evl(`document.getElementById('hud').textContent = '第 1/23 关 · 🍰 0/1 · 🧋 0/1 · ⭐ 0/1 · 💕 0/1'`);
  await shot('touch_play_fullscreen.png');
  /* 门控回归：离开 play（title 界面）逻辑视口回 640，桌面/菜单不受全屏影响 */
  r = JSON.parse(await evl(`(() => { showScreen('title'); return JSON.stringify({ logW: LOGICAL_W, bufW: canvas.width }) })()`));
  ok(r.logW === 640 && r.bufW === 1280, 'A13 回 title 退出全屏→LOGICAL_W 回 640', JSON.stringify(r));
  await evl(`showScreen('play'); loadLevel(0, false)`);

  /* ===== A+. 竖屏旋转全屏（iPhone 开旋转锁定、物理横握：视口竖屏但画面旋转 90° 铺满） ===== */
  await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(500);   // resize → scheduleFit(150ms 防抖) → fitViewport 竖屏分支
  r = JSON.parse(await evl(`(() => { const w = document.getElementById('wrap').getBoundingClientRect();
    const cv = document.getElementById('game').getBoundingClientRect();
    const m = new DOMMatrix(getComputedStyle(document.getElementById('wrap')).transform);
    const tl = document.getElementById('tpLeft').getBoundingClientRect();
    const hit = document.elementFromPoint(tl.x + tl.width / 2, tl.y + tl.height / 2);
    return JSON.stringify({ logW: LOGICAL_W, bufW: canvas.width, bufH: canvas.height,
      wrapW: Math.round(w.width), wrapH: Math.round(w.height), cvW: cv.width, cvH: cv.height,
      cvIn: cv.left >= -1 && cv.top >= -1 && cv.right <= innerWidth + 1 && cv.bottom <= innerHeight + 1,
      rot: Math.abs(m.a) < 0.01 && Math.abs(Math.abs(m.b) - 1) < 0.01,
      btnIn: tl.left >= 0 && tl.right <= innerWidth && tl.top >= 0 && tl.bottom <= innerHeight,
      hitBtn: !!(hit && hit.closest && hit.closest('#tpLeft')),
      hint: document.getElementById('rotateHint').textContent,
      flipVis: getComputedStyle(document.getElementById('tpFlip')).display }) })()`));
  const pRatioDiff = Math.abs(r.cvW / r.cvH - r.bufH / r.bufW);   // 旋转 90° 后 AABB 宽高互换，比缓冲反比
  ok(r.logW === 800 && r.bufW === 1600 && r.bufH === 800, 'A14 竖屏：缓冲随视口长短边（400×800→逻辑 800×400×2）', JSON.stringify(r));
  ok(r.wrapW >= 396 && r.wrapH >= 796 && r.rot, 'A15 竖屏：#wrap 旋转 90° 且铺满视口', JSON.stringify(r));
  ok(r.cvIn && pRatioDiff < 0.01, 'A16 竖屏：画布 contain 无拉伸（ΔAABB 反比 ' + pRatioDiff.toFixed(4) + '）', JSON.stringify(r));
  ok(r.btnIn && r.hitBtn && r.flipVis !== 'none', 'A17 竖屏：方向键在视口内可命中，↻ 换向钮可见', JSON.stringify(r));
  ok(typeof r.hint === 'string' && r.hint.includes('↻'), 'A18 竖屏：提示文案切换为换向引导', String(r.hint));
  await shot('touch_play_rotated.png');
  const pr = await rect('tpLeft');   // 旋转坐标系下真实触摸（rect 中心不受旋转影响）
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pr.x + pr.width / 2, y: pr.y + pr.height / 2 }] });
  r = await evl(`keys.KeyA === true`);
  ok(r === true, 'A19 竖屏旋转：真实触摸方向键生效');
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await releaseAll();
  await evl(`document.getElementById('tpFlip').click()`);
  r = JSON.parse(await evl(`(() => { const m = new DOMMatrix(getComputedStyle(document.getElementById('wrap')).transform);
    return JSON.stringify({ ccw: document.body.classList.contains('rot-ccw'), b: m.b }) })()`));
  ok(r.ccw === true && r.b < -0.99, 'A20 点 ↻→rot-ccw 反向旋转（适配另一种握姿）', JSON.stringify(r));
  await evl(`document.getElementById('tpFlip').click()`);
  r = await evl(`!document.body.classList.contains('rot-ccw')`);
  ok(r === true, 'A21 再点 ↻ 恢复正向旋转');
  await evl(`pauseGame()`); await sleep(150);   // 暂停菜单保持竖屏正向（不随画面旋转）
  r = JSON.parse(await evl(`(() => { const p = document.getElementById('pauseMenu').getBoundingClientRect();
    return JSON.stringify({ w: Math.round(p.width), h: Math.round(p.height), tf: getComputedStyle(document.getElementById('pauseMenu')).transform }) })()`));
  ok(r.w >= 396 && r.h >= 796 && (r.tf === 'none' || r.tf.startsWith('matrix(1, 0, 0, 1')),
    'A22 暂停菜单保持竖屏正向铺满视口', JSON.stringify(r));
  await evl(`resumeGame()`);
  await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await sleep(500);   // 回横屏：旋转块退出，恢复横屏全屏段
  r = JSON.parse(await evl(`JSON.stringify({ tf: getComputedStyle(document.getElementById('wrap')).transform, logW: LOGICAL_W })`));
  ok((r.tf === 'none' || r.tf.startsWith('matrix(1, 0, 0, 1')) && r.logW === 866, 'A23 回横屏：旋转退出且缓冲回横屏 866', JSON.stringify(r));

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
  r = await evl(`(() => { const b = document.getElementById('tpLeft').getBoundingClientRect(); return b.width >= 64 && b.height >= 64 })()`);
  ok(r === true, 'B10 方向键 ≥64×64px（≥44px 触摸目标下限）');
  r = JSON.parse(await evl(`(() => { const b = document.getElementById('tpRight'); const cs = getComputedStyle(b);
    const lb = document.getElementById('tpLeft').getBoundingClientRect(); const jp = document.getElementById('tpJump').getBoundingClientRect();
    return JSON.stringify({ op: parseFloat(cs.opacity), leftGap: Math.round(lb.left), rightGap: Math.round(innerWidth - jp.right),
      bottomGap: Math.round(innerHeight - jp.bottom) }) })()`));
  ok(r.op <= 0.6 && r.leftGap <= 14 && r.rightGap <= 14 && r.bottomGap <= 14,
    'B13 按键半透明(.55)且贴边（≤14px），减少手掌遮挡画面', JSON.stringify(r));
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
  // 第四重兜底：pointerup/pointercancel 全丢（iOS 长按系统手势吞事件）→ touchend reconcile 释放
  await pdown('tpJump', 61);
  r = await evl(`(() => { window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true }));
    return touchHeld.jump === false && keys.KeyW === false && !document.getElementById('tpJump').classList.contains('on') })()`);
  ok(r === true, 'C5 touchend 兜底：release 事件丢失仍可释放（iOS 长按卡键）');
  // 另一指仍按在键上时 touchend 不误释放
  await pdown('tpLeft', 62);
  r = await evl(`(() => { const b = document.getElementById('tpLeft').getBoundingClientRect();
    const t = new Touch({ identifier: 7, target: document.getElementById('tpLeft'), clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 });
    window.dispatchEvent(new TouchEvent('touchend', { touches: [t], changedTouches: [], bubbles: true }));
    return touchHeld.left === true && keys.KeyA === true })()`);
  ok(r === true, 'C6 手指仍在键上时 touchend 不误释放');
  await evl(`window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [], bubbles: true }))`);
  r = await evl(`touchHeld.left === false`);
  ok(r === true, 'C7 指抬起（touches 空）后释放');

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

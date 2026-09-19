/* 恋爱长线终章专项测试：40 层数据 / 好感门票 / 三态锁 UI / J·b·z·r 新机关逻辑 / 试炼奖励 / 联机接线 / 无异常 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9261;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let pass = 0, fail = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); fails.push(name); }
}
let chrome;
(async () => {
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_lovech', 'about:blank'], { stdio: 'ignore' });
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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); location.reload()`);
  await sleep(4000);

  /* ===== A. 数据层：40 层 / 23 章 / 新符号 ===== */
  let r = await evl(`JSON.stringify({ lv: LEVELS.length, mj: MAJORS.length, th: THEMES.length,
    ln: LEVEL_NAMES.length, sd: SUB_DIFFICULTY.length, pt: PAR_TIME.length, ll: LEVEL_LIMIT.length })`);
  let o = JSON.parse(r);
  ok(o.lv === 40 && o.mj === 23, `A1 关卡 ${o.lv} 层 / 主关 ${o.mj} 章 / 主题 ${o.th}`, r);
  ok(o.ln === 40 && o.sd === 40 && o.pt === 40 && o.ll === 40, `A2 派生数组与 LEVELS 对齐（均 ${o.ln}）`, r);
  r = await evl(`JSON.stringify(MAJORS.slice(19).map(m => ({ n: m.name, need: m.loveNeed, first: m.first, subs: m.subs.length })))`);
  o = JSON.parse(r);
  ok(JSON.stringify(o.map(x => x.need)) === JSON.stringify([340, 520, 760, 1060])
    && JSON.stringify(o.map(x => x.first)) === JSON.stringify([29, 31, 34, 37])
    && JSON.stringify(o.map(x => x.subs)) === JSON.stringify([2, 3, 3, 3]),
    `A3 新 4 章门票/起始层/层数正确（${o.map(x => x.n + ':' + x.need).join(' ')}）`, r);
  r = await evl(`JSON.stringify({ f29: LEVELS[29].join('').includes('J') && LEVELS[29].join('').includes('K'),
    f30: LEVELS[30].join('').includes('b'), f31: LEVELS[31].join('').includes('z'),
    f32: LEVELS[32].join('').includes('r'), f39: LEVELS[39].join('').includes('G') })`);
  o = JSON.parse(r);
  ok(o.f29 && o.f30 && o.f31 && o.f32 && o.f39, `A4 新机关符号落位（J/K·b·z·r·Boss）`, r);
  r = await evl(`(() => { let bad = [];
    for (let i = 0; i < LEVELS.length; i++) { const s = LEVELS[i].join('');
      const nj = (s.match(/J/g) || []).length, nk = (s.match(/K/g) || []).length;
      if (nj % 2 || nk !== nj / 2) bad.push(i + ':' + nj + '/' + nk); }
    return JSON.stringify({ bad }) })()`);
  o = JSON.parse(r);
  ok(o.bad.length === 0, `A5 全 40 层 J 成对且 K=J/2`, JSON.stringify(o.bad));
  r = await evl(`(() => { let bad = []; for (let i = 0; i < LEVELS.length; i++) if (!LEVELS[i].join('').includes('h')) bad.push(i);
    const total = LEVELS.reduce((a, lv) => a + (lv.join('').match(/h/g) || []).length, 0);
    return JSON.stringify({ bad, total }) })()`);
  o = JSON.parse(r);
  ok(o.bad.length === 0, `A6 每层至少 1 颗爱心水晶（全图共 ${o.total} 颗）`, JSON.stringify(o.bad));
  r = await evl(`JSON.stringify({ n: PHOTOS.length, bad: PHOTOS.filter(p => !p.name || p.name.includes('undefined')).length })`);
  o = JSON.parse(r);
  ok(o.n === 20 && o.bad === 0, `A7 PHOTOS ${o.n} 条且无越界名`, r);
  r = await evl(`(() => { const s = LEVELS[34].join(''); return JSON.stringify({ J: (s.match(/J/g) || []).length, K: (s.match(/K/g) || []).length }) })()`);
  o = JSON.parse(r);
  ok(o.J === 4 && o.K === 2, `A8 连压之塔双对 J/K（${o.J}板/${o.K}门）`, r);

  /* ===== B. majorReachable 好感门票 ===== */
  r = await evl(`(() => { const u0 = save.unlocked, l0 = save.love;
    save.unlocked = 29; save.love = 0; const b1 = majorReachable(19);
    save.love = 340; const b2a = majorReachable(19), b2b = majorReachable(20);
    save.love = 1060; save.unlocked = LEVELS.length - 1; const b3 = [19, 20, 21, 22].every(mi => majorReachable(mi));
    save.unlocked = 29;
    save.unlocked = 28; const b4 = majorReachable(19);
    save.love = 0; const b5 = majorReachable(0);
    save.unlocked = u0; save.love = l0; return JSON.stringify({ b1, b2a, b2b, b3, b4, b5 }) })()`);
  o = JSON.parse(r);
  ok(o.b1 === false, `B1 好感不足门票 → 第 20 章不可入`, r);
  ok(o.b2a === true && o.b2b === false, `B2 好感 340 开第 20 章、仍锁第 21 章`, r);
  ok(o.b3 === true, `B3 好感满级 1060 四章全开`, r);
  ok(o.b4 === false, `B4 线性未达前置层时满好感也不可入`, r);
  ok(o.b5 === true, `B5 旧章节无 loveNeed 不受门票影响`, r);

  /* ===== C. 选关 / 地图三态锁 ===== */
  r = await evl(`(() => { save.unlocked = 29; save.love = 100; showScreen('levels');
    const cards = document.querySelectorAll('#levelScreen .lv-card');
    const c19 = cards[19], c20 = cards[20];
    return JSON.stringify({ n: cards.length,
      cls: c19.className, badge: c19.textContent.includes('💕'),
      hint: c19.innerHTML.includes('需好感 340'),
      c20lock: c20.className.includes('locked') && !c20.className.includes('love-lock'),
      c20badge: c20.textContent.includes('🔒') }) })()`);
  o = JSON.parse(r);
  ok(o.n === 23, `C1 选关卡片 ${o.n} 张（23 主关）`, r);
  ok(o.cls.includes('love-lock') && o.badge && o.hint, `C2 好感锁：love-lock 类 + 💕 徽 + 需好感提示`, r);
  ok(o.c20lock && o.c20badge, `C3 线性锁优先：第 21 章显示 🔒 而非 💕`, r);
  r = await evl(`(() => { save.love = 340; showScreen('levels');
    const c19 = document.querySelectorAll('#levelScreen .lv-card')[19];
    return JSON.stringify({ cls: c19.className, hint: c19.innerHTML.includes('需好感') }) })()`);
  o = JSON.parse(r);
  ok(!o.cls.includes('love-lock') && !o.hint, `C4 好感达标后解锁态恢复`, r);
  r = await evl(`(() => { save.love = 100; buildMap();
    const rows = document.querySelectorAll('#mapScreen .map-row');
    return JSON.stringify({ n: rows.length, m19: rows[19] ? rows[19].innerHTML.includes('love-lock-hint') && rows[19].textContent.includes('340') : false }) })()`);
  o = JSON.parse(r);
  ok(o.n === 23 && o.m19, `C5 地图 ${o.n} 行且第 20 章带 💕340 提示`, r);

  /* ===== D. 游戏内机关逻辑 ===== */
  // D1/D2 同心连压板 J/K
  r = await evl(`(() => { loadLevel(29, true);
    return JSON.stringify({ J: padsJ.length, pairs: jPairs.length, door: !!jPairs[0].door, mom: jPairs[0].door.momentary === true }) })()`);
  o = JSON.parse(r);
  ok(o.J === 2 && o.pairs === 1 && o.door && o.mom, `D1 初见回廊：2 板配对 1 扇 momentary 金门`, r);
  r = await evl(`(() => { const pr = jPairs[0];
    const stand = (p, plate) => { p.x = plate.x + (TILE - p.w) / 2; p.y = plate.y + TILE - p.h; };
    stand(players[0], pr.a); stand(players[1], pr.b); updateLinkPlates();
    const lit = pr.door.open === true && pr.a.lit === true;
    players[1].x = pr.b.x + 200; updateLinkPlates();
    const off = pr.door.open === false;
    stand(players[1], pr.a); stand(players[0], pr.b); updateLinkPlates();
    const cross = pr.door.open === true;
    return JSON.stringify({ lit, off, cross }) })()`);
  o = JSON.parse(r);
  ok(o.lit && o.off && o.cross, `D2 连压板：各踩一块开门 / 离开即关 / 交叉亦可`, r);
  // D3 心之桥
  r = await evl(`(() => { loadLevel(30, true);
    const br = bridges[0];
    players[0].x = 100; players[0].y = 300; players[1].x = 120; players[1].y = 300; computeBridgeOn();
    const on = bridgeOn === true && isSolidAt(br.x + 20, br.y + 20, 2, 2) === true;
    players[1].x = 600; computeBridgeOn();
    const off = bridgeOn === false && isSolidAt(br.x + 20, br.y + 20, 2, 2) === false;
    return JSON.stringify({ n: bridges.length, on, off }) })()`);
  o = JSON.parse(r);
  ok(o.n >= 4 && o.on && o.off, `D3 心之桥 ${o.n} 砖：牵手实体化 / 分开消失（isSolidAt 联动）`, r);
  // D4 平衡升降台
  r = await evl(`(() => { loadLevel(31, true);
    const pl = lifts[0];
    players.forEach(p => { p.onPlat = pl; p.x = pl.x; p.y = pl.y - p.h; });
    const y0 = pl.y; for (let i = 0; i < 60; i++) updateLifts();
    const up = pl.y < y0 - 50 && Math.abs(pl.y - (pl.oy - liftOff)) < 1;
    players[1].onPlat = null; const y1 = pl.y; for (let i = 0; i < 30; i++) updateLifts();
    const hold = Math.abs(pl.y - y1) < 0.01;
    players[0].onPlat = null; const y2 = pl.y; for (let i = 0; i < 60; i++) updateLifts();
    const down = pl.y > y2 + 50;
    return JSON.stringify({ n: lifts.length, up, hold, down }) })()`);
  o = JSON.parse(r);
  ok(o.n === 1 && o.up && o.hold && o.down, `D4 升降台：双人升 / 单人停 / 无人降且 y=oy-liftOff`, r);
  // D5 节奏火墙相位
  r = await evl(`(() => { loadLevel(32, true);
    const f = flames.find(x => x.sync === true);
    players[0].x = f.x - 12; players[0].y = f.baseY - 38;
    animT = 0.5; const fatalOn = checkHazardsFatal();
    animT = 2.0; const fatalOff = checkHazardsFatal();
    return JSON.stringify({ has: !!f, cyc: RHYTHM_CYCLE, on: RHYTHM_ON, fatalOn, fatalOff }) })()`);
  o = JSON.parse(r);
  ok(o.has && Math.abs(o.cyc - 3.6) < 1e-9 && o.on === 1.2 && o.fatalOn === true && o.fatalOff === false, `D5 节奏火墙：同相位 亮1.2/灭2.4 判定正确`, r);
  // D6 渲染冒烟（drawBridges/drawLinkPlates/drawPlats lift 分支）
  r = await evl(`(() => { try { loadLevel(30, true); computeBridgeOn(); render(); loadLevel(31, true); updateLifts(); render(); loadLevel(29, true); updateLinkPlates(); render(); return 'OK' } catch (e) { return 'ERR:' + e.message } })()`);
  ok(r === 'OK', `D6 三层新机关渲染冒烟无异常`, String(r));
  // D7 overlay 标题
  r = await evl(`(() => { loadLevel(29, false); return document.getElementById('overlay').textContent })()`);
  ok(typeof r === 'string' && r.includes('心之试炼') && r.includes('初见回廊'), `D7 开场标题带「💕 心之试炼」`, String(r).slice(0, 80));

  /* ===== E. recordWin 试炼奖励 ===== */
  r = await evl(`(() => { localStorage.removeItem('onetwobubu_save_v1');
    save.unlocked = 29; save.best = {}; save.stars = {}; save.subs = {}; save.bonusStars = 0; save.photos = []; save.love = 0; save.heartLv = {}; save.album = null; ensureAlbum();
    curLevel = 29; starsGot = 0; const m0 = save.album.moments.length;
    recordWin('S'); const gain = save.love;
    const memo = save.album.moments.slice(m0).map(x => x.t).join('|');
    return JSON.stringify({ gain, memo: memo.includes('心之试炼'), unlocked: save.unlocked }) })()`);
  o = JSON.parse(r);
  ok(o.gain === 25, `E1 试炼层首通好感 +25（10+15）`, r);
  ok(o.memo, `E2 时光轴写入「心之试炼」纪念`, r);
  ok(o.unlocked === 30, `E3 通关后线性推进 unlocked=30`, r);
  r = await evl(`(() => { const l0 = save.love; recordWin('S'); return save.love - l0 })()`);
  ok(r === 0, `E4 重复通关不再发试炼奖励`, String(r));
  r = await evl(`(() => { save.subs = {}; save.best = {}; save.stars = {}; save.unlocked = 0; save.love = 0; ensureAlbum();
    curLevel = 0; starsGot = 0; recordWin('S'); return save.love })()`);
  ok(r === 10, `E5 旧章节首通仍 +10（无试炼加成）`, String(r));

  /* ===== F. 联机接线（源码断言） ===== */
  r = await evl(`fetch('net.js').then(t => t.text()).then(txt => { const i = txt.indexOf('function guestFrame');
    return JSON.stringify({ lz: txt.includes('lz:') && txt.includes('m.lz'),
      gb: i >= 0 && txt.slice(i, i + 4000).includes('computeBridgeOn()') }) }).catch(e => 'FETCH_ERR:' + e.message)`);
  o = JSON.parse(r);
  ok(o.lz, `F1 快照含 lz 字段（主机发出 + 客机应用）`, r);
  ok(o.gb, `F2 客机 guestFrame 本地推导 bridgeOn`, r);

  /* ===== G. 无异常 ===== */
  ok(exceptions.length === 0, `G1 全程无未捕获异常（${exceptions.length}）`, exceptions.slice(0, 2).join(' | '));

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FATAL', e); try { chrome.kill(); } catch (_) {} process.exit(1); });

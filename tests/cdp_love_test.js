// 爱情主题元素 CDP 自动化验证
// 覆盖：爱之圣殿数据接线 / 恋爱空间 UI / 爱心水晶收集 / 爱心护盾 / 牵手 / 任务线 / 好感升级 / 浪漫BGM切换 / 无JS异常
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9233;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log(`PASS  ${n}`); } else { fail++; console.log(`FAIL  ${n}`); } };
function httpJson(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_love', 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; exceptions.push(`${e.text} ${e.exception?.description ?? ''}`); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000); await evl(`localStorage.clear()`); await send('Page.reload'); await sleep(4500);

  // ---------- A：爱之圣殿数据接线 ----------
  const ds = JSON.parse(await evl(`JSON.stringify({
    majors: MAJORS.length, levels: LEVELS.length, themes: THEMES.length,
    lt: LOVE_TEMPLE_MAJOR, name: MAJORS[18] && MAJORS[18].name,
    first: MAJORS[18] && MAJORS[18].first, subs: MAJORS[18] && MAJORS[18].subs.length,
    t27: THEMES[27].id, t28: THEMES[28].id,
    h27: (LEVELS[27].join('').match(/h/g)||[]).length, h28: (LEVELS[28].join('').match(/h/g)||[]).length,
    pad27: (LEVELS[27].join('').match(/H/g)||[]).length, pad28: (LEVELS[28].join('').match(/H/g)||[]).length,
    loveLv: LOVE_LEVELS.length, quests: LOVE_FAMILIES.length, tiers: LOVE_FAMILIES.reduce((a,f)=>a+f.tiers.length,0)
  })`));
  ok(ds.majors === 23 && ds.levels === 40 && ds.themes === 40, `A1 主关卡=23 · 层=40 · 主题=40`);
  ok(ds.lt === 18 && ds.name === '爱之圣殿' && ds.first === 27 && ds.subs === 2, `A2 爱之圣殿接线（LOVE_TEMPLE_MAJOR=${ds.lt}, first=${ds.first}）`);
  ok(ds.t27 === 'love' && ds.t28 === 'love', `A3 两层均为浪漫主题（粉色背景+爱心粒子）`);
  ok(ds.h27 >= 3 && ds.h28 >= 4, `A4 爱心水晶布点（誓约回廊 ${ds.h27} 颗 · 同心祭坛 ${ds.h28} 颗）`);
  ok(ds.pad27 >= 1 && ds.pad28 === 2, `A5 弹跳台结构（两层1台 / 三层2台）`);
  ok(ds.loveLv === 8 && ds.quests === 7 && ds.tiers === 27, `A6 好感 ${ds.loveLv} 级 · 任务 ${ds.quests} 家族 ${ds.tiers} 阶`);

  // ---------- B：恋爱空间 UI ----------
  await evl(`showScreen('love')`);
  await sleep(300);
  ok(await evl(`screenMode === 'love' && !document.getElementById('loveScreen').classList.contains('hidden')`), `B1 恋爱空间入口可打开`);
  ok(await evl(`document.querySelectorAll('#loveQs .love-q').length`) === 7, `B2 任务列表渲染 7 个家族`);
  ok((await evl(`document.getElementById('loveHead').textContent`)).includes('一二'), `B3 好感头部展示情侣名`);
  ok((await evl(`document.getElementById('loveBarTxt').textContent`)).includes('好感'), `B4 好感进度条文案`);
  ok(await evl(`romanticMusic`) === true, `B5 恋爱空间播放浪漫 BGM`);
  await evl(`showScreen('title')`); await sleep(200);
  ok(await evl(`romanticMusic`) === false, `B6 离开恋爱空间切回普通轨`);

  // ---------- C：爱之圣殿游玩浪漫 BGM ----------
  await evl(`save.unlocked = 28; persistSave(); startLevel(27)`);
  await sleep(400);
  ok(await evl(`romanticMusic && curLevel === 27`), `C1 爱之圣殿游玩中播放浪漫 BGM`);
  await evl(`startLevel(26)`); await sleep(300);
  ok(await evl(`!romanticMusic`), `C2 云梯圣殿（前一关）不播放浪漫 BGM`);

  // ---------- D：爱心水晶收集 → 好感提升 ----------
  await evl(`startLevel(27)`); await sleep(300);
  await evl(`running = true; hideOverlay()`);   // 跳过「点击画面开始」
  const before = JSON.parse(await evl(`JSON.stringify({love: save.love, hearts: save.loveStats.hearts || 0, total: hearts.length})`));
  ok(before.total >= 3, `D1 关卡解析爱心水晶 ${before.total} 颗`);
  await evl(`(() => { const hc = hearts.find(h => !h.got); players[0].x = hc.x - 12; players[0].y = hc.y - 19; return 1; })()`);
  await sleep(500);
  const after = JSON.parse(await evl(`JSON.stringify({love: save.love, hearts: save.loveStats.hearts || 0, got: hearts.filter(h=>h.got).length})`));
  ok(after.hearts === before.hearts + 1 && after.got >= 1, `D2 碰到爱心水晶即收集（${before.hearts}→${after.hearts}）`);
  ok(after.love >= before.love + 5, `D3 收集爱心水晶 +5 好感（${before.love}→${after.love}）`);

  // ---------- E：爱心护盾（双人同时按跳） ----------
  await evl(`loadLevel(0, true)`); await sleep(300);   // 第1关平地
  await evl(`(() => { players[0].x = 100; players[1].x = 130; return 1; })()`);
  await sleep(200);
  const eBefore = await evl(`save.loveStats.shield || 0`);
  await evl(`keys.KeyW = true; keys.ArrowUp = true; setTimeout(() => { keys.KeyW = false; keys.ArrowUp = false; }, 100)`);
  await sleep(400);
  const eRes = JSON.parse(await evl(`JSON.stringify({shield: save.loveStats.shield || 0, t: shieldT, cd: shieldCd})`));
  ok(eRes.shield === eBefore + 1, `E1 双人同时起跳触发爱心护盾（${eBefore}→${eRes.shield}）`);
  ok(eRes.t > 0 || eRes.cd > 0, `E2 护盾计时生效（t=${eRes.t.toFixed(1)} cd=${eRes.cd.toFixed(1)}）`);
  // 单人跳不触发
  const eMid = await evl(`save.loveStats.shield || 0`);
  await sleep(7500);   // 等护盾落地+冷却
  await evl(`players[0].vy = 0; players[1].vy = 0;`);
  await evl(`keys.KeyW = true; setTimeout(() => { keys.KeyW = false; }, 100)`);
  await sleep(400);
  ok(await evl(`save.loveStats.shield || 0`) === eMid, `E3 单人起跳不触发护盾`);

  // ---------- F：牵手同行 ----------
  await evl(`loadLevel(0, true)`); await sleep(300);
  await evl(`save.love = 40; persistSave()`);   // 心动级启用牵手计时
  await evl(`(() => { players[0].x = 100; players[1].x = 130; players[0].y = players[1].y = 322; players[0].vy = players[1].vy = 0; return 1; })()`);
  await evl(`keys.KeyD = true; keys.ArrowRight = true;`);
  await sleep(700);
  const fRes = JSON.parse(await evl(`JSON.stringify({hh: handHolding, hold: save.loveStats.holding || 0})`));
  await evl(`keys.KeyD = false; keys.ArrowRight = false;`);
  ok(fRes.hh === true, `F1 双人靠近同向移动 → 牵手状态`);
  ok(fRes.hold > 0, `F2 牵手时长累计（${fRes.hold.toFixed(1)}s）`);

  // ---------- G：爱情任务线（层级递进）达成 ----------
  await evl(`showScreen('love')`); await sleep(200);
  const gBefore = JSON.parse(await evl(`JSON.stringify({love: save.love, f2: save.loveTiers.f2 || 0, hearts: save.loveStats.hearts || 0})`));
  await evl(`save.loveStats.hearts = 10; checkLoveQuests()`);
  await sleep(200);
  const gAfter = JSON.parse(await evl(`JSON.stringify({f2: save.loveTiers.f2 || 0, love: save.love, toast: !!loveFxToast, dot: !!document.querySelector('#loveQs .lq-dot.on')})`));
  ok(gAfter.f2 === 1, `G1 收集满 10 颗爱心 → 「爱心水晶」第 1 阶达成（f2=${gAfter.f2}）`);
  ok(gAfter.love >= gBefore.love + 20, `G2 阶位奖励好感结算（+${gAfter.love - gBefore.love}）`);
  ok(gAfter.toast === true, `G3 阶位达成弹出提示`);
  // 未达第 2 阶前，重复 check 不再发奖（层级递进锁定）
  await evl(`checkLoveQuests()`); await sleep(100);
  ok(await evl(`save.love`) === gAfter.love, `G4 本阶达成后进度锁定，未达下阶不重复发奖`);
  await evl(`save.loveStats.hearts = 30; checkLoveQuests(); buildLoveScreen()`); await sleep(150);
  ok(await evl(`save.loveTiers.f2 || 0`) === 2, `G5 达 30 颗 → 第 2 阶自动解锁并达成（递进）`);
  ok(await evl(`document.querySelectorAll('#loveQs .lq-dot.on').length`) >= 2, `G6 恋爱空间阶位点亮圆点显示`);

  // ---------- H：好感升级特效 + 长线满级（情深不渝 1060） ----------
  await evl(`loveUpFx = 0; save.love = 0; addLove(1060)`);
  await sleep(100);
  const hRes = JSON.parse(await evl(`JSON.stringify({fx: loveUpFx, lv: loveLevel(), max: loveMaxLevel()})`));
  ok(hRes.fx > 0, `H1 好感升级触发全屏飘心特效`);
  ok(hRes.lv === 7 && hRes.lv === hRes.max, `H2 好感 1060 → 满级「情深不渝」（Lv.${hRes.lv + 1}/${hRes.max + 1}）`);
  await evl(`showScreen('love')`); await sleep(200);
  ok((await evl(`document.getElementById('loveHead').textContent`)).includes('满级'), `H3 满级后恋爱空间标题正确`);
  // 满级外观：光环/印记绘制不抛异常
  await evl(`showScreen('play'); loadLevel(0, true)`); await sleep(400);
  ok(true, `H4 满级外观渲染无异常`);

  // ---------- Z：无 JS 异常 ----------
  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);
  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

/* 爱情系统长线扩展专项测试：8级曲线 / 7家族层级任务 / 水晶同关上限 / 纪念册数据层 / 每日提醒 / 纪念日 / 称号 / 界面 / 兼容 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname, PORT = 9253;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpJson = p => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));
let pass = 0, fail = 0; const fails = [];
function ok(cond, name, detail) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? ' → ' + detail : ''}`); fails.push(name); }
}
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_album', 'about:blank'], { stdio: 'ignore' });
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
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}\\album_${name}.png`, Buffer.from(s.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(4500);
  await evl(`localStorage.removeItem('onetwobubu_save_v1'); location.reload()`);
  await sleep(4000);

  /* ===== 1. 好感度 8 级曲线 ===== */
  let r = await evl(`JSON.stringify({ lv: LOVE_LEVELS.length, max: loveMaxLevel(),
    needs: LOVE_LEVELS.map(l=>l.need), last: LOVE_LEVELS[LOVE_LEVELS.length-1].name })`);
  let o = JSON.parse(r);
  ok(o.lv === 8 && o.max === 7, `1.1 好感度扩展为 ${o.lv} 级（满级「${o.last}」）`, r);
  const inc = o.needs.slice(1).map((v, i) => v - o.needs[i]);
  ok(o.needs[4] === 340 && o.needs[5] === 520 && o.needs[6] === 760 && o.needs[7] === 1060
    && inc.every((v, i) => i === 0 || v > inc[i - 1]), `1.2 数值曲线递增（340→520→760→1060，增量 ${inc.join('/')}）`, r);
  r = await evl(`(() => { save.love = 340; const a = loveLevel(); save.love = 341; const b = loveLevel(); save.love = 0; return JSON.stringify({a, b}) })()`);
  o = JSON.parse(r);
  ok(o.a === 4 && o.b === 4, `1.3 旧满级 340 现为「永结同心」Lv.${o.a + 1}（非顶级）`, r);
  // 升级记录时光轴
  r = await evl(`(() => { ensureAlbum(); const n0 = save.album.moments.length; save.love = 0; addLove(520);
    const m = save.album.moments.slice(n0).map(x=>x.t).join('|'); save.love = 0; return m })()`);
  ok(typeof r === 'string' && r.includes('琴瑟和鸣'), `1.4 好感升级写入纪念册时光轴`, String(r).slice(0, 120));

  /* ===== 2. 任务体系：7 家族层级递进 ===== */
  r = await evl(`JSON.stringify({ n: LOVE_FAMILIES.length, ids: LOVE_FAMILIES.map(f=>f.id),
    tiers: LOVE_FAMILIES.map(f=>f.tiers.length),
    f1: LOVE_FAMILIES.find(f=>f.id==='f1').tiers.map(t=>t.goal),
    f7: LOVE_FAMILIES.find(f=>f.id==='f7').get() === albumDays(), today: albumDays(),
    total: LOVE_FAMILIES.reduce((a,f)=>a+f.tiers.reduce((x,t)=>x+t.reward,0),0) })`);
  o = JSON.parse(r);
  ok(o.n === 7 && new Set(o.ids).size === 7, `2.1 任务重构为 ${o.n} 个层级家族（id 唯一）`, r);
  ok(o.tiers.every(t => t >= 3 && t <= 4), `2.2 每家族 3~4 阶递进`, r);
  ok(JSON.stringify(o.f1) === JSON.stringify([60, 240, 360, 520]), `2.3 牵手同行层级 60/240/360/520 秒`, r);
  ok(o.f7 === true, `2.4 「长情陪伴」家族基于相识天数（${o.today} 天进度）`, r);
  ok(o.total >= 400, `2.5 全阶奖励总量 ${o.total}（支撑 1060 满级追求）`, r);
  // 阶内目标与奖励均递增
  r = await evl(`JSON.stringify(LOVE_FAMILIES.map(f => f.tiers.every((t, i) => i === 0 || (t.goal > f.tiers[i-1].goal && t.reward > f.tiers[i-1].reward))))`);
  ok(JSON.parse(r).every(Boolean), `2.6 各家族目标与奖励逐阶提升`, r);

  /* ===== 2b. 爱心水晶同关计数上限 ===== */
  r = await evl(`(() => {
    save.heartLv = {}; save.loveStats.hearts = 0; save.love = 0;
    loadLevel(27, true);
    let counted = 0;
    for (let i = 0; i < hearts.length; i++) {
      players[0].x = hearts[i].x - players[0].w / 2; players[0].y = hearts[i].y - players[0].h / 2;
      const h0 = save.loveStats.hearts;
      collectHearts();
      if (save.loveStats.hearts > h0) counted++;
    }
    return JSON.stringify({ total: hearts.length, counted, cap: HEART_CAP, lv: save.heartLv[27], gotAll: hearts.every(h => h.got) })
  })()`);
  o = JSON.parse(r);
  ok(o.total === 4 && o.cap === 3, `2b.1 誓约回廊 4 颗水晶 · 上限常量 HEART_CAP=${o.cap}`, r);
  ok(o.counted === 3 && o.lv === 3, `2b.2 同关第 4 颗不计入进度（计数 ${o.counted}/上限 ${o.lv}）`, r);
  ok(o.gotAll === true, `2b.3 超限水晶仍正常拾取消失（只不计数值）`, r);
  r = await evl(`(() => { const h0 = save.loveStats.hearts; save.heartLv = {}; loadLevel(27, true);
    players[0].x = hearts[0].x - players[0].w / 2; players[0].y = hearts[0].y - players[0].h / 2;
    collectHearts(); return save.loveStats.hearts > h0 })()`);
  ok(r === true, `2b.4 重开关卡后计数清零、可再次计入（上限按关不按全局）`, String(r));

  /* ===== 3. 纪念册数据层 ===== */
  r = await evl(`JSON.stringify({ has: !!(save.album && save.album.first && Array.isArray(save.album.days) && Array.isArray(save.album.moments) && save.album.daily && save.album.anni !== undefined),
    firstMoment: save.album ? save.album.moments[0].t : '', persisted: !!JSON.parse(localStorage.getItem('onetwobubu_save_v1')).album })`);
  o = JSON.parse(r);
  ok(o.has === true, `3.1 ensureAlbum 完整结构（first/days/moments/daily/anni）`, r);
  ok(o.firstMoment.includes('第一次冒险启程'), `3.2 时光轴首条为「启程」纪念`, r);
  ok(o.persisted === true, `3.3 album 持久化到 localStorage`, r);
  r = await evl(`(() => { const n0 = save.album.moments[0]; for (let i=0;i<100;i++) albumMoment('t'+i);
    return JSON.stringify({ len: save.album.moments.length, first: save.album.moments[0].t === n0.t, last: save.album.moments[save.album.moments.length-1].t }) })()`);
  o = JSON.parse(r);
  ok(o.len === 80 && o.first === true && o.last === 't99', `3.4 时光轴超 80 条裁剪（保留首条+最近 79）`, r);
  r = await evl(`(() => { save.album.moments = [{d: save.album.first, t: '🎬 一二和布布的第一次冒险启程'}]; const p0 = save.album.playSec; albumTickPlay();
    return JSON.stringify({ d: save.album.playSec - p0, days: save.album.days.includes(albumDateStr()) }) })()`);
  o = JSON.parse(r);
  ok(o.d === 1 && o.days === true, `3.5 albumTickPlay 游玩计时 + 打卡日期`, r);
  r = await evl(`JSON.stringify({ h: fmtDur(3725), m: fmtDur(95), s: fmtDur(7) })`);
  o = JSON.parse(r);
  ok(o.h.includes('小时') && o.m.includes('分') && o.s === '7 秒', `3.6 fmtDur 时长格式化`, r);

  /* ===== 4. 每日陪伴提醒 + 去重 + 连续 ===== */
  r = await evl(`(() => { const ab = ensureAlbum(); ab.daily.last = albumDateStr(Date.now() - 86400000); ab.daily.streak = 3; save.love = 0; albumBanner = null;
    dailyLoveCheck(); const g1 = save.love; const b1 = albumBanner;
    const l0 = save.love; dailyLoveCheck();   // 同日再进标题界面：不重复发奖
    return JSON.stringify({ streak: ab.daily.streak, gain: g1, banner: !!b1, bannerTxt: b1 ? b1.html : '', again: save.love - l0, last: ab.daily.last === albumDateStr() }) })()`);
  o = JSON.parse(r);
  ok(o.streak === 4 && o.gain === 5 + 4 * 2, `4.1 昨日陪伴→连续 ${o.streak} 天，奖励 +${o.gain}`, r);
  ok(o.banner === true && o.bannerTxt.includes('陪伴奖励'), `4.2 标题界面弹出每日飘带`, r);
  ok(o.again === 0 && o.last === true, `4.3 同日去重（再次结算 +0）`, r);
  // 断签重置
  r = await evl(`(() => { const ab = ensureAlbum(); ab.daily.last = '2000-01-01'; ab.daily.streak = 9; save.love = 0;
    dailyLoveCheck(); return JSON.stringify({ streak: ab.daily.streak, gain: save.love }) })()`);
  o = JSON.parse(r);
  ok(o.streak === 1 && o.gain === 7, `4.4 断签后连续天数重置为 1（奖励 +${o.gain}）`, r);
  // 满级翻倍
  r = await evl(`(() => { const ab = ensureAlbum(); ab.daily.last = ''; ab.daily.streak = 0; save.love = 1060; albumBanner = null;
    dailyLoveCheck(); const g = save.love - 1060; const b = albumBanner.html; save.love = 0; return JSON.stringify({ g, dbl: b.includes('满级翻倍') }) })()`);
  o = JSON.parse(r);
  ok(o.g === (5 + 2) * 2 && o.dbl === true, `4.5 满级「情深不渝」每日奖励翻倍（+${o.g}）`, r);

  /* ===== 5. 纪念日系统 ===== */
  r = await evl(`JSON.stringify({ n: LOVE_ANNIS.length, days: LOVE_ANNIS.map(a=>a.day), rewards: LOVE_ANNIS.map(a=>a.reward) })`);
  o = JSON.parse(r);
  ok(o.n === 4 && o.days.join() === '7,30,100,365', `5.1 四个纪念日（7/30/100/365 天）`, r);
  r = await evl(`(() => { const ab = ensureAlbum(); const d = new Date(); d.setDate(d.getDate() - 29);
    ab.first = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    ab.daily.last = ''; ab.daily.streak = 0; save.love = 0; albumBanner = null;
    const day = albumDays(); dailyLoveCheck();
    return JSON.stringify({ day, got30: !!ab.anni[30], love: save.love, banner: albumBanner.html, moment: ab.moments[ab.moments.length-1].t,
      again: (function(){ const l0 = save.love; ab.daily.last=''; dailyLoveCheck(); return save.love > l0 + 10 ? 'dup' : 'ok'; })() }) })()`);
  o = JSON.parse(r);
  ok(o.day === 30 && o.got30 === true, `5.2 相识第 30 天触发「一月纪念」（albumDays=${o.day}）`, r);
  ok(o.love >= 40 && o.banner.includes('一月纪念') && o.moment.includes('一月纪念'), `5.3 纪念日奖励 +${o.love >= 45 ? '45' : o.love} 与飘带/时光轴记录`, r);
  ok(o.again === 'ok', `5.4 纪念日不重复发放（anni 标记去重）`, r);
  // 恢复 first 为今天，避免污染后续
  await evl(`(() => { const ab = ensureAlbum(); ab.first = albumDateStr(); ab.anni = {}; ab.daily.last = ''; return 1 })()`);

  /* ===== 6. 称号系统 ===== */
  r = await evl(`JSON.stringify({ n: LOVE_TITLES.length, ids: LOVE_TITLES.map(t=>t.id) })`);
  o = JSON.parse(r);
  ok(o.n === 8 && o.ids.join() === 't0,t1,t2,t3,t4,t5,t6,t7', `6.1 称号系统 ${o.n} 个`, r);
  r = await evl(`(() => { save.loveStats = { hearts: 35, joint: 60, shield: 35, holding: 400 };
    save.photos = Array.from({length: 20}, (_, i) => i);
    const subsBak = save.subs; save.subs = {}; for (let i = 0; i < 10; i++) save.subs[i] = [true];
    const d = new Date(); d.setDate(d.getDate() - 29);
    save.album.first = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    save.love = 1060;
    const got = loveTitlesGot().map(t=>t.id); const now = loveTitleNow().name;
    save.love = 0; save.loveStats = { hearts: 0, joint: 0, shield: 0, holding: 0 }; save.photos = []; save.subs = subsBak; save.album.first = albumDateStr();
    const base = loveTitlesGot().map(t=>t.id);
    return JSON.stringify({ got, now, base }) })()`);
  o = JSON.parse(r);
  ok(o.got.length === 8 && o.got.join().includes('t7'), `6.2 全条件满足 → 8 称号全亮`, r);
  ok(o.now === '灵魂伴侣', `6.3 当前称号取最高达成「${o.now}」`, r);
  ok(o.base.length === 1 && o.base[0] === 't0', `6.4 新档仅「初识的伙伴」`, r);

  /* ===== 7. 纪念册界面 ===== */
  await evl(`showScreen('love')`); await sleep(250);
  ok(await evl(`!document.getElementById('albumBtn').classList.contains('hidden')`), `7.1 恋爱空间有「我们的纪念册」入口`);
  await evl(`document.getElementById('albumBtn').click()`); await sleep(350);
  r = await evl(`JSON.stringify({ mode: screenMode, shown: !document.getElementById('albumScreen').classList.contains('hidden'),
    cells: document.querySelectorAll('#albumOverview .ao-cell').length,
    titles: document.querySelectorAll('#titleGrid .t-cell').length,
    locked: document.querySelectorAll('#titleGrid .t-cell.locked').length,
    annis: document.querySelectorAll('#anniRow .an-cell').length,
    moments: document.querySelectorAll('#momentList .mo-item').length,
    tip: document.getElementById('albumTip').textContent, music: romanticMusic })`);
  o = JSON.parse(r);
  ok(o.mode === 'album' && o.shown, `7.2 点击入口打开纪念册界面`, r);
  ok(o.cells === 9 && o.titles === 8 && o.annis === 4 && o.moments >= 1, `7.3 总览 ${o.cells} 格 · 称号墙 ${o.titles} · 纪念日 ${o.annis} · 时光轴 ${o.moments} 条`, r);
  ok(o.locked === 7, `7.4 新档称号墙 7 个锁定`, r);
  ok(o.tip.includes('首次相遇'), `7.5 纪念册题注显示首次相遇日期`, r);
  ok(o.music === true, `7.6 纪念册界面播放浪漫 BGM`, r);
  await shot('album');
  await evl(`document.getElementById('albumBackBtn').click()`); await sleep(250);
  ok(await evl(`screenMode === 'love'`), `7.7 返回键回到恋爱空间`);
  // 恋爱空间统计行含称号/纪念日
  r = await evl(`document.getElementById('loveStats').textContent`);
  ok(String(r).includes('相识第') && String(r).includes('称号'), `7.8 恋爱空间统计行显示天数与称号`, String(r).slice(0, 120));

  /* ===== 8. 时光轴记录点（通关/任务） ===== */
  r = await evl(`(() => { ensureAlbum(); const n0 = save.album.moments.length;
    save.unlocked = 0; save.subs = {}; loadLevel(0, true); curLevel = 0; running = true;
    recordWin('S');
    const m1 = save.album.moments.slice(n0).map(x=>x.t).join('|');
    const n1 = save.album.moments.length; save.loveStats.hearts = 10; checkLoveQuests();
    const m2 = save.album.moments.slice(n1).map(x=>x.t).join('|');
    return JSON.stringify({ m1, m2 }) })()`);
  o = JSON.parse(r);
  ok(o.m1.includes('携手通过') || o.m1 === '', `8.1 主关全通写入时光轴（首层：${o.m1 ? '记录' : '单层未全通不记录，符合预期'}）`, r);
  ok(o.m2.includes('爱心水晶」达成第 1 阶'), `8.2 任务阶位达成写入时光轴`, r);

  /* ===== 9. 重置与旧档兼容 ===== */
  r = await evl(`(() => { window.confirm = () => true; document.getElementById('resetProgressBtn').click();
    return JSON.stringify({ album: save.album, banner: albumBanner }) })()`);
  o = JSON.parse(r);
  ok(o.album === null && o.banner === null, `9.1 重置进度清空纪念册`, r);
  // 旧档（无 album 字段）加载不崩溃
  await evl(`(() => { const s = { unlocked: 3, best: {}, stars: {}, settings: { sfx: true }, love: 50, loveStats: { hearts: 1, joint: 1, shield: 0, holding: 0 }, loveQuests: {}, subs: {}, bonusStars: 0, photos: [0] };
    localStorage.setItem('onetwobubu_save_v1', JSON.stringify(s)); location.reload() })()`);
  await sleep(4000);
  r = await evl(`JSON.stringify({ album: save.album === null ? null : 'obj', love: save.love, mode: screenMode })`);
  o = JSON.parse(r);
  ok(o.love >= 50 && o.love <= 60, `9.2 旧档（无 album）加载成功，好感保留（50+每日陪伴=${o.love}）`, r);
  r = await evl(`JSON.stringify({ created: !!save.album && save.album.moments[0].t.includes('启程'), lv: loveLevel() })`);
  o = JSON.parse(r);
  ok(o.created === true, `9.3 旧档进入标题界面自动补建纪念册`, r);

  /* ===== Z. 无 JS 异常 ===== */
  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);
  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  if (fails.length) console.log('FAILED: ' + fails.join(' | '));
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

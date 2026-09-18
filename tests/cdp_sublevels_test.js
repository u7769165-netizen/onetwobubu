// 多层级闯关机制 CDP 自动化验证
// 覆盖：数据结构/选关UI/选层UI/层级地图/子层级流转/首通奖励/进度持久化/时间限制/自由回访/旧档兼容
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
}

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
    '--window-size=1280,900', '--no-first-run', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--user-data-dir=' + OUT + '\\profile_sub', 'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 30; i++) { try { targets = await httpJson('/json'); break; } catch (e) { await sleep(500); } }
  if (!targets) { console.log('FATAL: no devtools'); chrome.kill(); process.exit(1); }

  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const e = m.params.exceptionDetails;
      exceptions.push(`${e.text} ${e.exception?.description ?? ''}`);
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT + '\\sub_' + name, Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---------- Phase A：干净起步 + 数据结构 ----------
  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000);
  await evl(`localStorage.clear()`);
  await send('Page.reload');
  await sleep(4500); // 等图片抠图

  const ds = await evl(`JSON.stringify({
    majors: MAJORS.length, levels: LEVELS.length, names: LEVEL_NAMES.length,
    themes: THEMES.length, par: PAR_TIME.length, diff: SUB_DIFFICULTY.length, limit: LEVEL_LIMIT.length,
    m12: majorOf(12), s12: subOf(12), m13: majorOf(13), s13: subOf(13), m24: majorOf(24), s24: subOf(24),
    lim17: LEVEL_LIMIT[17], lim18: LEVEL_LIMIT[18], lim19: LEVEL_LIMIT[19], lim12: LEVEL_LIMIT[12],
    first13: MAJORS[13].first, first16: MAJORS[16].first
  })`);
  const d = JSON.parse(ds);
  ok(d.majors === 23 && d.levels === 40 && d.names === 40, `A1 数据派生数组长度一致 (majors=${d.majors} levels=${d.levels})`);
  ok(d.themes === 40 && d.par === 40 && d.diff === 40 && d.limit === 40, `A2 THEMES/PAR/DIFF/LIMIT=40`);
  ok(d.m12 === 12 && d.s12 === 0 && d.m13 === 12 && d.s13 === 1 && d.m24 === 16 && d.s24 === 2, `A3 majorOf/subOf 映射正确`);
  ok(d.lim17 === 55 && d.lim18 === 50 && d.lim19 === 60 && d.lim12 === 0, `A4 限时配置 (时之55/50s · 风暴60s · 双塔不限)`);
  ok(d.first13 === 14 && d.first16 === 22, `A5 first 累计偏移正确`);

  // ---------- Phase B：选关 / 选层 / 地图 UI ----------
  await evl(`showScreen('levels')`);
  await sleep(300);
  ok(await evl(`document.querySelectorAll('#lvGrid .lv-card').length`) === 23, `B1 选关界面 23 张主关卡卡片`);
  ok(await evl(`document.querySelectorAll('#lvGrid .lv-card')[12].className.includes('locked')`), `B2 未解锁多层关显示锁定`);
  await evl(`document.querySelectorAll('#lvGrid .lv-card')[12].click()`);
  await sleep(200);
  ok(await evl(`screenMode`) === 'levels', `B3 锁定卡片点击不进入`);

  await evl(`save.unlocked = 12; persistSave(); showScreen('levels')`);
  await sleep(200);
  await evl(`document.querySelectorAll('#lvGrid .lv-card')[12].click()`);
  await sleep(200);
  ok(await evl(`screenMode === 'subpick' && document.querySelectorAll('#spList .sp-btn').length`) === 2, `B4 双塔卡片打开选层界面(2层)`);
  ok((await evl(`document.querySelector('#spTitle').textContent`)).includes('双塔秘境'), `B5 选层标题正确`);
  ok(await evl(`document.querySelectorAll('#spList .sp-btn.locked').length`) === 1, `B6 层2未解锁显示锁定`);
  await shot('B_subpick.png');

  await evl(`showScreen('map')`);
  await sleep(200);
  ok(await evl(`document.querySelectorAll('#mapList .map-row').length`) === 23, `B7 地图 23 行主关卡`);
  ok((await evl(`document.querySelector('#mapSummary').textContent`)).includes('0/40'), `B8 地图总进度 0/40`);
  ok(await evl(`document.querySelectorAll('#mapList .map-row.cur').length`) === 1, `B9 当前位置高亮唯一`);
  await shot('B_map.png');

  // ---------- Phase C：子层级流转 + 首通奖励 + 持久化 ----------
  const winLevel = `(() => { const e = exits[0];
    players[0].x = e.x - 34; players[1].x = e.x + 12;
    players[0].y = players[1].y = e.baseY - 38;
    players[0].vy = players[1].vy = 0; return 'ok'; })()`;

  await evl(`openSubPick(12)`);
  await sleep(150);
  await evl(`document.querySelectorAll('#spList .sp-btn')[0].click()`);
  await sleep(300);
  ok(await evl(`screenMode === 'play' && curLevel === 12`), `C1 选层按钮进入 层1 (flat=12)`);
  ok((await evl(`document.querySelector('#overlay .title').textContent`)).includes('层级 1/2'), `C2 开场标题含层级信息`);
  await evl(`document.getElementById('wrap').click()`);
  await sleep(300);
  await evl(winLevel);
  await sleep(700);
  ok(await evl(`won === true`), `C3 通过层1触发胜利`);
  await shot('C_win_sub1.png');
  await sleep(4000); // 1.5s 自动转场 + 1.1s 后切层
  ok(await evl(`curLevel === 13`), `C4 自动流转到层2 (flat=13)`);
  ok(await evl(`JSON.stringify({s: save.subs[12][0] === true, u: save.unlocked === 13, b: save.bonusStars === 1})`) === '{"s":true,"u":true,"b":true}',
    `C5 subProgress/unlocked/首通奖励星 全部写入`);
  ok(await evl(`document.getElementById('subTrans').classList.contains('show')`) === false, `C6 转场已结束`);
  ok(await evl(`running === true && screenMode === 'play'`), `C7 层2自动开始运行`);

  await evl(winLevel);
  await sleep(800);
  ok(await evl(`won === true`), `C8 通过层2(末层)胜利`);
  ok((await evl(`document.querySelector('#overlay .sub').textContent`)).includes('全部层通过'), `C9 末层提示「全部层通过」`);
  await evl(`document.getElementById('wrap').click()`);   // 第1击：收起合照弹出（若解锁）
  await sleep(300);
  await evl(`document.getElementById('wrap').click()`);   // 第2击：继续流程
  await sleep(4000);
  ok(await evl(`curLevel === 14`), `C10 主关卡通关后进入下一主关首层 (迷雾深渊 flat=14)`);
  ok(await evl(`majorCleared(12) === true`), `C11 majorCleared(双塔)=true`);
  const persisted = await evl(`JSON.parse(localStorage.getItem('onetwobubu_save_v1')).subs['12']`);
  ok(Array.isArray(persisted) && persisted[0] === true && persisted[1] === true, `C12 subProgress 已持久化到 localStorage`);
  ok(await evl(`totalSubsDone() === 2`), `C13 总通过层数 = 2`);

  // ---------- Phase D：时间限制 ----------
  await evl(`startLevel(17)`);
  await sleep(300);
  await evl(`document.getElementById('wrap').click()`);
  await sleep(300);
  ok((await evl(`LEVEL_LIMIT[curLevel]`)) === 55, `D1 进入限时层 (55s)`);
  ok((await evl(`document.getElementById('hud').textContent`)).includes('⏳'), `D2 HUD 显示倒计时`);
  await evl(`levelTime = 54.9`);
  await sleep(500);
  ok(await evl(`dead === true`), `D3 超时触发死亡`);
  await shot('D_timeout.png');
  await sleep(1200);
  ok(await evl(`dead === false && levelTime < 3 && running === true`), `D4 超时后重置本层 (计时归零重开)`);

  // ---------- Phase E：自由回访 ----------
  await evl(`showScreen('levels')`);
  await sleep(200);
  await evl(`document.querySelectorAll('#lvGrid .lv-card')[12].click()`);
  await sleep(200);
  ok((await evl(`document.querySelectorAll('#spList .sp-btn')[0].textContent`)).includes('已通过'), `E1 已通过层显示回访标记`);
  await evl(`document.querySelectorAll('#spList .sp-btn')[0].click()`);
  await sleep(300);
  ok(await evl(`curLevel === 12 && screenMode === 'play'`), `E2 回访已通过层1`);
  ok(await evl(`save.unlocked`) === 14, `E3 回访不影响解锁进度`);

  // ---------- Phase F：旧档兼容 ----------
  await evl(`localStorage.setItem('onetwobubu_save_v1', JSON.stringify({unlocked:5, best:{"0":"S"}, stars:{"0":1}, settings:{sfx:false,hud:true}}))`);
  await send('Page.reload');
  await sleep(4500);
  const legacy = await evl(`JSON.stringify({u: save.unlocked, subs: typeof save.subs, bonus: save.bonusStars, line: document.getElementById('progressLine').textContent.includes('0/40')})`);
  ok(legacy === '{"u":5,"subs":"object","bonus":0,"line":true}', `F1 旧格式存档加载兼容 (unlocked=5, subs/ bonus 默认值, 标题进度正常)`);

  // ---------- 控制台异常 ----------
  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

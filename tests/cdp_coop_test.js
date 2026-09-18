// 云梯圣殿（协作弹跳台 H + 悬空单向平台 =）CDP 自动化验证
// 覆盖：数据接线 / 双人协作跳上二层 / 单人不可弹 / 二次协作跳上三层 / 陷阱与奖励布置 / 无JS异常
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = __dirname;
const PORT = 9225;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}`); } };

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
    '--user-data-dir=' + OUT + '\\profile_coop', 'about:blank'
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
    fs.writeFileSync(OUT + '\\coop_' + name, Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url: 'http://localhost:8765/' });
  await sleep(1000);
  await evl(`localStorage.clear()`);
  await send('Page.reload');
  await sleep(4500); // 等图片抠图

  // ---------- A：数据接线 ----------
  const ds = JSON.parse(await evl(`JSON.stringify({
    majors: MAJORS.length, levels: LEVELS.length, themes: THEMES.length,
    m17: MAJORS[17] && MAJORS[17].name, m17subs: MAJORS[17] && MAJORS[17].subs.length, m17first: MAJORS[17] && MAJORS[17].first,
    l25: LEVELS[25].join('').split('').filter(c=>c==='H').length + '/' + LEVELS[25].join('').split('').filter(c=>c==='=').length,
    l26: LEVELS[26].join('').split('').filter(c=>c==='H').length + '/' + LEVELS[26].join('').split('').filter(c=>c==='=').length,
    boss17: MAJORS[17].boss, boss16: MAJORS[16].boss, JOINT: JOINT_JUMP, CHARGE: PAD_CHARGE
  })`));
  ok(ds.majors === 23 && ds.levels === 40 && ds.themes === 40, `A1 主关卡=23 · 层=40 · 主题=40`);
  ok(ds.m17 === '云梯圣殿' && ds.m17subs === 2 && ds.m17first === 25, `A2 云梯圣殿双层接线 (first=${ds.m17first})`);
  ok(ds.l25 === '2/8' && ds.l26 === '2/8', `A3 两关各含 2 弹跳台 + 8 悬空平台 (25:${ds.l25} 26:${ds.l26})`);
  ok(ds.boss17 === false && ds.boss16 === true, `A4 BOSS 角标改为按地图含 G 判定（最终圣殿✓ 云梯圣殿✗）`);
  ok(ds.JOINT === 980 && ds.CHARGE === 0.45, `A5 协作跳参数 JOINT=980 / CHARGE=0.45s`);

  // ---------- B：载入云阶试炼，双人协作跳上二层 ----------
  await evl(`loadLevel(25, true)`);
  await sleep(300);
  const pads0 = JSON.parse(await evl(`JSON.stringify(pads.map(p => [p.x, p.y]))`));
  ok(pads0.length === 2, `B1 弹跳台解析为实体：pads=${pads0.length} 个（台①@${pads0[0]}，台②@${pads0[1]}）`);
  const nonePlats = await evl(`plats.filter(p => p.axis === 'none').length`);
  ok(nonePlats === 8, `B2 悬空平台解析：axis=none 平台 ${nonePlats} 块`);

  // 双人传送到指定高度的弹跳台（用台顶 y 区分：地面台320 / 二层台200），等待弹射，再向右漂移 driftMs 落地
  const putOnPad = (padTopY) => `(() => {
    const pad = pads.find(p => p.y === ${padTopY});
    if (!pad) return 'no-pad';
    players[0].x = pad.x + 4;  players[0].y = pad.y - 38; players[0].vx = 0; players[0].vy = 0;
    players[1].x = pad.x + 20; players[1].y = pad.y - 38; players[1].vx = 0; players[1].vy = 0;
    return [pad.x, pad.y];
  })()`;
  const launchProbe = `(() => new Promise(res => {
    let n = 0; const iv = setInterval(() => {
      n++;
      if (Math.abs(players[0].vy) > 500) { clearInterval(iv); res('launched'); }
      if (n > 120) { clearInterval(iv); res('timeout'); }
    }, 16); }))()`;
  // 弹射后保持右移，直到角色落地（onGround）或越过目标列 stopX 立即松键，避免滑进尖刺
  async function jointJump(padTopY, stopX) {
    await evl(putOnPad(padTopY));
    await sleep(150);
    const st = await evl(launchProbe);
    if (st !== 'launched') return null;
    await evl(`keys.KeyD = true; keys.ArrowRight = true`);
    const done = await evl(`(() => new Promise(res => {
      let n = 0; const iv = setInterval(() => {
        n++;
        if (players[0].onGround && players[1].onGround) { keys.KeyD = false; keys.ArrowRight = false; clearInterval(iv); res('landed'); }
        else if (players[0].x > ${stopX}) { keys.KeyD = false; keys.ArrowRight = false; }
        if (n > 150) { keys.KeyD = false; keys.ArrowRight = false; clearInterval(iv); res('timeout'); }
      }, 16); }))()`);
    await sleep(400);
    return JSON.parse(await evl(`JSON.stringify([players[0].y + 38, players[1].y + 38, players[0].onGround, players[1].onGround, players[0].x, players[1].x, dead, "${done}"])`));
  }
  const feet2 = await jointJump(320, 560);   // 落地即停；越过台①后落在二层A段（列13~14，避开列16尖刺）
  ok(feet2 && feet2[6] === false && Math.abs(feet2[0] - 200) <= 2 && Math.abs(feet2[1] - 200) <= 2 && feet2[2] && feet2[3] && feet2[4] > 520 && feet2[5] > 520,
     `B3 双人同站地面台①蓄力 0.45s → 协作弹跳落到二层实心顶(200px)：${feet2 ? `脚=${feet2[0]}/${feet2[1]} x=${feet2[4].toFixed(0)}/${feet2[5].toFixed(0)} dead=${feet2[6]}` : '未弹射'}`);
  await shot('B_secondfloor.png');

  // ---------- C：单人不可弹 + 普通跳够不到二层 ----------
  await evl(`loadLevel(25, true)`);
  await sleep(200);
  await evl(`(() => { const pad = pads.find(p => p.y === 320);
    players[1].x = 90; players[1].y = 322; players[1].vx = 0; players[1].vy = 0;
    players[0].x = pad.x + 8; players[0].y = pad.y - 38; players[0].vx = 0; players[0].vy = 0; return 1; })()`);
  await sleep(1200);
  const solo = JSON.parse(await evl(`JSON.stringify({charge: pads.find(p => p.y === 320).charge, feet: players[0].y + 38, onG: players[0].onGround})`));
  ok(solo.charge === 0 && Math.abs(solo.feet - 320) <= 2, `C1 单人站地面台不蓄力不弹射（charge=${solo.charge}，脚=${solo.feet} 仍在台顶320）`);
  // 单人普通跳（含持跳）峰值够不到二层顶 200
  await evl(`(() => { window.__minFeet = 999; const iv = setInterval(() => { const f = players[0].y + 38; if (f < window.__minFeet) window.__minFeet = f; }, 8);
    keys.KeyW = true; setTimeout(() => { keys.KeyW = false; clearInterval(iv); }, 1200); return 1; })()`);
  await sleep(1500);
  const minF = await evl(`window.__minFeet`);
  ok(minF > 205, `C2 单人普通跳峰值脚=${minF.toFixed(0)}px > 二层顶200px：无协作不可上二层`);

  // ---------- D：二次协作跳上三层云顶 ----------
  await evl(`loadLevel(25, true)`);
  await sleep(200);
  const l2 = await jointJump(320, 560);
  ok(l2 && Math.abs(l2[0] - 200) <= 2 && l2[2] && l2[3], `D1 复跳：双人经地面台①再上二层成功 ${l2 ? `(脚=${l2[0]} x=${l2[4].toFixed(0)})` : ''}`);
  const cloud = await jointJump(200, 1240);   // 台②@列28(x1120)→漂移178px落云台列32(x1280)
  ok(cloud && cloud[6] === false && Math.abs(cloud[0] - 96) <= 2 && Math.abs(cloud[1] - 96) <= 2 && cloud[2] && cloud[3],
     `D2 二层台②双人协作跳 → 三层云顶悬空平台(顶96px)：${cloud ? `脚=${cloud[0]}/${cloud[1]} x=${cloud[4].toFixed(0)}/${cloud[5].toFixed(0)} dead=${cloud[6]}` : '未弹射'}`);
  await shot('D_cloudtop.png');

  // ---------- E：陷阱与奖励布置（数据层） ----------
  const layout = JSON.parse(await evl(`JSON.stringify({
    l25row4: LEVELS[25][4], l25row5: LEVELS[25][5], l25row1: LEVELS[25][1], l25row2: LEVELS[25][2],
    l26row4: LEVELS[26][4], l26row5: LEVELS[26][5], l26row1: LEVELS[26][1], l26row2: LEVELS[26][2]
  })`));
  const r4 = layout.l25row4, r5 = layout.l25row5;
  ok(r4.includes('^') && r4.includes('s') && r5.includes('m'), `E1 二层陷阱≥2种：尖刺^ + 史莱姆s + 移动平台m（另含缺口掉落）`);
  ok(r4.includes('*') && r4.includes('l'), `E2 二层奖励：星星* + 宝石（1-2处）`);
  ok(layout.l25row1.includes('f') && layout.l25row2.includes('=') && layout.l25row1.includes('*'), `E3 三层高级陷阱火柱f + 稀有星*（悬空云台承载）`);
  ok(layout.l26row4.includes('^') && layout.l26row4.includes('s'), `E4 18.2 二层陷阱：尖刺 + 史莱姆 + 移动平台渡缺口`);
  ok(layout.l26row1.includes('f') && (layout.l26row1.match(/\*/g) || []).length === 2, `E5 18.2 三层：火柱 + 双稀有星`);

  // ---------- F：悬空平台单向性（从下穿过、从上落脚） ----------
  await evl(`loadLevel(25, true)`);
  await sleep(200);
  // 把一二放到云台正下方地面上，跳起应穿过云台不卡住
  await evl(`(() => { players[0].x = 32 * 40 + 8; players[0].y = 3 * 40; players[0].vx = 0; players[0].vy = 0;
    players[1].x = 4; players[1].y = 322; return 1; })()`);
  await sleep(500);
  const through = JSON.parse(await evl(`JSON.stringify({y: players[0].y, vy: players[0].vy, dead: dead})`));
  ok(through.dead === false, `F1 角色从云台下方起跳可穿过（单向平台不挡上升）`);
  // 从云台上方下落应站稳
  await evl(`(() => { players[0].x = 34 * 40 + 8; players[0].y = 30; players[0].vx = 0; players[0].vy = 60; return 1; })()`);
  await sleep(700);
  const land = JSON.parse(await evl(`JSON.stringify({feet: players[0].y + 38, onG: players[0].onGround})`));
  ok(land.onG && Math.abs(land.feet - 96) <= 2, `F2 从上方落到云台顶(96px)站稳：脚=${land.feet}`);

  // ---------- G：18.2 冒烟：双人协作跳全程到云顶 ----------
  await evl(`loadLevel(26, true)`);
  await sleep(200);
  const g26a = await jointJump(320, 560);   // 台①→入口段（落点列14，史莱姆在列16巡逻带左缘624px 外）
  ok(g26a && Math.abs(g26a[0] - 200) <= 2 && g26a[2] && g26a[3] && !g26a[6], `G0 18.2 地面台①协作跳上二层入口段(顶200) ${g26a ? `(脚=${g26a[0]}/${g26a[1]} x=${g26a[4].toFixed(0)})` : ''}`);
  const g26 = await jointJump(200, 1200);   // 台②@列27→漂移174px 落云台列31.4
  ok(g26 && g26[6] === false && Math.abs(g26[0] - 96) <= 2 && Math.abs(g26[1] - 96) <= 2 && g26[2] && g26[3], `G1 18.2 云顶观测：双跳链路到达三层(96px) ${g26 ? `脚=${g26[0]}/${g26[1]} x=${g26[4].toFixed(0)}/${g26[5].toFixed(0)} dead=${g26[6]}` : '未弹射'}`);
  await shot('G_level26.png');

  // ---------- Z：JS 异常 ----------
  const realErr = exceptions.filter(e => !/favicon|net::ERR/i.test(e));
  ok(realErr.length === 0, `Z1 全程无 JS 异常${realErr.length ? '\n      ' + realErr.slice(0, 3).join('\n      ') : ''}`);

  console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });

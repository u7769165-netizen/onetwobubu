/* 中继协议自测：create/join/转发/peer上线/掉线通知/房间已满 */
const { httpServer } = require('./server.js');
const assert = require('assert');

httpServer.listen(8799, async () => {
  try {
  const log = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const open = () => new Promise((res, rej) => { const ws = new WebSocket('ws://127.0.0.1:8799/ws'); ws.onopen = () => res(ws); ws.onerror = rej; });
  const msgs = ws => { ws._m = []; ws.onmessage = e => ws._m.push(JSON.parse(e.data)); return ws; };
  const got = async (ws, pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = ws._m.find(pred); if (m) return m; await wait(50); } return null; };

  const A = msgs(await open());
  A.send(JSON.stringify({ t: 'create', room: 'TEST' }));
  const wA = await got(A, m => m.t === 'welcome');
  assert(wA && wA.role === 'host', 'A 应收到 host welcome'); log.push('1 create->welcome(host) OK');

  const B = msgs(await open());
  B.send(JSON.stringify({ t: 'join', room: 'TEST' }));
  const wB = await got(B, m => m.t === 'welcome');
  assert(wB && wB.role === 'guest', 'B 应收到 guest welcome'); log.push('2 join->welcome(guest) OK');
  const pA = await got(A, m => m.t === 'peer' && m.online);
  assert(pA, 'A 应收到 peer online'); log.push('3 host 收到 peer online OK');

  B.send(JSON.stringify({ t: 'in', d: 1, j: 1 }));
  const fwd = await got(A, m => m.t === 'in');
  assert(fwd && fwd.d === 1 && fwd.j === 1, 'B->A 输入应透传'); log.push('4 转发 guest->host OK');
  A.send(JSON.stringify({ t: 'st', p: [[1, 2]] }));
  const fwd2 = await got(B, m => m.t === 'st');
  assert(fwd2 && fwd2.p[0][1] === 2, 'A->B 状态应透传'); log.push('5 转发 host->guest OK');

  const C = msgs(await open());
  C.send(JSON.stringify({ t: 'join', room: 'TEST' }));
  const errC = await got(C, m => m.t === 'error');
  assert(errC && errC.msg.includes('满'), '第三人应被拒'); log.push('6 房间已满拒绝第三人 OK');

  A.send(JSON.stringify({ t: 'st', p: [[9, 9]] }));
  await wait(250);
  assert(!A._m.some(m => m.t === 'st'), '不应收到自己发的消息'); log.push('7 无自回环 OK');

  B.close();
  const offA = await got(A, m => m.t === 'peer' && !m.online);
  assert(offA, 'A 应收到 peer offline'); log.push('8 guest 掉线通知 host OK');
  await wait(100);
  const D = msgs(await open());
  D.send(JSON.stringify({ t: 'join', room: 'TEST' }));
  const wD = await got(D, m => m.t === 'welcome');
  assert(wD && wD.role === 'guest', '重连后新 guest 应能加入'); log.push('9 掉线后房间可再加入 OK');

  A.close(); await wait(150);
  const goneD = await got(D, m => m.t === 'peer' && m.hostGone);
  assert(goneD, 'host 离开应通知 guest hostGone'); log.push('10 host 离开通知 guest OK');

  console.log(log.join('\n'));
  console.log('ALL PASS');
  process.exit(0);
  } catch (e) { console.error('FAIL:', e.message); process.exit(1); }
});

/* ================= net.js =================
   联机：状态对象 / 连接管理 / 主机广播 / 客机插值 / 联机状态条
   由 game.js 拆出。加载顺序：
   levels.js → audio.js → ui.js → save.js → sprites.js → mechanics.js → render.js → net.js → game.js
   跨文件引用说明：本文件顶层除 DOM 元素获取（netStatus/netRoomShow，DOM 已在 index.html 就绪）
   与 setInterval(updateNetBar) 外均为声明；定时器回调在全部脚本执行完后才触发，game.js 的
   loop/loadLevel/交互段对本文件函数的引用均为运行时求值，顺序无关。
   ================================================================ */

/* ================= 联机状态（全局，供各模块引用） ================= */
const net = {
  mode: 'offline', role: null, idx: 0, room: '',
  ws: null, connected: false, peerOnline: false, ping: -1,
  want: null, retryT: 1000, reconnectTimer: null,
  remoteInput: { d: 0, j: 0 }, ver: 0,
  snapBuf: [], lastSent: null, soloAllowed: false,
};
function netSend(o) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); }

/* ================================================================
   联机：连接管理 / 主机广播 / 客机插值
   ================================================================ */
const netStatusEl = document.getElementById('netStatus');
const netRoomShow = document.getElementById('netRoomShow');
let netWaiting = false, netWaitSince = 0;

function netStatus(text) { netStatusEl.textContent = text; }
function genRoomCode() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = ''; for (let i = 0; i < 4; i++) r += s[Math.floor(Math.random() * s.length)];
  return r;
}

function netConnect(action, room) {
  const url = document.getElementById('netAddr').value.trim();
  net.want = { action, room, char: +document.getElementById('netChar').value };
  net.rate = +document.getElementById('netRate').value;
  net.delay = +document.getElementById('netDelay').value;
  netStatus('连接中…');
  try { net.ws = new WebSocket(url); } catch (e) { netStatus('地址无效'); return; }
  net.ws.onopen = () => {
    net.connected = true; net.retryT = 1000;
    clearTimeout(net.reconnectTimer);
    try { localStorage.setItem('onetwobubu_net_addr', url); } catch (e) {}
    const _at = authWsToken();   // APK 跨源无 Cookie：首条消息携带 Bearer 令牌（网页同源走 Cookie，返回空跳过）
    if (_at) netSend({ t: 'auth', token: _at });
    netSend(net.want.action === 'create' ? { t: 'create', room } : { t: 'join', room });
  };
  net.ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } netOnMsg(m); };
  net.ws.onclose = net.ws.onerror = () => onNetClose();
}

function onNetClose() {
  net.connected = false; net.peerOnline = false;
  if (!net.want || net.leaving) return;
  netStatus('连接断开，' + (net.retryT / 1000) + 's 后重连…');
  if (net.role === 'guest' || net.role === 'host') {
    if (screenMode === 'play') { showOverlay('连接断开', '重连中…'); }
  }
  net.reconnectTimer = setTimeout(() => netConnect(net.want.action, net.want.room), net.retryT);
  net.retryT = Math.min(net.retryT * 2, 30000);
}

function netOnMsg(m) {
  switch (m.t) {
    case 'auth_ok': return;
    case 'needauth': authOnNeedAuth(); return;
    case 'auth_error': authOnNeedAuth(m.msg); return;
    case 'welcome':
      net.role = m.role; net.room = m.room;
      net.idx = net.want.char;
      net.mode = 'online';
      updateTouchMode();
      netStatus(m.role === 'host' ? `已连接 · 主机 · 房间 ${m.room}` : `已连接 · 客机 · 房间 ${m.room}`);
      if (m.role === 'host') { netRoomShow.textContent = m.room; netStatus('等待队友加入（房间码 ' + m.room + '）…'); }
      break;
    case 'peer':
      if (m.hostGone) {   // 主机离开：客机回大厅
        netStatus('主机已离开房间');
        net.leaving = true; net.want = null;
        try { net.ws && net.ws.close(); } catch (e) {}
        netReset(); showScreen('net');
        return;
      }
      if (net.role === 'host') {
        net.peerOnline = m.online;
        if (m.online) {
          netStatus('队友已连接，可以开始游戏');
          if (screenMode === 'play') {       // 主机在游戏中：让客机重建当前关卡
            net.ver++;
            netSend({ t: 'lv', idx: curLevel, ver: net.ver, hi: net.idx });
          }
          if (netWaiting) { netWaiting = false; net.soloAllowed = false; if (screenMode === 'play' && !won && !dead) { running = true; hideOverlay(); } }
        } else {
          netStatus('队友掉线，等待重连…');
          if (screenMode === 'play') { netWaiting = true; netWaitSince = Date.now(); running = false; showOverlay('等待队友', '对方连接中断，等待重连…'); }
        }
      }
      break;
    case 'error':
      netStatus('错误：' + m.msg);
      if (net.role) {                       // 重连场景（如主机尚未重建房间）：断开走退避重试
        try { net.ws && net.ws.close(); } catch (e) {}
      } else {                              // 大厅加入失败：停止，等用户操作
        net.leaving = true; net.want = null;
        try { net.ws && net.ws.close(); } catch (e) {}
      }
      break;
    case 'in':  if (net.role === 'host') net.remoteInput = { d: m.d | 0, j: m.j | 0 }; break;
    case 'rs':  if (net.role === 'host') loadLevel(curLevel, true); break;
    case 'pa':  if (net.role === 'guest') {
        if (m.v) { paused = true; pauseMenu.classList.remove('hidden'); }
        else { paused = false; pauseMenu.classList.add('hidden'); gAcc = 0; }
      } break;
    case 'preq': if (net.role === 'host') { if (paused) resumeGame(); else pauseGame(); } break;
    case 'lv':
      if (net.role === 'guest' && m.ver !== net.ver) netGuestLoadLevel(m.idx, m.ver, m.hi);
      break;
    case 'st':
      if (net.role === 'guest') netApplySnapshot(m);
      break;
    case 'pg':
      if (net.lastPingSent && m.ts === net.lastPingSent) { net.ping = Math.round((performance.now() - m.ts) / 2); }
      else netSend({ t: 'pg', ts: m.ts });
      break;
  }
}

function netReset() {
  net.mode = 'offline'; net.role = null; net.room = ''; net.peerOnline = false; net.ping = -1;
  net.remoteInput = { d: 0, j: 0 }; net.snapBuf = []; net.ver = 0; netWaiting = false; net.soloAllowed = false;
  clearTimeout(net.reconnectTimer);
  netBar.classList.remove('show');
}

function netLeave() {
  net.leaving = true; net.want = null;
  try { net.ws && net.ws.close(); } catch (e) {}
  net.ws = null; netReset();
  updateTouchMode();
}

/* ---------- 主机：广播与钩子 ---------- */
function netHostFrame(now) {
  if (!net.peerOnline) return;
  const interval = 1000 / (net.rate || 20);
  if (!net._lastSnap || now - net._lastSnap >= interval) {
    net._lastSnap = now;
    netSend({
      t: 'st', lv: curLevel, ver: net.ver, hi: net.idx,
      p: players.map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, Math.round(q.vx), q.face, q.mode === 'side' ? 1 : 0,
        Math.round(q.walkPhase * 100) / 100, Math.round(q.tilt * 1000) / 1000, q.onGround ? 1 : 0, q.gflip ? 1 : 0]),
      cam: Math.round(camX * 10) / 10, lt: Math.round(levelTime * 100) / 100, a: Math.round(animT * 100) / 100,
      g: gems.map(g => g.got ? 1 : 0).join(''), dr: doors.map(d => d.open ? 1 : 0).join(''),
      hc: hearts.map(h => h.got ? 1 : 0).join(''), sh: Math.round(shieldT * 10) / 10, hh: handHolding ? 1 : 0,
      bx: boxes.map(b => [Math.round(b.x), Math.round(b.y)]),
      lz: Math.round(liftOff * 10) / 10,
      st: starsGot, dd: deaths, w: won ? 1 : 0, d: dead ? 1 : 0,
      bo: boss ? [boss.hp, boss.dead ? 1 : 0, boss.projectiles.map(pr => [Math.round(pr.x), Math.round(pr.y)]),
        boss.waves.map(wv => [Math.round(wv.x), Math.round(wv.y)]), boss.weak ? 1 : 0, boss.phase, Math.round(boss.pt * 100) / 100,
        Math.round(boss.hitFlash * 100) / 100, Math.round(boss.deathT * 100) / 100, boss.attack] : 0,
    });
  }
  if (!net._lastPing || now - net._lastPing > 2000) { net._lastPing = now; net.lastPingSent = performance.now(); netSend({ t: 'pg', ts: net.lastPingSent }); }
}

function netHostAnnounceLevel() {   // loadLevel 末尾由主机调用
  net.ver++;
  netSend({ t: 'lv', idx: curLevel, ver: net.ver, hi: net.idx });
}

/* ---------- 客机 ---------- */
function netGuestLoadLevel(idx, ver, hi) {
  net.ver = ver;
  net.idx = 1 - hi;                 // 客机角色 = 主机互补
  updateTouchMode();
  net._hcSync = false;              // 新关卡：首批快照只对齐爱心状态，不补计
  loadLevel(idx, false);
  running = true; hideOverlay();
  showScreen('play');
  net.snapBuf = [];
}

function netApplySnapshot(m) {
  if (m.lv !== curLevel || m.ver !== net.ver && m.ver !== 0) {
    if (m.lv !== curLevel) { netGuestLoadLevel(m.lv, m.ver, m.hi); }
    else net.ver = m.ver;
  }
  const now = performance.now();
  net.snapBuf.push({ ts: now, m });
  if (net.snapBuf.length > 8) net.snapBuf.shift();
  // 静态/权威字段直接应用
  for (let i = 0; i < gems.length && i < m.g.length; i++) gems[i].got = m.g[i] === '1';
  for (let i = 0; i < doors.length && i < m.dr.length; i++) doors[i].open = m.dr[i] === '1';
  // 爱心水晶：客机镜像主机的收集状态；新收集瞬间同步计入客机存档（首个快照只对齐、不补计；同关同样受 HEART_CAP 上限）
  for (let i = 0; i < hearts.length && m.hc && i < m.hc.length; i++) {
    const was = hearts[i].got;
    hearts[i].got = m.hc[i] === '1';
    if (net._hcSync && !was && hearts[i].got) {
      if (heartCounted() < HEART_CAP) {
        save.heartLv[curLevel] = heartCounted() + 1;
        save.loveStats.hearts = (save.loveStats.hearts || 0) + 1;
        addLove(LOVE_HEART);
        persistSave();
      }
      sfxHeart();
      checkLoveQuests();
    }
  }
  net._hcSync = true;
  shieldT = m.sh || 0; handHolding = !!m.hh;
  for (let i = 0; i < boxes.length && i < m.bx.length; i++) { boxes[i].x = m.bx[i][0]; boxes[i].y = m.bx[i][1]; }
  // 平衡升降台：应用主机升降偏移（客机不跑 updateLifts）
  if (lifts.length && typeof m.lz === 'number') {
    liftOff = m.lz;
    for (const pl of lifts) { pl.px = 0; pl.py = 0; pl.y = pl.oy - liftOff; }
  }
  starsGot = m.st; deaths = m.dd; levelTime = m.lt;
  if (boss && m.bo) {
    boss.hp = m.bo[0]; boss.dead = !!m.bo[1];
    boss.projectiles = m.bo[2].map(p => ({ x: p[0], y: p[1], w: 20, h: 20, vx: 0, type: 'ice' }));
    boss.waves = m.bo[3].map(p => ({ x: p[0], y: p[1], w: 22, h: 14, vx: 0, type: 'fire' }));
    boss.weak = !!m.bo[4]; boss.phase = m.bo[5]; boss.pt = m.bo[6]; boss.hitFlash = m.bo[7]; boss.deathT = m.bo[8]; boss.weakSide = m.bo[9] === 'projectile' ? 'ice' : 'fire';
  }
  // 胜负/死亡状态
  if (m.w && !won) {
    won = true;
    const { grade, score } = computeGrade();
    const normalGems = gems.filter(g => !g.star);
    showOverlay('过关！', '等待主机进入下一关…', grade,
      `用时 ${levelTime.toFixed(1)}s<br>甜品 ${normalGems.filter(g => g.got).length}/${normalGems.length} · 星星 ${starsGot}/${starsTotal}<br>死亡 ${deaths} 次 · 得分 ${score}`);
  } else if (!m.w && won) { won = false; hideOverlay(); }
  if (m.d && !dead) { dead = true; showOverlay('哎呀！', '重置中...'); }
  else if (!m.d && dead) { dead = false; hideOverlay(); }
}

let gAcc = 0;
function guestFrame(dt) {
  if (!paused) {
    gAcc += dt;
    while (gAcc >= STEP) {   // 本地推进外观动画与平台/史莱姆（确定性）
      animT += STEP; gAcc -= STEP;
      updatePlats(); updateSlimes();
    }
  }
  const m = net.snapBuf.length ? net.snapBuf[net.snapBuf.length - 1].m : null;
  if (m) {
    // 渲染时间 = 最新快照 - 延迟，在相邻快照间线性插值
    const renderT = performance.now() - (net.delay || 100);
    let a = null, b = null;
    for (let i = net.snapBuf.length - 1; i >= 0; i--) {
      if (net.snapBuf[i].ts <= renderT) { b = net.snapBuf[i]; a = net.snapBuf[Math.min(i + 1, net.snapBuf.length - 1)]; break; }
    }
    if (!a) { a = b = net.snapBuf[net.snapBuf.length - 1]; }
    const span = Math.max(1, a.ts - b.ts);          // b 为较旧快照、a 为较新快照
    const k = Math.max(0, Math.min(1, (renderT - b.ts) / span));
    for (let i = 0; i < players.length && i < a.m.p.length; i++) {
      const p = players[i], pa = a.m.p[i], pb = b.m.p[i];
      p.x = pb[0] + (pa[0] - pb[0]) * k;
      p.y = pb[1] + (pa[1] - pb[1]) * k;
      p.vx = pa[2]; p.face = pa[3]; p.mode = pa[4] ? 'side' : 'front';
      p.walkPhase = pb[5] + (pa[5] - pb[5]) * k; p.tilt = pa[6];
      p.onGround = !!pa[7]; p.gflip = !!pa[8];
      p.flipT = null; p.settleT = null; p.inputDir = 0;
    }
    camX = b.m.cam + (a.m.cam - b.m.cam) * k;
    animT = m.a;   // 与主机对齐外观相位
    computeBridgeOn();   // 心之桥通断由插值后的双人坐标本地推导（与主机确定性一致）
  }
  // 上行本地输入
  const isP1 = net.idx === 0;
  const d = ((keys[isP1 ? 'KeyD' : 'ArrowRight'] ? 1 : 0) - (keys[isP1 ? 'KeyA' : 'ArrowLeft'] ? 1 : 0));
  const j = keys[isP1 ? 'KeyW' : 'ArrowUp'] ? 1 : 0;
  const now = performance.now();
  if (!net._lastIn || now - net._lastIn > 33 || net.remoteInput.d !== d || net.remoteInput.j !== j) {
    net._lastIn = now; netSend({ t: 'in', d, j });
  }
  if (!net._lastPing || now - net._lastPing > 2000) { net._lastPing = now; net.lastPingSent = performance.now(); netSend({ t: 'pg', ts: net.lastPingSent }); }
  updateHUD();
  render();
}

/* ---------- 联机状态条 ---------- */
function updateNetBar() {
  if (net.mode !== 'online') return;
  const ok = net.connected && net.peerOnline;
  netDot.classList.toggle('off', !ok);
  const roleTxt = net.role === 'host' ? '主机' : '客机';
  const pingTxt = net.ping >= 0 ? ` · ${net.ping}ms` : '';
  netBarText.textContent = `${roleTxt} ${net.room} · ${ok ? '双人在线' : net.connected ? '等待队友' : '重连中'}${pingTxt}`;
}
setInterval(updateNetBar, 500);

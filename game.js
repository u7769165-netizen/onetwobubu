/* ================= game.js =================
   游戏核心：存档与好感系统、爱情任务结算、胜利记录与多层流转、关卡载入、物理与机关、tick、渲染、主循环、联机、启动
   由 index.html 模块化拆分而来（原单文件 >144KB）。加载顺序：
   levels.js → audio.js → ui.js → game.js（index.html 中的 script 标签顺序）
   跨文件引用说明：本文件顶层只声明、不在加载时调用其他模块的函数（启动逻辑统一在 game.js 末尾）。
   ================================================================ */
/* ================= 玩法调参常量（集中管理，避免散落魔法数字） ================= */
/* 情侣协作判定 */
const HAND_DX = 64, HAND_DY = 48;          // 牵手同行：双人中心距阈值（px）
const SHIELD_DX = 96, SHIELD_DY = 96;      // 爱心护盾：双人起跳时中心距阈值（px）
const JUMP_EDGE_FRAMES = 6;                // 起跳后等待队友的窗口（帧）
const SHIELD_DURATION = 1.6, SHIELD_CD = 7; // 护盾无敌时长 / 冷却（秒）
const PAD_JOINT_DX = 72;                   // 弹跳台「双人同站」中心距阈值（px）
/* 恋爱终章新机关（心之试炼章节，levels.js 符号 J/b/z/r/K） */
const BRIDGE_DX = 64, BRIDGE_DY = 48;      // 心之桥 b：双人中心距在此内桥砖才实体化
const LIFT_SPEED = 60;                     // 平衡升降台 z：双人同站上升速度（px/s），空载同速下降，单人停留
const RHYTHM_ON = 1.2, RHYTHM_OFF = 2.4;   // 节奏火墙 r：全局同相位 亮/灭 时长（秒）
const RHYTHM_CYCLE = RHYTHM_ON + RHYTHM_OFF;
const LOVE_TRIAL_BONUS = 15;               // 心之试炼章节首通额外好感（在 LOVE_FIRST_CLEAR 之外追加）
/* 迈步动画（脚部摆动） */
const WALK_STRIDE = 0.16;                  // 步频系数：walkPhase 增速 = |vx|*dt*此值（越快步频越高）
const WALK_BLEND_RATE = 12;                // 迈步混合趋近速率（起/停过渡，越大越跟手）
const WALK_SWING = 0.28;                   // 脚绕脚踝最大摆幅（弧度，约 16°）
const WALK_MIN_VX = 30;                    // 低于此水平速度视为静止（不迈步）
/* 好感度来源数值（与规则界面/记忆文档一致） */
const LOVE_FIRST_CLEAR = 10;               // 首通一层
const LOVE_HEART = 5;                      // 爱心水晶
const LOVE_JOINT_JUMP = 3;                 // 协作弹跳
const LOVE_SHIELD = 2;                     // 爱心护盾
/* Boss 几何（makeBoss 与碰撞盒） */
const BOSS_W = 80, BOSS_H = 92, BOSS_TOP = 96;   // 本体：宽/高/顶高（相对 baseY）
const BOSS_CORE_W = 42, BOSS_CORE_H = 92;        // 冰/火属性核碰撞盒
const BOSS_HP = 6;                               // 破核次数即胜

/* ================= 多层级流转：转场 + 过关分流 ================= */
let subTransing = false;
let subTransTimer = null;      // 非末层「自动进入下一层」定时器
let lastWinFirstClear = false; // 最近一次胜利是否首通（奖励提示用）
function playSubTrans(name, sub, cb) {
  if (subTransing) return;
  subTransing = true;
  const el = document.getElementById('subTrans');
  el.querySelector('.st-name').textContent = name;
  el.querySelector('.st-sub').textContent = sub || '';
  el.classList.add('show');
  running = false; paused = false; clearKeys();
  pauseMenu.classList.add('hidden');
  setTimeout(() => { cb(); }, 1100);
  setTimeout(() => { el.classList.remove('show'); subTransing = false; }, 1700);
}

function advanceAfterWin() {
  if (subTransing) return;
  const mi = majorOf(curLevel), si = subOf(curLevel);
  const m = MAJORS[mi];
  const lastSub = si === m.subs.length - 1;
  const globalLast = curLevel + 1 >= LEVELS.length;
  if (globalLast) { showScreen('title'); return; }
  if (!lastSub) {
    playSubTrans('层 级 提 升', `进入「${m.subs[si + 1]}」${lastWinFirstClear ? ' · 首通奖励 ⭐+1' : ''} (${si + 2}/${m.subs.length})`,
      () => loadLevel(curLevel + 1, true));
  } else {
    const nm = MAJORS[mi + 1];
    playSubTrans(`「${m.name}」通关！${lastWinFirstClear ? ' · 首通奖励 ⭐+1' : ''}`,
      `下一主关卡：${nm.name} · ${nm.subs[0]}`, () => loadLevel(curLevel + 1, true));
  }
}

/* ================= 暂停 ================= */
function pauseGame() {
  if (screenMode !== 'play' || paused || won || dead) return;
  if (net.mode === 'online' && net.role === 'guest') { netSend({ t: 'preq' }); return; }  // 客机请求，主机裁决
  paused = true;
  wasRunningBeforePause = running;
  running = false;
  clearKeys();                     // 清空按键状态，防止恢复后角色持续移动（触屏按住态回写）
  pauseMenu.classList.remove('hidden');
  if (net.mode === 'online') netSend({ t: 'pa', v: 1 });
}
function resumeGame() {
  if (!paused) return;
  if (net.mode === 'online' && net.role === 'guest') { netSend({ t: 'preq' }); return; }  // 恢复由主机 pa 消息生效
  paused = false;
  pauseMenu.classList.add('hidden');
  if (net.mode === 'online' && net.role === 'host') netSend({ t: 'pa', v: 0 });
  if (wasRunningBeforePause) { running = true; last = performance.now(); acc = 0; }
}

/* ================= 游戏状态 ================= */
let curLevel = 0, running = false, won = false, dead = false;
let paused = false, wasRunningBeforePause = false;
let cols = 0, rows = 0;
let solids = [], waters = [], lavas = [], toxins = [];
let solidSet = new Set();   // "x,y" 快速查表：drawTiles 判断「上方是否实心」由 O(n²) 降为 O(n)
let buttons = [], doors = [], ghostDoors = [], boxes = [], gems = [], exits = [];
let spikes = [], flames = [], slimes = [], plats = [], gravZones = [], pads = [];
/* 恋爱终章新机关：J 连压板（成对分组 jPairs）/ b 心之桥 / z 平衡升降台 / 全局桥态与升降偏移 */
let padsJ = [], jPairs = [], bridges = [], lifts = [];
let bridgeOn = false, liftOff = 0;
let hearts = [];   // 爱心水晶（情侣道具收集物）
let shieldT = 0, shieldCd = 0, handHolding = false;
let musicStepQ = 0;   // 任务线检查节拍（60帧一次）
let boss = null;
let players = [];
let keys = {};
let animT = 0;
let camX = 0;   // 横版卷轴相机（世界坐标偏移）

/* 评分统计（deaths 跨重试累计，换关清零） */
let levelTime = 0, deaths = 0, starsGot = 0, starsTotal = 0;

/* ================= 联机状态（全局，供各模块引用） ================= */
const net = {
  mode: 'offline', role: null, idx: 0, room: '',
  ws: null, connected: false, peerOnline: false, ping: -1,
  want: null, retryT: 1000, reconnectTimer: null,
  remoteInput: { d: 0, j: 0 }, ver: 0,
  snapBuf: [], lastSent: null, soloAllowed: false,
};
function netSend(o) { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(o)); }

/* ================= 载入关卡 ================= */
function loadLevel(idx, autoStart) {
  if (idx !== curLevel) deaths = 0;
  document.getElementById('photoReveal').classList.add('hidden'); pendingSubAdvance = false;   // 换关清除合照弹出
  curLevel = idx;
  const rowsStr = LEVELS[idx];
  rows = rowsStr.length;
  cols = Math.max(...rowsStr.map(r => r.length));
  const grid = rowsStr.map(r => r.padEnd(cols, '.'));

  solids = []; waters = []; lavas = []; toxins = [];
  buttons = []; doors = []; ghostDoors = []; boxes = []; gems = []; exits = [];
  spikes = []; flames = []; slimes = []; plats = []; gravZones = []; pads = [];
  hearts = [];
  padsJ = []; jPairs = []; bridges = []; lifts = [];
  bridgeOn = false; liftOff = 0;
  shieldT = 0; shieldCd = 0; handHolding = false;
  boss = null;
  players = [];
  won = false; dead = false;
  paused = false; wasRunningBeforePause = false;
  pauseMenu.classList.add('hidden');
  levelTime = 0; starsGot = 0; starsTotal = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = grid[r][c];
      const x = c * TILE, y = r * TILE;
      if (ch === '#') solids.push({ x, y, w: TILE, h: TILE });
      else if (ch === 'W') waters.push({ x, y, w: TILE, h: TILE });
      else if (ch === 'L') lavas.push({ x, y, w: TILE, h: TILE });
      else if (ch === 'T') toxins.push({ x, y, w: TILE, h: TILE });
      else if (ch === '~') solids.push({ x, y, w: TILE, h: TILE, ice: true });
      else if (ch === 'P') players.push(makePlayer(x + (TILE - 24) / 2, y + TILE, 0));
      else if (ch === 'B') players.push(makePlayer(x + (TILE - 24) / 2, y + TILE, 1));
      else if (ch === '1' || ch === '2')
        buttons.push({ x: x + TILE / 2, y: y + TILE - 8, w: TILE * 0.7, h: 8, who: -1, pressed: false, color: ch === '1' ? '#4a9eff' : '#ff7fa8' });
      else if (ch === 'D' || ch === 'E')
        doors.push({ x: x + TILE / 2, baseY: y + TILE, open: false, color: ch === 'D' ? '#4a9eff' : '#ff7fa8' });
      else if (ch === 'd' || ch === 'e')
        ghostDoors.push({ x, y, w: TILE, h: TILE, color: ch === 'd' ? '#4a9eff' : '#ff7fa8', allowIdx: ch === 'd' ? 0 : 1 });
      else if (ch === 'C') boxes.push({ x: x + 2, y: y + 2, w: TILE - 4, h: TILE - 4, vx: 0 });
      else if (ch === 'w' || ch === 'l')
        gems.push({ x: x + TILE / 2, y: y + TILE / 2, r: 10, color: ch === 'w' ? '#4a9eff' : '#ff8a5c', owner: ch === 'w' ? 0 : 1, got: false });
      else if (ch === '*') {
        gems.push({ x: x + TILE / 2, y: y + TILE / 2, r: 10, color: '#ffd54a', owner: -1, got: false, star: true });
        starsTotal++;
      }
      else if (ch === 'X') exits.push({ x: x + TILE / 2, baseY: y + TILE });
      else if (ch === '^') spikes.push({ x, y: y + TILE - 12, w: TILE, h: 12, dir: 1 });
      else if (ch === 'v') spikes.push({ x, y, w: TILE, h: 12, dir: -1 });
      else if (ch === 'f') flames.push({ x: x + TILE / 2, baseY: y + TILE, up: true, t: (c * 0.7) % 3 });
      else if (ch === 'F') flames.push({ x: x + TILE / 2, baseY: y, up: false, t: (c * 0.7) % 3 });
      else if (ch === 's') slimes.push({ x: x + 6, y: y + TILE - 24, w: 28, h: 24, dir: 1, homeX: x, range: TILE * 2, hop: 0 });
      else if (ch === 'g') gravZones.push({ x, y, w: TILE, h: TILE });
      else if (ch === 'm') plats.push({ x, y: y + TILE / 2 - 4, w: TILE, h: 8, axis: 'x', ox: x, oy: y + TILE / 2 - 4, range: TILE * 3, t: 0, speed: 1, px: 0, py: 0 });
      else if (ch === 'M') plats.push({ x, y: y + TILE / 2 - 4, w: TILE, h: 8, axis: 'y', ox: x, oy: y + TILE / 2 - 4, range: TILE * 2, t: Math.PI / 2, speed: 1, px: 0, py: 0 });
      else if (ch === 'G') boss = makeBoss(x + TILE / 2, y + 2 * TILE);
      else if (ch === '=') plats.push({ x, y: y + TILE / 2 - 4, w: TILE, h: 8, axis: 'none', ox: x, oy: y + TILE / 2 - 4, range: 0, t: 0, speed: 0, px: 0, py: 0 });
      else if (ch === 'H') pads.push({ x, y, w: TILE, h: TILE, charge: 0, flash: 0 });
      else if (ch === 'h') hearts.push({ x: x + TILE / 2, y: y + TILE / 2, r: 11, got: false });
      /* ---- 恋爱终章新机关 ---- */
      else if (ch === 'J') padsJ.push({ x, y, w: TILE, h: TILE, lit: false });   // 同心连压板（非实心，仅检测区）
      else if (ch === 'b') bridges.push({ x, y, w: TILE, h: TILE });             // 心之桥砖（bridgeOn 时才实心）
      else if (ch === 'z') plats.push({ x, y: y + TILE / 2 - 4, w: TILE, h: 8, axis: 'lift', ox: x, oy: y + TILE / 2 - 4, range: 0, t: 0, speed: 0, px: 0, py: 0 });   // 平衡升降台
      else if (ch === 'r') flames.push({ x: x + TILE / 2, baseY: y + TILE, up: true, t: 0, sync: true });   // 节奏火墙（全局同相位）
      else if (ch === 'K') doors.push({ x: x + TILE / 2, baseY: y + TILE, open: false, color: '#ffd54a', momentary: true });   // 连压板配对门（金色，离开即关）
    }
  }
  solidSet = new Set(solids.map(s => s.x + ',' + s.y));
  /* J 板按 x 排序两两成对，第 i 对 ↔ 第 i 扇 K 门；lift 平台缓存 */
  lifts = plats.filter(pl => pl.axis === 'lift');
  padsJ.sort((a, b) => a.x - b.x);
  const kDoors = doors.filter(d => d.momentary).sort((a, b) => a.x - b.x);
  jPairs = [];
  for (let i = 0; i + 1 < padsJ.length; i += 2) jPairs.push({ a: padsJ[i], b: padsJ[i + 1], door: kDoors[i / 2] || null });
  if (autoStart) { camX = cameraTarget(); running = true; hideOverlay(); }
  else {
    camX = cameraTarget(); running = false;
    const mi = majorOf(idx), si = subOf(idx);
    const m = MAJORS[mi];
    const head = m.subs.length > 1 ? `第 ${mi + 1} 关 · 层级 ${si + 1}/${m.subs.length}` : `第 ${mi + 1} 关`;
    const limTip = LEVEL_LIMIT[idx] ? `（⏳ 限时 ${LEVEL_LIMIT[idx]}s）` : '';
    const trialTip = m.loveNeed ? '💕 心之试炼 · ' : '';
    showOverlay(`${trialTip}${head} · ${LEVEL_NAMES[idx]}${limTip}`, '点击画面开始');
  }
  updateHUD();
  updateMusic();   // 切关后刷新浪漫轨判定（爱之圣殿起播放爱情 BGM）
  if (net.mode === 'online' && net.role === 'host') netHostAnnounceLevel();
}

function makePlayer(x, y, idx) {
  return {
    idx, x, y, w: 24, h: 38, vx: 0, vy: 0, onGround: false, face: 1, inputDir: 0,
    mode: 'front',
    flipT: null, flipDur: 0.2, swapDone: false, pendingMode: 'front', pendingFace: 1,
    settleT: null, tilt: 0, walkPhase: Math.random() * 6, walkBlend: 0,
    gflip: false, onPlat: null,
  };
}

function makeBoss(x, baseY) {
  return {
    x: x - BOSS_W / 2, y: baseY - BOSS_TOP, w: BOSS_W, h: BOSS_H, baseY,
    hp: BOSS_HP, maxHp: BOSS_HP,
    phase: 'idle', pt: 0, attack: 'projectile',
    projectiles: [], waves: [],
    weak: false, weakSide: 'ice',
    hitFlash: 0, dead: false, deathT: 0,
    ice: { x: x - BOSS_W / 2 - 4, y: baseY - BOSS_CORE_H, w: BOSS_CORE_W, h: BOSS_CORE_H },
    fire: { x: x + 2, y: baseY - BOSS_CORE_H, w: BOSS_CORE_W, h: BOSS_CORE_H },
  };
}

/* ================= 输入 ================= */
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyR' && running) {
    if (net.mode === 'online' && net.role === 'guest') netSend({ t: 'rs' });
    else loadLevel(curLevel, true);
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function applyInput(p, dt) {
  const isP1 = p.idx === 0;
  let left, right, jump;
  if (net.mode === 'online' && net.role === 'host' && p.idx !== net.idx) {
    // 客机角色：用收到的远程输入
    left = net.remoteInput.d === -1; right = net.remoteInput.d === 1; jump = net.remoteInput.j === 1;
  } else {
    left = keys[isP1 ? 'KeyA' : 'ArrowLeft'];
    right = keys[isP1 ? 'KeyD' : 'ArrowRight'];
    jump = keys[isP1 ? 'KeyW' : 'ArrowUp'];
  }

  let dir = (right ? 1 : 0) - (left ? 1 : 0);
  p.inputDir = dir;
  const onIce = p.onGround && isIceBelow(p);
  if (dir !== 0) {
    const reversing = p.vx !== 0 && Math.sign(p.vx) !== dir;
    const accel = reversing && !onIce ? ACCEL * SKID_DECEL_MULT : ACCEL;
    p.vx += dir * (onIce ? accel * 0.35 : accel) * dt;
  } else {
    const dec = (onIce ? 220 : 1800) * dt;
    p.vx = Math.abs(p.vx) <= dec ? 0 : p.vx - Math.sign(p.vx) * dec;
  }
  // 牵手同行：双人靠近同向移动时互相带一把（心有灵犀等级后更强）
  const holdMult = loveLevel() >= 5 ? 1.45 : loveLevel() >= 3 ? 1.3 : 1.15;
  const cap = SPEED * (handHolding ? holdMult : 1);
  p.vx = Math.max(-cap, Math.min(cap, p.vx));

  if (jump && p.onGround) {
    p.vy = p.gflip ? JUMP : -JUMP;
    p.onGround = false;
    sfxJump();
    p._jumpEdge = JUMP_EDGE_FRAMES;   // 落地成功起跳：窗口帧数内等待队友（爱心护盾）
  } else if (p._jumpEdge) p._jumpEdge--;
}

/* ================= 触屏虚拟按键 =================
   设计：按键只写全局 keys（与键盘同一数据源），applyInput/guestFrame 上行/联机协议零改动复用。
   控制对象统一规则：touchIdx = 联机 ? net.idx : touchIdxLocal（单人可经换角色钮切换）。
   多指：每键维护 pointerId Set（双指同压一键、抬一指不误释放）；window 级 pointerup/cancel 兜底
   + blur/visibilitychange 全释放，三重防卡键。iOS<13 无 PointerEvent 时 initTouchLayer 直接 return 降级。 */
const TOUCH_CODES = [['KeyA', 'KeyD', 'KeyW'], ['ArrowLeft', 'ArrowRight', 'ArrowUp']];  // [左,右,跳] × touchIdx
const tpSlot = { left: new Set(), right: new Set(), jump: new Set() };   // 每键活跃 pointerId
const touchHeld = { left: false, right: false, jump: false };            // 逻辑按住态（与指针数解耦）
let touchIdxLocal = 0;    // 单人模式当前控制角色（不持久化）
let touchIdx = 0;
let touchPadVisible = false;

/* 把按住态回写到当前键组（keys 是被整体重赋值的 let，每次取当前全局值） */
function syncTouchKeys() {
  const c = TOUCH_CODES[touchIdx];
  keys[c[0]] = touchHeld.left; keys[c[1]] = touchHeld.right; keys[c[2]] = touchHeld.jump;
}
/* 清空按键状态但保留触屏按住态（暂停/转场等场景恢复后手指仍按着则继续生效） */
function clearKeys() { keys = {}; syncTouchKeys(); }
/* 释放全部触屏按住（切键组/重进关卡/失焦前必调，防旧键组残留 true） */
function releaseAllTouch() {
  tpSlot.left.clear(); tpSlot.right.clear(); tpSlot.jump.clear();
  touchHeld.left = touchHeld.right = touchHeld.jump = false;
  document.querySelectorAll('#touchLayer .tpad.on').forEach(b => b.classList.remove('on'));
  syncTouchKeys();
}
/* touchIdx 收敛：联机钉死本端角色并隐藏换角色钮；单人可切换 */
function updateTouchMode() {
  const online = net.mode === 'online';
  const next = online ? net.idx : touchIdxLocal;
  if (next !== touchIdx) { releaseAllTouch(); touchIdx = next; syncTouchKeys(); }
  const sw = document.getElementById('tpSwitch');
  if (sw) {
    sw.classList.toggle('hidden', online);
    sw.textContent = touchIdx === 0 ? '🔄 一二' : '🔄 布布';
  }
}
/* 三态显示判定：auto=粗指针设备显示 / on=总是 / off=关闭 */
function applyTouchVisibility() {
  const t = save.settings.touch;
  const show = t === 'on' || (t === 'auto' && window.matchMedia && matchMedia('(pointer: coarse)').matches);
  touchPadVisible = show;
  document.body.classList.toggle('touch', show);
}
function initTouchLayer() {
  if (!window.PointerEvent) return;   // 老环境静默降级为纯键盘
  const layer = document.getElementById('touchLayer');
  const BTN_ACT = { tpLeft: 'left', tpRight: 'right', tpJump: 'jump' };
  for (const id in BTN_ACT) {
    const k = BTN_ACT[id], btn = document.getElementById(id);
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();   // 阻断合成 mouse/click/双击缩放
      if (tpSlot[k].size === 0) { touchHeld[k] = true; syncTouchKeys(); }
      tpSlot[k].add(e.pointerId);
      btn.classList.add('on');
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* CDP 合成事件无真实指针 */ }
    });
    const release = e => {
      if (!tpSlot[k].delete(e.pointerId)) return;
      if (tpSlot[k].size === 0) { touchHeld[k] = false; syncTouchKeys(); btn.classList.remove('on'); }
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
  }
  // window 级兜底：capture 失败/手指移出视口抬起/系统手势打断
  const winRelease = e => {
    for (const k in tpSlot) if (tpSlot[k].delete(e.pointerId) && tpSlot[k].size === 0) {
      touchHeld[k] = false; syncTouchKeys();
      const b = document.getElementById(k === 'left' ? 'tpLeft' : k === 'right' ? 'tpRight' : 'tpJump');
      if (b) b.classList.remove('on');
    }
  };
  window.addEventListener('pointerup', winRelease);
  window.addEventListener('pointercancel', winRelease);
  window.addEventListener('blur', releaseAllTouch);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllTouch(); });
  layer.addEventListener('contextmenu', e => e.preventDefault());   // iOS 长按菜单
  document.getElementById('tpPause').addEventListener('click', () => pauseGame());
  document.getElementById('tpSwitch').addEventListener('click', () => {
    touchIdxLocal = 1 - touchIdxLocal; updateTouchMode();
  });
  // 外接触屏热插拔时刷新 auto 判定（老 Safari 无 addEventListener 则忽略）
  try { matchMedia('(pointer: coarse)').addEventListener('change', applyTouchVisibility); } catch (e) {}
}

/* 死亡统一处理：置死、计数、音效、提示、延迟重载本层。
   调用方自行决定是否 return（超时死亡需 return，危险死亡不 return 以便同帧继续判通关）。 */
function triggerDeath(title, sub) {
  dead = true;
  deaths++;
  sfxDeath();
  showOverlay(title, sub);
  setTimeout(() => { if (screenMode === 'play' && dead) loadLevel(curLevel, true); }, 700);
}

/* ================= 主更新 ================= */
function tick() {
  if (paused) return;
  animT += STEP;
  if (!running || won || dead) return;
  levelTime += STEP;

  updatePlats();
  updateLifts();
  computeBridgeOn();   // 心之桥通断（须在 stepPlayer 前更新，isSolidAt 依赖）
  updateSlimes();
  updateBoss();

  applyInput(players[0], STEP);
  applyInput(players[1], STEP);
  updateAnim(players[0], STEP);
  updateAnim(players[1], STEP);

  pushBoxes();
  stepPlayer(players[0]);
  stepPlayer(players[1]);

  const p1 = players[0], p2 = players[1];
  if (collide(p1, p2)) {
    const dx = (p2.x + p2.w / 2) - (p1.x + p1.w / 2);
    const nx = dx === 0 ? 1 : Math.sign(dx);
    const overlap = (p1.w + p2.w) / 2 - Math.abs(dx);
    // 墙体感知的分离：绝不把角色塞进实心墙（否则会被垂直回退一路顶出地图）；
    // 被墙挡住的一侧无法移动时，由另一侧吸收全部分离量（法向约束：墙承担推力）
    const tryPush = (p, amt) => {
      for (const k of [1, 0.5, 0.25]) {
        const x2 = Math.max(0, Math.min(cols * TILE - p.w, p.x + amt * k));
        if (!isSolidAt(x2, p.y, p.w, p.h, p)) { p.x = x2; return true; }
      }
      return false;
    };
    const half = overlap / 2 + 2;
    const ok1 = tryPush(p1, -nx * half);
    const ok2 = tryPush(p2, nx * half);
    if (!ok2) tryPush(p1, -nx * (overlap + 4));
    if (!ok1) tryPush(p2, nx * (overlap + 4));
  }

  updatePads();
  updateLoveSkills();
  collectHearts();
  if ((musicStepQ = (musicStepQ + 1) % 60) === 0) {
    checkLoveQuests();   // 每秒检查一次任务线
    albumTickPlay();     // 纪念册：游玩计时 + 打卡日期
  }
  updateButtonsAndDoors();
  updateLinkPlates();
  collectGems();
  updateCamera(STEP);

  /* 每层时间限制：高层级主关卡超时即死亡重置 */
  const lim = LEVEL_LIMIT[curLevel];
  if (lim && levelTime >= lim) {
    triggerDeath('⏳ 时间到！', `限时 ${lim}s · 重置中...`);
    return;
  }

  if (checkHazards()) triggerDeath('哎呀！', '重置中...');

  if (checkExit()) {
    won = true;
    const { grade, score } = computeGrade();
    lastWinFirstClear = recordWin(grade);
    sfxWin();
    const mi = majorOf(curLevel), si = subOf(curLevel);
    const lastSub = si === MAJORS[mi].subs.length - 1;
    const globalLast = curLevel + 1 >= LEVELS.length;
    const normalGems = gems.filter(g => !g.star);
    const detail =
      `用时 ${levelTime.toFixed(1)}s（目标 ${PAR_TIME[curLevel]}s）<br>` +
      `甜品 ${normalGems.filter(g => g.got).length}/${normalGems.length} · 星星 ${starsGot}/${starsTotal}<br>` +
      `死亡 ${deaths} 次 · 得分 ${score}` +
      `<br><span style="color:#ff9ec6">💕 ${LOVE_LEVELS[loveLevel()].name} Lv.${loveLevel() + 1} · 好感 ${save.love}</span>` +
      (lastWinFirstClear ? `<br><span style="color:#ffd54a">🎉 首次通过本层 · 奖励 ⭐+1 · 💕+${LOVE_FIRST_CLEAR + (MAJORS[mi].loveNeed ? LOVE_TRIAL_BONUS : 0)}</span>` : '') +
      (newPhotoIdx >= 0 ? `<br><span style="color:#7fe3a8">📷 解锁新合照「${PHOTOS[newPhotoIdx].name}」！已收入相册，点击画面即可查看</span>` : '');
    if (!lastSub) {
      showOverlay('本层通关！', '即将进入下一层…', grade, detail);
      if (subTransTimer) clearTimeout(subTransTimer);
      if (newPhotoIdx >= 0) {          // 解锁了合照：先放合照，暂停自动进层
        openPhotoReveal(newPhotoIdx); pendingSubAdvance = true;
      } else {
        subTransTimer = setTimeout(() => { subTransTimer = null; if (screenMode === 'play' && won) advanceAfterWin(); }, 1500);
      }
    } else {
      showOverlay('过关！', globalLast ? '全部通关！点击返回标题' : `「${MAJORS[mi].name}」全部层通过！点击继续`, grade, detail);
      if (newPhotoIdx >= 0) openPhotoReveal(newPhotoIdx);   // 末层通关：直接放合照
    }
  }

  updateHUD();
}

/* ================= 主循环 ================= */
let last = 0, acc = 0;
function loop(t) {
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  if (net.mode === 'online' && net.role === 'guest') {
    if (screenMode === 'play') guestFrame(dt);
    requestAnimationFrame(loop);
    return;
  }
  acc += dt;
  while (acc >= STEP) { tick(); acc -= STEP; }
  render();
  if (net.mode === 'online' && net.role === 'host') {
    netHostFrame(t);
    if (netWaiting && !net.soloAllowed && Date.now() - netWaitSince > 120000) {
      showOverlay('等待队友', '超时：点击画面可单人继续');
      net.soloAllowed = true;
    }
  }
  requestAnimationFrame(loop);
}

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
/* ================= 交互 ================= */
wrap.addEventListener('click', () => {
  if (screenMode !== 'play' || paused || subTransing) return;
  if (!document.getElementById('photoReveal').classList.contains('hidden')) { closePhotoReveal(); return; }   // 先收合照（客机也可收起）
  if (net.mode === 'online' && net.role === 'guest') return;   // 客机点击不触发流程
  if (won) {
    advanceAfterWin();
    return;
  }
  if (netWaiting && net.soloAllowed) {   // 主机超时单人继续
    netWaiting = false; net.soloAllowed = false;
    clearKeys(); running = true; hideOverlay();
    return;
  }
  if (!running && !dead) { running = true; hideOverlay(); }
});
retryBtn.addEventListener('click', () => {
  if (screenMode !== 'play' || subTransing) return;
  if (net.mode === 'online' && net.role === 'guest') netSend({ t: 'rs' });
  else loadLevel(curLevel, true);
});
menuBtn.addEventListener('click', () => {
  if (subTransing) return;
  if (net.mode === 'online' && net.role === 'guest') { netStatus('客机不能换关，由主机选择'); return; }
  showScreen('levels');
});
homeBtn.addEventListener('click', () => {
  if (subTransing) return;
  if (net.mode === 'online') { netLeave(); showScreen('title'); return; }
  showScreen('title');
});
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('pauseMapBtn').addEventListener('click', () => { resumeGame(); showScreen('map'); });
document.getElementById('pauseHomeBtn').addEventListener('click', () => {
  if (subTransing) return;
  if (net.mode === 'online') { netLeave(); showScreen('title'); return; }
  showScreen('title');
});
document.getElementById('playBtn').addEventListener('click', () => showScreen('levels'));
continueBtn.addEventListener('click', () => { showScreen('play'); loadLevel(save.unlocked, false); });
document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settings'));
document.getElementById('levelBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('settingsBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('mapBtn').addEventListener('click', () => showScreen('map'));
document.getElementById('mapBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('helpBtn').addEventListener('click', () => { document.getElementById('helpBody').scrollTo({ top: 0, behavior: 'instant' }); showScreen('help'); });
document.getElementById('helpBackBtn').addEventListener('click', () => showScreen('title'));
/* 规则目录：点击跳转到对应小节，并高亮闪烁提示 */
document.querySelectorAll('#helpToc .toc-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const sec = document.getElementById(btn.dataset.sec);
    if (!sec) return;
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.help-sec.hl').forEach(s => s.classList.remove('hl'));
    sec.classList.add('hl');
    setTimeout(() => sec.classList.remove('hl'), 1200);
  });
});
document.getElementById('loveBtn').addEventListener('click', () => showScreen('love'));
document.getElementById('loveBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('albumBtn').addEventListener('click', () => showScreen('album'));
document.getElementById('albumBackBtn').addEventListener('click', () => showScreen('love'));
document.getElementById('photoBtn').addEventListener('click', () => showScreen('photos'));
document.getElementById('photoBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('photoView').addEventListener('click', e => {
  // 点击照片本体不关闭，点空白关闭
  if (!e.target.closest('.pv-frame')) closePhotoView();
});
document.getElementById('photoReveal').addEventListener('click', e => { e.stopPropagation(); closePhotoReveal(); });
window.addEventListener('keydown', e => {
  if (pvIdx < 0) return;
  if (e.code === 'Escape') { e.preventDefault(); closePhotoView(); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); pvStep(1); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); pvStep(-1); }
});
document.getElementById('spBackBtn').addEventListener('click', () => showScreen('levels'));
document.getElementById('unlockAllBtn').addEventListener('click', () => {
  save.unlocked = LEVELS.length - 1;
  persistSave(); updateTitleUI();
  showScreen('levels');
});
document.getElementById('resetProgressBtn').addEventListener('click', () => {
  if (!confirm('确定要清空全部关卡进度吗？')) return;
  save.unlocked = 0; save.best = {}; save.stars = {}; save.subs = {}; save.bonusStars = 0; save.photos = [];
  save.love = 0; save.loveStats = { hearts: 0, joint: 0, shield: 0, holding: 0 }; save.loveTiers = {}; save.heartLv = {};
  save.album = null; albumBanner = null;   // 纪念册一并重置（重新相识）
  persistSave(); updateTitleUI();
});

/* 设置项绑定 */
const sfxToggle = document.getElementById('sfxToggle');
const musicToggle = document.getElementById('musicToggle');
const hudToggle = document.getElementById('hudToggle');
const volSfxSlider = document.getElementById('volSfxSlider');
const volMusicSlider = document.getElementById('volMusicSlider');
const bgmSelect = document.getElementById('bgmSelect');
const touchSelect = document.getElementById('touchSelect');
touchSelect.addEventListener('change', () => {
  save.settings.touch = touchSelect.value;
  persistSave();
  applyTouchVisibility();
});
/* 背景音乐两选项（option 静态写在 index.html）：exclusive=一二布布专属bgm（7 首顺序播放）/ classic=原版经典旋律 */
bgmSelect.addEventListener('change', () => {
  bgmSwitchTo(bgmSelect.value);
  applySettings();
});
function applySettings() {
  sfxToggle.checked = !!save.settings.sfx;
  musicToggle.checked = !!save.settings.music;
  hudToggle.checked = !!save.settings.hud;
  hud.style.display = save.settings.hud ? '' : 'none';
  volSfxSlider.value = save.settings.volSfx;
  volMusicSlider.value = save.settings.volMusic;
  document.getElementById('volSfxVal').textContent = save.settings.volSfx + '%';
  document.getElementById('volMusicVal').textContent = save.settings.volMusic + '%';
  const skin = SIDE_SRC[save.settings.skin] ? save.settings.skin : 'classic';
  document.getElementById('skinClassic').classList.toggle('on', skin === 'classic');
  document.getElementById('skinOuting').classList.toggle('on', skin === 'outing');
  bgmSelect.value = String(bgmMode());
  touchSelect.value = save.settings.touch;
}
sfxToggle.addEventListener('change', () => { save.settings.sfx = sfxToggle.checked; persistSave(); if (sfxToggle.checked) beep(880, 0.12, 'triangle', 0.1); });
musicToggle.addEventListener('change', () => {
  save.settings.music = musicToggle.checked; persistSave();
  if (musicToggle.checked) ensureCtx();
  updateMusic();
});
hudToggle.addEventListener('change', () => { save.settings.hud = hudToggle.checked; applySettings(); persistSave(); });
/* 移动形象（皮肤）切换按钮 */
document.getElementById('skinClassic').addEventListener('click', () => { setSkin('classic'); applySettings(); });
document.getElementById('skinOuting').addEventListener('click', () => { setSkin('outing'); applySettings(); });
volSfxSlider.addEventListener('input', () => {
  save.settings.volSfx = +volSfxSlider.value;
  document.getElementById('volSfxVal').textContent = save.settings.volSfx + '%';
});
volSfxSlider.addEventListener('change', () => { persistSave(); if (save.settings.sfx) beep(880, 0.12, 'triangle', 0.1); });   // 拖动实时预览音量
volMusicSlider.addEventListener('input', () => {
  save.settings.volMusic = +volMusicSlider.value;
  document.getElementById('volMusicVal').textContent = save.settings.volMusic + '%';
});
volMusicSlider.addEventListener('change', () => { persistSave(); updateMusic(); });   // 0→非0 时恢复播放调度

/* Esc / P：游戏中切换暂停；暂停中 Esc 恢复。T：游戏内快速切换移动形象 */
window.addEventListener('keydown', e => {
  if (screenMode !== 'play' || subTransing) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    if (paused) resumeGame(); else pauseGame();
  } else if (e.code === 'KeyT' && !e.repeat) {
    const order = Object.keys(SIDE_SRC);
    const next = order[(order.indexOf(save.settings.skin) + 1) % order.length];
    if (setSkin(next)) applySettings();
  }
});

/* ---------- 联机大厅事件 ---------- */
const netAddrEl = document.getElementById('netAddr');
netAddrEl.value = (location.protocol === 'file:' ? 'ws://127.0.0.1:8765/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
document.getElementById('netBtn').addEventListener('click', () => showScreen('net'));
document.getElementById('netBackBtn').addEventListener('click', () => { if (net.mode === 'online') netLeave(); showScreen('title'); });
document.getElementById('netCreateBtn').addEventListener('click', () => {
  if (net.connected) { netStatus('已在房间中'); return; }
  netConnect('create', genRoomCode());
});
document.getElementById('netJoinBtn').addEventListener('click', () => {
  const code = document.getElementById('netJoinCode').value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) { netStatus('请输入4位房间码'); return; }
  if (net.connected) { netStatus('已在房间中'); return; }
  netConnect('join', code);
});


/* ================= 启动 ================= */
loadSprites();
loadSave();
applySettings();
initTouchLayer();
applyTouchVisibility();
updateTouchMode();
showScreen('title');
// 每日陪伴 / 纪念日飘带：秒级倒计时，归零自动收起
setInterval(() => {
  if (albumBanner && albumBanner.t > 0) {
    albumBanner.t -= 1;
    if (albumBanner.t <= 0) { albumBanner = null; if (screenMode === 'title') updateTitleUI(); }
    else if (screenMode === 'title') { const bn = document.getElementById('albumBanner'); if (bn) bn.style.opacity = Math.min(1, albumBanner.t / 1.5); }
  }
}, 1000);
/* URL 参数快速入口：?net=1 直接进大厅 */
if (new URLSearchParams(location.search).has('net')) showScreen('net');
requestAnimationFrame(loop);

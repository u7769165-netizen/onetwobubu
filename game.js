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
  needRender = true;             // P0：暂停期间画布冻结，恢复瞬间补渲一帧
  pauseMenu.classList.add('hidden');
  if (net.mode === 'online' && net.role === 'host') netSend({ t: 'pa', v: 0 });
  if (wasRunningBeforePause) { running = true; last = performance.now(); acc = 0; }
}

/* ================= 游戏状态 ================= */
let curLevel = 0, running = false, won = false, dead = false;
let paused = false, wasRunningBeforePause = false;
let cols = 0, rows = 0;
let solids = [], waters = [], lavas = [], toxins = [];
let solidSet = new Set();   // 数值键 x*4096+y 快速查表：drawTiles 判断「上方是否实心」O(1)，且免每帧字符串分配（P3）
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
  solidSet = new Set(solids.map(s => s.x * 4096 + s.y));   // 坐标均为 TILE(40) 倍数、y<4096，数值键无碰撞
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
  const tgSw = document.querySelector('#touchGuide .tg-switch');
  if (tgSw) tgSw.classList.toggle('hidden', online);   // 联机钉死角色，引导层同步隐藏换角色标注
}
/* ================= 触屏首启引导层 =================
   显示条件：play 界面 + 按键层可见 + 粗指针设备 + localStorage 未标记。
   首击不穿透：pointerdown 上 preventDefault 抑制同点位兼容 mousedown/click——否则 guide 关闭变
   display:none 后，兼容 click 落到下层 #wrap 误启动游戏。 */
const TOUCH_GUIDE_KEY = 'onetwobubu_touchguide_seen';
function maybeShowTouchGuide() {
  if (screenMode !== 'play' || !touchPadVisible) return;
  if (!window.matchMedia || !matchMedia('(pointer: coarse)').matches) return;
  let seen;
  try { seen = localStorage.getItem(TOUCH_GUIDE_KEY); } catch (e) { seen = '1'; }   // 隐私模式取不到存储则不打扰
  if (seen === '1') return;
  const g = document.getElementById('touchGuide');
  if (g) g.classList.remove('hidden');
}
function dismissTouchGuide() {
  const g = document.getElementById('touchGuide');
  if (!g || g.classList.contains('hidden')) return;
  g.classList.add('hidden');
  try { localStorage.setItem(TOUCH_GUIDE_KEY, '1'); } catch (e) {}
}
/* 三态显示判定：auto=粗指针设备显示 / on=总是 / off=关闭 */
function applyTouchVisibility() {
  const t = save.settings.touch;
  const show = t === 'on' || (t === 'auto' && window.matchMedia && matchMedia('(pointer: coarse)').matches);
  touchPadVisible = show;
  document.body.classList.toggle('touch', show);
  fitViewport();   // body.touch class 刚切换，全屏门控随之进出
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
  // 第四重兜底：iOS Safari 长按后系统手势接管可能吞掉 pointerup/pointercancel（真机反馈跳跃键卡死），
  // 但 TouchEvent 的 touchend/touchcancel 几乎不丢——按剩余触点 reconcile，无手指的按住键强制释放
  const TOUCH_BTN = { left: 'tpLeft', right: 'tpRight', jump: 'tpJump' };
  const reconcileTouch = e => {
    for (const k in TOUCH_BTN) {
      if (!touchHeld[k]) continue;
      const btn = document.getElementById(TOUCH_BTN[k]);
      let held = false;
      for (let i = 0; i < e.touches.length; i++) {
        const el = document.elementFromPoint(e.touches[i].clientX, e.touches[i].clientY);
        if (el && (el === btn || btn.contains(el))) { held = true; break; }
      }
      if (!held) {
        touchHeld[k] = false; tpSlot[k].clear(); syncTouchKeys();
        btn.classList.remove('on');
      }
    }
  };
  window.addEventListener('touchend', reconcileTouch, { passive: true });
  window.addEventListener('touchcancel', reconcileTouch, { passive: true });
  window.addEventListener('blur', releaseAllTouch);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllTouch(); });
  layer.addEventListener('contextmenu', e => e.preventDefault());   // iOS 长按菜单
  document.getElementById('tpPause').addEventListener('click', () => pauseGame());
  document.getElementById('tpSwitch').addEventListener('click', () => {
    touchIdxLocal = 1 - touchIdxLocal; updateTouchMode();
  });
  // 竖屏旋转模式：↻ 切换旋转方向（适配手机顶部朝左/朝右两种握姿，横屏下钮隐藏不生效）
  document.getElementById('tpFlip').addEventListener('click', () => {
    document.body.classList.toggle('rot-ccw');
  });
  // 外接触屏热插拔时刷新 auto 判定（老 Safari 无 addEventListener 则忽略）
  try { matchMedia('(pointer: coarse)').addEventListener('change', applyTouchVisibility); } catch (e) {}
  // 首启引导：点任意处关闭；preventDefault 抑制兼容 click，保证首击不穿透到 #wrap 启动游戏
  const guide = document.getElementById('touchGuide');
  if (guide) guide.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    dismissTouchGuide();
  });
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
/* 性能计数器（CDP 测试与诊断可读）：renders=实际全量渲染帧数，ticks=固定步长执行次数，maxSteps=单帧最大补步数 */
const perfStats = { renders: 0, ticks: 0, maxSteps: 0 };
/* P2 自适应 DPR：帧时间 EMA（α=0.05），仅游玩推进（running 且未暂停）时采样；
   持续 >19ms（约 1s）→ DPR 2→1.5 降光栅化压力；持续 <13ms（约 3s，仅高刷屏可达）→ 回 2。
   60Hz 屏 rAF 间隔约 16.7ms，降级后本局保持，避免震荡。 */
let ftEma = 16.7, dprStreak = 0;
const DPR_HIGH = 2, DPR_LOW = 1.5;
function loop(t) {
  const raw = t - last;
  const dt = Math.min(raw / 1000, 0.1);
  last = t;
  if (net.mode === 'online' && net.role === 'guest') {
    // guestFrame 内部含 render；暂停且无需补渲时整体跳过（keys 已清空，上行输入无意义）
    if (screenMode === 'play' && (!paused || needRender)) { guestFrame(dt); perfStats.renders++; needRender = false; }
    requestAnimationFrame(loop);
    return;
  }
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) { tick(); acc -= STEP; steps++; perfStats.ticks++; }
  if (acc >= STEP) acc = 0;   // P1：达步数上限丢弃积压（防后台恢复瞬间 tick 风暴）
  if (steps > perfStats.maxSteps) perfStats.maxSteps = steps;
  // P0 空闲跳帧：暂停/菜单界面不再全量渲染（画布保留最后一帧，半透明 DOM 层下视觉不变）；
  // won/dead/netWaiting 均属 play 且未暂停 → 继续渲染通关/死亡动效
  const active = screenMode === 'play' && !paused;
  if (active || needRender) { render(); perfStats.renders++; needRender = false; }
  if (active && running && raw > 0 && raw < 100) {
    ftEma += (raw - ftEma) * 0.05;
    if (ftEma > 19 && DPR > DPR_LOW) { if (++dprStreak >= 60) { setDpr(DPR_LOW); dprStreak = 0; } }
    else if (ftEma < 13 && DPR < DPR_HIGH) { if (++dprStreak >= 180) { setDpr(DPR_HIGH); dprStreak = 0; } }
    else dprStreak = 0;
  }
  if (net.mode === 'online' && net.role === 'host') {
    netHostFrame(t);
    if (netWaiting && !net.soloAllowed && Date.now() - netWaitSince > 120000) {
      showOverlay('等待队友', '超时：点击画面可单人继续');
      net.soloAllowed = true;
    }
  }
  requestAnimationFrame(loop);
}

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
(function () {
  var def = location.protocol === 'file:' ? 'ws://127.0.0.1:8765/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  var local = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var saved = '';
  try { saved = localStorage.getItem('onetwobubu_net_addr') || ''; } catch (e) {}
  netAddrEl.value = (local && saved) ? saved : def;
})();
document.getElementById('netBtn').addEventListener('click', () => authEnsureNet());
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
// 视口变化（旋转/iOS 地址栏收放/窗口缩放）→ 防抖重算触屏横屏全屏逻辑视口（门控在 fitViewport 内，桌面为 no-op）
window.addEventListener('resize', scheduleFit);
window.addEventListener('orientationchange', scheduleFit);
if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit);
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

/* PWA：注册 Service Worker（APK 内 Capacitor 自带离线资源，跳过避免双层缓存）
   原为 index.html 内联脚本，P1-4 外置以启用严格 CSP script-src 'self' */
if (!window.Capacitor && 'serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}

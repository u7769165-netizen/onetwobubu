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

/* ================= 进度保存（localStorage 持久化） ================= */
const SAVE_KEY = 'onetwobubu_save_v1';
let save = { unlocked: 0, best: {}, stars: {}, subs: {}, bonusStars: 0, photos: [], love: 0, loveStats: { hearts: 0, joint: 0, shield: 0 }, loveTiers: {}, heartLv: {}, album: null, settings: { sfx: true, music: true, hud: true, volSfx: 100, volMusic: 100, skin: 'classic', bgmMode: 'exclusive', touch: 'auto' } };
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.unlocked === 'number') {
      save = { unlocked: s.unlocked, best: s.best || {}, stars: s.stars || {},
               subs: s.subs || {}, bonusStars: s.bonusStars || 0,
               photos: Array.isArray(s.photos) ? s.photos : [],
               love: s.love || 0, loveStats: Object.assign({ hearts: 0, joint: 0, shield: 0 }, s.loveStats || {}),
               loveTiers: s.loveTiers && typeof s.loveTiers === 'object' ? s.loveTiers : {},
               heartLv: s.heartLv && typeof s.heartLv === 'object' ? s.heartLv : {},
               album: s.album && typeof s.album === 'object' ? s.album : null,
               settings: Object.assign(save.settings, s.settings || {}) };
      // 旧存档（无 music 字段）：默认开启音效与背景音乐
      if (!s.settings || !('music' in s.settings)) { save.settings.sfx = true; save.settings.music = true; }
      // 音量字段钳制（0~100 整数）
      save.settings.volSfx = Math.min(100, Math.max(0, save.settings.volSfx | 0));
      save.settings.volMusic = Math.min(100, Math.max(0, save.settings.volMusic | 0));
      // 触屏三态钳制：非法值归 auto
      if (save.settings.touch !== 'on' && save.settings.touch !== 'off') save.settings.touch = 'auto';
    }
  } catch (e) { /* 读取失败用默认值 */ }
}
function persistSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

/* ================= 情侣好感度成长系统 ================= */
const LOVE_LEVELS = [
  { need: 0,    name: '初识',     perk: '缘分刚开始' },
  { need: 40,   name: '心动',     perk: '解锁牵手加速' },
  { need: 100,  name: '热恋',     perk: '解锁头顶爱心印记' },
  { need: 200,  name: '心有灵犀', perk: '牵手加速增强' },
  { need: 340,  name: '永结同心', perk: '爱心印记化为金色' },
  { need: 520,  name: '琴瑟和鸣', perk: '解锁双色和鸣爱心 · 牵手加速再增强' },
  { need: 760,  name: '白首之约', perk: '爱心印记伴环绕星光' },
  { need: 1060, name: '情深不渝', perk: '爱心印记彩虹流转 · 每日纪念奖励翻倍' },
];
function loveLevel() { let lv = 0; for (let i = 0; i < LOVE_LEVELS.length; i++) if (save.love >= LOVE_LEVELS[i].need) lv = i; return lv; }
function loveMaxLevel() { return LOVE_LEVELS.length - 1; }
let loveUpFx = 0;   // 好感升级心形特效剩余时间
function addLove(n) {
  const before = loveLevel();
  save.love += n;
  if (loveLevel() > before) {
    loveUpFx = 2.6; sfxLoveUp();
    if (save.album) albumMoment(`💞 好感升级 · 进入「${LOVE_LEVELS[loveLevel()].name}」阶段`);
  }
  persistSave();
}
/* ---- 爱情任务线：层级递进制任务家族。每个家族按阶递进，前一阶达成后下一阶才生效；
      同类型任务（牵手/水晶/弹跳/护盾/通关/合照/陪伴）统一采用此模式，难度与奖励逐阶提升 ---- */
const HEART_CAP = 3;   // 同一关卡的爱心水晶最多计入任务进度/好感 3 次（防止刷关涨好感过快）
const clearedMajors = () => MAJORS.filter((m, mi) => save.subs[mi] && save.subs[mi].some(Boolean)).length;
const LOVE_FAMILIES = [
  { id: 'f1', name: '牵手同行', icon: '👫', unit: '秒', get: () => Math.floor(save.loveStats.holding || 0),
    tiers: [ { goal: 60, reward: 25 }, { goal: 240, reward: 45 }, { goal: 360, reward: 70 }, { goal: 520, reward: 100 } ] },
  { id: 'f2', name: '爱心水晶', icon: '💗', unit: '颗', get: () => save.loveStats.hearts || 0,
    tiers: [ { goal: 10, reward: 20 }, { goal: 30, reward: 40 }, { goal: 60, reward: 65 }, { goal: 80, reward: 90 } ] },
  { id: 'f3', name: '协作弹跳', icon: '🤝', unit: '次', get: () => save.loveStats.joint || 0,
    tiers: [ { goal: 15, reward: 20 }, { goal: 60, reward: 40 }, { goal: 150, reward: 65 }, { goal: 300, reward: 90 } ] },
  { id: 'f4', name: '爱心护盾', icon: '🛡', unit: '次', get: () => save.loveStats.shield || 0,
    tiers: [ { goal: 10, reward: 25 }, { goal: 40, reward: 45 }, { goal: 100, reward: 70 }, { goal: 200, reward: 95 } ] },
  { id: 'f5', name: '携手通关', icon: '🏆', unit: '主关', get: () => clearedMajors(),
    tiers: [ { goal: 3, reward: 20 }, { goal: 8, reward: 40 }, { goal: 14, reward: 65 }, { goal: 19, reward: 100 } ] },
  { id: 'f6', name: '合照回忆', icon: '📷', unit: '张', get: () => (save.photos || []).length,
    tiers: [ { goal: 5, reward: 30 }, { goal: 12, reward: 55 }, { goal: 20, reward: 100 } ] },
  { id: 'f7', name: '长情陪伴', icon: '📅', unit: '天', get: () => albumDays(),
    tiers: [ { goal: 7, reward: 30 }, { goal: 30, reward: 60 }, { goal: 100, reward: 90 }, { goal: 365, reward: 150 } ] },
];
let _questChecking = false;
function checkLoveQuests() {
  if (_questChecking) return;
  _questChecking = true;
  for (const f of LOVE_FAMILIES) {
    let t = save.loveTiers[f.id] || 0;
    while (t < f.tiers.length && f.get() >= f.tiers[t].goal) {
      const tier = f.tiers[t];
      t++;
      save.loveTiers[f.id] = t;
      addLove(tier.reward);
      loveFxToast = { txt: `💕 「${f.name}」第 ${t} 阶达成！好感+${tier.reward}`, t: 3 };
      if (save.album) albumMoment(`💗 「${f.name}」达成第 ${t} 阶（${tier.goal}${f.unit}）`);
    }
  }
  persistSave();
  _questChecking = false;
}
let loveFxToast = null;

/* ================= 纪念册：情侣游戏历程记录 =================
   save.album = { first: 'YYYY-MM-DD', days: ['YYYY-MM-DD',...], playSec: 0,
                  moments: [{d,t}], daily: { last, streak }, anni: {} } */
function albumDateStr(ts) { const d = ts === undefined ? new Date() : new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function ensureAlbum() {
  if (!save.album || typeof save.album !== 'object') {
    save.album = { first: albumDateStr(), days: [albumDateStr()], playSec: 0, moments: [{ d: albumDateStr(), t: '🎬 一二和布布的第一次冒险启程' }], daily: { last: '', streak: 0 }, anni: {} };
    persistSave();
  }
  return save.album;
}
function albumDays() {   // 相识第 N 天（含首日）
  if (!save.album) return 0;
  const f = new Date(save.album.first + 'T00:00:00'), t = new Date();
  return Math.max(1, Math.floor((t - f) / 86400000) + 1);
}
function albumMoment(txt) {   // 记录重要互动节点（时光轴）
  const ab = ensureAlbum();
  ab.moments.push({ d: albumDateStr(), t: txt });
  if (ab.moments.length > 80) ab.moments.splice(1, ab.moments.length - 80);   // 保留首条+最近79条
}
function albumTickPlay() {   // 游玩计时与打卡日期（每秒调用）
  const ab = ensureAlbum();
  ab.playSec++;
  const today = albumDateStr();
  if (ab.days[ab.days.length - 1] !== today) { ab.days.push(today); if (ab.days.length > 400) ab.days.shift(); }
}
function fmtDur(sec) {
  sec = Math.floor(sec || 0);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h} 小时 ${m} 分` : m ? `${m} 分 ${sec % 60} 秒` : `${sec} 秒`;
}
/* ---- 每日陪伴提醒 + 恋爱纪念日奖励（进入标题界面时结算） ---- */
const LOVE_ANNIS = [
  { day: 7,   name: '七日之约',   reward: 20, txt: '携手同行 7 天' },
  { day: 30,  name: '一月纪念',   reward: 40, txt: '一个月不离不弃' },
  { day: 100, name: '百日纪念',   reward: 60, txt: '一百天的陪伴' },
  { day: 365, name: '周年纪念',   reward: 131, txt: '365天 · 一生一世' },
];
let albumBanner = null;   // 标题界面 DOM 飘带 { html, t }
function dailyLoveCheck() {
  const ab = ensureAlbum();
  const today = albumDateStr();
  if (ab.daily.last === today) return;
  const yest = albumDateStr(Date.now() - 86400000);
  ab.daily.streak = ab.daily.last === yest ? ab.daily.streak + 1 : 1;
  ab.daily.last = today;
  let gain = 5 + Math.min(ab.daily.streak, 7) * 2;
  if (loveLevel() >= loveMaxLevel()) gain *= 2;   // 情深不渝：每日奖励翻倍
  addLove(gain);
  albumBanner = { html: `💞 相识第 <b>${albumDays()}</b> 天 · 今日陪伴奖励 <b>+${gain}</b> 好感${loveLevel() >= loveMaxLevel() ? '（满级翻倍）' : ''} · 连续 ${ab.daily.streak} 天`, t: 7 };
  // 纪念日检查
  const d = albumDays();
  for (const a of LOVE_ANNIS) {
    if (d === a.day && !ab.anni[a.day]) {
      ab.anni[a.day] = true;
      addLove(a.reward);
      albumMoment(`🎊 ${a.name}：${a.txt}，好感 +${a.reward}`);
      albumBanner = { html: `🎊 <b>${a.name}</b>！${a.txt} · 纪念奖励 +${a.reward} 好感，去纪念册回顾两人的历程吧`, t: 9 };
      loveFxToast = { txt: `🎊 ${a.name} · 好感+${a.reward}`, t: 3.5 };
      break;
    }
  }
  persistSave();
}
/* ---- 特殊称号（由纪念册与游玩数据实时推导） ---- */
const LOVE_TITLES = [
  { id: 't0', name: '初识的伙伴',   desc: '开始这段旅程',                 cond: () => true },
  { id: 't1', name: '默契搭档',     desc: '协作弹跳 50 次',               cond: () => (save.loveStats.joint || 0) >= 50 },
  { id: 't2', name: '爱心收藏家',   desc: '收集 30 颗爱心水晶',           cond: () => (save.loveStats.hearts || 0) >= 30 },
  { id: 't3', name: '爱的守护者',   desc: '触发 30 次爱心护盾',           cond: () => (save.loveStats.shield || 0) >= 30 },
  { id: 't4', name: '携手旅行家',   desc: '通关 10 个主关卡',             cond: () => MAJORS.filter((m, mi) => save.subs[mi] && save.subs[mi].some(Boolean)).length >= 10 },
  { id: 't5', name: '回忆收藏家',   desc: '集齐 20 张合照',               cond: () => (save.photos || []).length >= 20 },
  { id: 't6', name: '长情告白者',   desc: '相识满 30 天',                 cond: () => save.album && albumDays() >= 30 },
  { id: 't7', name: '灵魂伴侣',     desc: '好感度达到满级「情深不渝」',   cond: () => loveLevel() >= loveMaxLevel() },
];
function loveTitlesGot() { return LOVE_TITLES.filter(t => { try { return t.cond(); } catch (e) { return false; } }); }
function loveTitleNow() { const g = loveTitlesGot(); return g[g.length - 1]; }

/* ================= 章节可达性（前置解锁 + 心之试炼好感度门票） ================= */
function majorReachable(mi) {
  const m = MAJORS[mi];
  return save.unlocked >= m.first && (!m.loveNeed || save.love >= m.loveNeed);
}

/* ================= 胜利时写入进度 ================= */
function recordWin(grade) {
  const prev = save.best[curLevel];
  if (!prev || (GRADE_RANK[grade] || 0) > (GRADE_RANK[prev] || 0)) save.best[curLevel] = grade;
  save.stars[curLevel] = Math.max(save.stars[curLevel] || 0, starsGot);
  if (curLevel + 1 > save.unlocked) save.unlocked = Math.min(curLevel + 1, LEVELS.length - 1);
  const mi = majorOf(curLevel), si = subOf(curLevel);
  if (!save.subs[mi]) save.subs[mi] = [];
  const firstClear = !save.subs[mi][si];
  save.subs[mi][si] = true;
  if (firstClear) save.bonusStars = (save.bonusStars || 0) + 1;   // 层级首通奖励星
  if (firstClear) {
    const trialBonus = MAJORS[mi].loveNeed ? LOVE_TRIAL_BONUS : 0;   // 心之试炼章节首通额外好感
    addLove(LOVE_FIRST_CLEAR + trialBonus);
    if (trialBonus) albumMoment(`💕 心之试炼 · 携手通过「${MAJORS[mi].name} · ${MAJORS[mi].subs[si]}」`);
  }
  // 合照解锁：本主关全部层通过 → 解锁对应合照；全部关卡通关 → 解锁彩蛋照
  newPhotoIdx = -1;
  // PHOTOS 只有 20 张：0~18 对应前 19 章，19 为全通彩蛋；新增章节（mi≥19）无对应照片不解锁，只走彩蛋判定
  if (firstClear && mi < PHOTOS.length - 1 && !save.photos.includes(mi) && majorCleared(mi)) {
    save.photos.push(mi); newPhotoIdx = mi;
  }
  if (firstClear && !save.photos.includes(PHOTOS.length - 1) && totalSubsDone() >= LEVELS.length) {
    save.photos.push(PHOTOS.length - 1); newPhotoIdx = PHOTOS.length - 1;
  }
  // 纪念册时光轴：记录里程碑节点
  if (firstClear) {
    if (majorCleared(mi)) albumMoment(`🏆 携手通过「${MAJORS[mi].name}」${newPhotoIdx === mi ? ' · 解锁新合照' : ''}`);
    if (newPhotoIdx === PHOTOS.length - 1) albumMoment('🎆 全部关卡通关！一二和布布的冒险暂告一段落');
  }
  persistSave();
  return firstClear;
}
let newPhotoIdx = -1;   // 最近一次胜利新解锁的合照下标（-1=无，过关画面提示用）

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

/* ================= 角色贴图：加载 + 自动抠图 + 皮肤切换 ================= */
/* 侧面移动形象皮肤：classic=根目录经典图，outing=img/ 郊游新图（168 白=一二、169 棕=布布）。
   正面图固定不变，仅移动（侧面）贴图随皮肤切换；同一时刻只加载当前皮肤资源（切换即释放旧皮肤）。 */
const SIDE_SRC = {
  classic: ['一二侧面.png', '布布侧面.png'],
  outing: ['img/微信图片_20260917172505_169_32.jpg', 'img/微信图片_20260917172503_168_32.jpg'],  // 169 白熊=一二、168 棕熊=布布
};
const SKIN_NAMES = { classic: '经典', outing: '郊游' };
/* 皮肤切脚配置：yTop=脚带上沿；seg=mid 中线分半 / proj 脚带 alpha 列投影取最宽两段（郊游图背包贴脚需避开）；
   erase=dark 只擦深色脚掌（经典图，留腿衬底）/ rect 按分段矩形整擦（郊游图，脚与身体同色）；
   swing=绕脚踝摆幅(弧度)；lift=抬脚高度(px)；slide=前后滑动幅度(px)——郊游图脚墩矮，旋转不可见，以滑步+抬步为主 */
const SKIN_SLICE = {
  classic: { yTop: 0.86, seg: 'mid', erase: 'dark', swing: 0.28, lift: 0, slide: 0 },
  outing: { yTop: 0.965, seg: 'proj', erase: 'rect', swing: 0.3, lift: 3.5, slide: 3.2 },
};
const sprites = [
  { front: null, side: null, slices: null, skin: null },
  { front: null, side: null, slices: null, skin: null },
];

function loadOne(src, cb) {
  const img = new Image();
  img.onload = () => cb(cutout(img));
  img.onerror = () => cb(null);
  img.src = src;
}
function loadSprites() {
  loadOne('一二.png', c => sprites[0].front = c);
  loadOne('布布.png', c => sprites[1].front = c);
  loadSideSprites();
}
/* 加载当前皮肤的侧面贴图（并切脚）；先置空释放旧皮肤画布引用供 GC */
function loadSideSprites() {
  const skin = SIDE_SRC[save.settings.skin] ? save.settings.skin : 'classic';
  const src = SIDE_SRC[skin], cfg = SKIN_SLICE[skin];
  for (let i = 0; i < 2; i++) { sprites[i].side = null; sprites[i].slices = null; sprites[i].skin = skin; }
  loadOne(src[0], c => { if (sprites[0].skin === skin) { sprites[0].side = c; sprites[0].slices = buildFootSlices(c, cfg); } });
  loadOne(src[1], c => { if (sprites[1].skin === skin) { sprites[1].side = c; sprites[1].slices = buildFootSlices(c, cfg); } });
}
/* 游戏内/设置界面切换皮肤：即时生效、状态连续（位置/动作不受影响），加载完成前暂用正面图回退 */
function setSkin(name) {
  if (!SIDE_SRC[name] || name === save.settings.skin) return false;
  save.settings.skin = name;
  persistSave();
  loadSideSprites();
  loveFxToast = { txt: '🎨 侧面形象已切换：' + SKIN_NAMES[name], t: 2.2 };
  return true;
}

/* 边缘洪水抠图：浅色（白底/灰渐变地板/水印）从边缘侵入，深色描边成墙 */
function cutout(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  let data;
  try { data = x.getImageData(0, 0, w, h); } catch (e) { return img; }
  const px = data.data;

  const cornerA = (X, Y) => px[(Y * w + X) * 4 + 3];
  if (cornerA(0, 0) < 40 && cornerA(w - 1, 0) < 40 && cornerA(0, h - 1) < 40 && cornerA(w - 1, h - 1) < 40) {
    return cropToContent(x, w, h);
  }

  const N = w * h;
  const bg = new Uint8Array(N);
  const stack = [];
  const LIGHT = 450;
  const sum = i => px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2];
  const seed = (sx, sy) => { const i = sy * w + sx; if (!bg[i] && sum(i) > LIGHT) { bg[i] = 1; stack.push(i); } };
  for (let sx = 0; sx < w; sx++) { seed(sx, 0); seed(sx, h - 1); }
  for (let sy = 0; sy < h; sy++) { seed(0, sy); seed(w - 1, sy); }
  while (stack.length) {
    const i = stack.pop();
    const ix = i % w, iy = (i - ix) / w;
    if (ix > 0)     { const j = i - 1; if (!bg[j] && sum(j) > LIGHT) { bg[j] = 1; stack.push(j); } }
    if (ix < w - 1) { const j = i + 1; if (!bg[j] && sum(j) > LIGHT) { bg[j] = 1; stack.push(j); } }
    if (iy > 0)     { const j = i - w; if (!bg[j] && sum(j) > LIGHT) { bg[j] = 1; stack.push(j); } }
    if (iy < h - 1) { const j = i + w; if (!bg[j] && sum(j) > LIGHT) { bg[j] = 1; stack.push(j); } }
  }
  for (let i = 0; i < N; i++) if (bg[i]) px[i * 4 + 3] = 0;
  keepLargestComponent(px, w, h);
  /* 边缘锐化（提升清晰度）：与透明相邻的像素对比度增强、alpha 拉满，去灰白边 */
  const snap = new Uint8ClampedArray(px);
  for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
    const i = (iy * w + ix) * 4;
    if (px[i + 3] === 0) continue;
    const nearHole = (ix > 0 && snap[(i - 4) + 3] === 0) || (ix < w - 1 && snap[(i + 4) + 3] === 0)
                  || (iy > 0 && snap[(i - w * 4) + 3] === 0) || (iy < h - 1 && snap[(i + w * 4) + 3] === 0);
    if (!nearHole) continue;
    const bright = snap[i] + snap[i + 1] + snap[i + 2];
    if (bright > 420) { px[i] = 120; px[i + 1] = 95; px[i + 2] = 80; }          // 白边压成描边色
    else if (bright < 260) {                                                      // 暗边提亮
      px[i] = Math.min(255, snap[i] + 26); px[i + 1] = Math.min(255, snap[i + 1] + 26); px[i + 2] = Math.min(255, snap[i + 2] + 26);
    }
    px[i + 3] = 255;
  }
  x.putImageData(data, 0, 0);
  return cropToContent(x, w, h);
}

/* 只保留最大连通域，清除碎屑 */
function keepLargestComponent(px, w, h) {
  const N = w * h;
  const label = new Int32Array(N).fill(-1);
  let sizes = [];
  for (let s = 0; s < N; s++) {
    if (px[s * 4 + 3] === 0 || label[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    label[s] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const ix = i % w, iy = (i - ix) / w;
      const tryPush = j => { if (px[j * 4 + 3] !== 0 && label[j] === -1) { label[j] = id; stack.push(j); } };
      if (ix > 0) tryPush(i - 1);
      if (ix < w - 1) tryPush(i + 1);
      if (iy > 0) tryPush(i - w);
      if (iy < h - 1) tryPush(i + w);
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return;
  let best = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  for (let i = 0; i < N; i++) if (label[i] !== -1 && label[i] !== best) px[i * 4 + 3] = 0;
}

/* 按内容包围盒裁剪 */
function cropToContent(x, w, h) {
  const data = x.getImageData(0, 0, w, h);
  const px = data.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
    if (px[(iy * w + ix) * 4 + 3] > 10) {
      if (ix < minX) minX = ix;
      if (ix > maxX) maxX = ix;
      if (iy < minY) minY = iy;
      if (iy > maxY) maxY = iy;
    }
  }
  if (maxX < 0) return x.canvas;
  const pad = 2;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(x.canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/* 侧面贴图切脚：底部脚带分「前脚/后脚」两块，生成 身体(无脚)+前脚+后脚 三层画布。
   cfg.seg='mid'：画面中线分半（经典图，两脚跨中线）；'proj'：脚带 alpha 列投影取最宽两段（郊游图，背包贴脚需避开）。
   cfg.erase='dark'：身体只擦深色脚掌留腿衬底；'rect'：按分段矩形整擦（脚与身体同色）。
   每脚旋转锚点取该段脚带深色像素重心 x（无深色则段中心）。返回 null 表示失败，绘制时回退整图。 */
function buildFootSlices(cv, cfg) {
  if (!cv) return null;
  cfg = cfg || { yTop: 0.86, seg: 'mid', erase: 'dark' };
  try {
    const w = cv.width, h = cv.height;
    const yTop = Math.floor(h * cfg.yTop);
    const px = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const isDark = (ix, iy) => { const i = (iy * w + ix) * 4; return px[i + 3] > 120 && px[i] + px[i + 1] + px[i + 2] < 330; };
    const pad = 3;
    // 求两脚列区间
    let segs;
    if (cfg.seg === 'proj') {
      const col = new Uint8Array(w);
      for (let iy = yTop; iy < h; iy++) for (let ix = 0; ix < w; ix++) if (px[(iy * w + ix) * 4 + 3] > 200) col[ix] = 1;
      const runs = []; let s0 = -1;
      for (let ix = 0; ix <= w; ix++) {
        if (ix < w && col[ix]) { if (s0 < 0) s0 = ix; }
        else if (s0 >= 0) { if (ix - s0 >= 3) runs.push([s0, ix - 1]); s0 = -1; }
      }
      if (runs.length < 2) return null;
      runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
      segs = runs.slice(0, 2).sort((a, b) => a[0] - b[0]);
    } else {
      const mid = Math.floor(w / 2);
      segs = [[0, mid + pad], [mid - pad, w - 1]];
    }
    const mk = (x0, x1) => {
      const a = Math.max(0, x0), b = Math.min(w - 1, x1);
      const top = Math.max(0, yTop - pad), cw = b - a + 1, ch = h - top;
      let sx = 0, n = 0;
      for (let iy = yTop; iy < h; iy++) for (let ix = a; ix <= b; ix++) if (isDark(ix, iy)) { sx += ix; n++; }
      const ankle = n ? sx / n : (a + b) / 2;
      const c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch;
      c2.getContext('2d').drawImage(cv, a, top, cw, ch, 0, 0, cw, ch);
      return { cv: c2, x0: a, top, ankle };
    };
    const front = mk(segs[0][0], segs[0][1]);   // 前脚=左段（角色朝左）
    const back = mk(segs[1][0], segs[1][1]);    // 后脚=右段
    const bc = document.createElement('canvas'); bc.width = w; bc.height = h;
    const bx = bc.getContext('2d', { willReadFrequently: true });
    bx.drawImage(cv, 0, 0);
    const bd = bx.getImageData(0, 0, w, h), bp = bd.data;
    if (cfg.erase === 'rect') {
      for (const [x0, x1] of segs) for (let iy = yTop; iy < h; iy++) for (let ix = x0; ix <= x1; ix++) bp[(iy * w + ix) * 4 + 3] = 0;
    } else {
      for (let iy = yTop; iy < h; iy++) for (let ix = 0; ix < w; ix++) if (isDark(ix, iy)) bp[(iy * w + ix) * 4 + 3] = 0;
    }
    bx.putImageData(bd, 0, 0);
    return { body: bc, front, back, swing: cfg.swing ?? WALK_SWING, lift: cfg.lift || 0, slide: cfg.slide || 0 };
  } catch (e) { return null; }
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

/* 情侣协作技能：爱心护盾 + 牵手判定（每帧在 tick 中调用） */
function updateLoveSkills() {
  if (shieldCd > 0) shieldCd -= STEP;
  if (shieldT > 0) shieldT -= STEP;
  const a = players[0], b = players[1];
  if (!a || !b) { handHolding = false; return; }
  const dx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
  const dy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
  const sameDir = a.inputDir !== 0 && a.inputDir === b.inputDir;
  handHolding = dx < HAND_DX && dy < HAND_DY && sameDir;
  // 牵手时长统计：全程累计（与牵手加速一致无等级门槛，保证「牵手同行」任务可达）
  if (handHolding) save.loveStats.holding = (save.loveStats.holding || 0) + STEP;
  // 爱心护盾：双人「靠近 + 几乎同时成功起跳」（6 帧窗口）且不在弹跳台上 → 触发短暂无敌
  if (a._jumpEdge > 0 && b._jumpEdge > 0 && dx < SHIELD_DX && dy < SHIELD_DY && shieldCd <= 0 && !padUnder(a) && !padUnder(b)) {
    shieldT = SHIELD_DURATION; shieldCd = SHIELD_CD;
    a._jumpEdge = b._jumpEdge = 0;
    save.loveStats.shield = (save.loveStats.shield || 0) + 1;
    addLove(LOVE_SHIELD);
    sfxShield();
  }
}

function isIceBelow(p) {
  const foot = { x: p.x + 2, y: p.y + p.h, w: p.w - 4, h: 3 };
  return solids.some(s => s.ice && collide(foot, s));
}

/* ================= 碰撞 ================= */
function collide(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isSolidAt(x, y, w, h, who) {
  const box = { x, y, w, h };
  for (const s of solids) if (collide(box, s)) return true;
  for (const d of doors) {
    if (!d.open) {
      const db = { x: d.x - TILE / 2 + 4, y: d.baseY - TILE, w: TILE - 8, h: TILE };
      if (collide(box, db)) return true;
    }
  }
  for (const g of ghostDoors) {
    if (who && who.idx !== g.allowIdx && collide(box, g)) return true;
  }
  for (const b of boxes) if (collide(box, b)) return true;
  for (const pad of pads) if (collide(box, pad)) return true;
  if (bridgeOn) for (const br of bridges) if (collide(box, br)) return true;   // 心之桥：双人贴近时实体化
  return false;
}

function inGravZone(p) {
  const body = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 };
  return gravZones.some(z => collide(body, z));
}

function stepPlayer(p) {
  // 移动平台载人：先跟随平台位移
  if (p.onPlat) { p.x += p.onPlat.px; p.y += p.onPlat.py; }
  p.gflip = inGravZone(p);

  // 水平：先记录移动方向再回退，速度清零必须放在循环外
  const hdir = Math.sign(p.vx);
  p.x += p.vx * STEP;
  let hitWall = false;
  for (let i = 0; i < 30 && isSolidAt(p.x, p.y, p.w, p.h, p); i++) {
    hitWall = true;
    if (hdir > 0) p.x -= 1;
    else if (hdir < 0) p.x += 1;
    else break;
  }
  if (hitWall && hdir !== 0) p.vx = 0;

  // 嵌墙弹出：无移动方向却被塞进墙体（被互推/平台带入）时，水平找最近空位弹出；
  // 否则垂直回退循环会因「上移仍与高墙相交」每帧顶 40px，把角色一路顶出地图
  if (isSolidAt(p.x, p.y, p.w, p.h, p)) {
    for (let d = 1; d <= 44; d++) {
      if (!isSolidAt(p.x - d, p.y, p.w, p.h, p)) { p.x = Math.max(0, p.x - d); break; }
      if (!isSolidAt(p.x + d, p.y, p.w, p.h, p)) { p.x = Math.min(cols * TILE - p.w, p.x + d); break; }
    }
  }

  // 垂直（重力方向可反转）：回退方向始终与运动方向相反
  const gv = p.gflip ? -GRAVITY : GRAVITY;
  const prevFeet = p.y + p.h, prevHead = p.y;
  const vdir = Math.sign(p.vy);
  p.vy += gv * STEP;
  p.y += p.vy * STEP;
  p.onGround = false;
  p.onPlat = null;
  let hitV = false;
  for (let i = 0; i < 40 && isSolidAt(p.x, p.y, p.w, p.h, p); i++) {
    hitV = true;
    const falling = p.gflip ? vdir <= 0 : vdir >= 0;   // 是否沿重力方向运动
    if (falling) {
      if (p.gflip) p.y += 1; else p.y -= 1;             // 顶出支撑面
      p.onGround = true;
    } else {
      if (p.gflip) p.y -= 1; else p.y += 1;             // 撞头退回
    }
  }
  if (hitV) p.vy = 0;

  // 单向移动平台：只有从上方下落时才落在平台上（可自下穿过）
  if (!p.gflip && p.vy >= 0) {
    const feet = p.y + p.h;
    for (const pl of plats) {
      if (p.x + p.w > pl.x && p.x < pl.x + pl.w && prevFeet <= pl.y + 4 && feet >= pl.y) {
        p.y = pl.y - p.h; p.vy = 0; p.onGround = true; p.onPlat = pl;
        break;
      }
    }
  } else if (p.gflip && p.vy <= 0) {
    const head = p.y;
    for (const pl of plats) {
      if (p.x + p.w > pl.x && p.x < pl.x + pl.w && prevHead >= pl.y + pl.h - 4 && head <= pl.y + pl.h) {
        p.y = pl.y + pl.h; p.vy = 0; p.onGround = true; p.onPlat = pl;
        break;
      }
    }
  }

  if (p.onGround) {
    // 落地吸附：消除整数回退造成的 ±1px 抖动
    const surf = supportTopAt(p);
    if (!p.gflip && surf !== null && surf > p.y + p.h && surf - (p.y + p.h) <= 2) p.y = surf - p.h;
    if (p.gflip) {
      const surfB = supportBottomAt(p);
      if (surfB !== null && surfB <= p.y && p.y - surfB <= 2) p.y = surfB;
    }
  }
  p.x = Math.max(0, Math.min(cols * TILE - p.w, p.x));
}

function supportTopAt(p) {
  const footY = p.y + p.h;
  let best = null;
  const consider = s => {
    if (p.x + p.w > s.x && p.x < s.x + s.w && s.y >= footY - 2 && s.y <= footY + 20) {
      if (best === null || s.y < best) best = s.y;
    }
  };
  for (const s of solids) consider(s);
  for (const b of boxes) consider(b);
  for (const pad of pads) consider(pad);
  for (const g of ghostDoors) if (p.idx !== g.allowIdx) consider(g);
  for (const pl of plats) consider({ x: pl.x, y: pl.y, w: pl.w, h: pl.h });
  if (bridgeOn) for (const br of bridges) consider(br);   // 心之桥顶面可落脚
  for (const d of doors) {
    if (!d.open) consider({ x: d.x - TILE / 2 + 4, y: d.baseY - TILE, w: TILE - 8, h: TILE });
  }
  return best;
}

function supportBottomAt(p) {
  const headY = p.y;
  let best = null;
  const consider = s => {
    if (p.x + p.w > s.x && p.x < s.x + s.w && s.y + s.h <= headY + 2 && s.y + s.h >= headY - 20) {
      if (best === null || s.y + s.h > best) best = s.y + s.h;
    }
  };
  for (const s of solids) consider(s);
  for (const b of boxes) consider(b);
  for (const pad of pads) consider(pad);
  for (const g of ghostDoors) if (p.idx !== g.allowIdx) consider(g);
  return best;
}

/* ================= 移动平台 ================= */
function updatePlats() {
  for (const pl of plats) {
    if (pl.axis === 'lift') continue;   // 平衡升降台由 updateLifts 统一驱动
    pl.t += STEP * pl.speed;
    const off = Math.sin(pl.t) * pl.range;
    const nx = pl.axis === 'x' ? pl.ox + off : pl.ox;
    const ny = pl.axis === 'y' ? pl.oy + off : pl.oy;
    pl.px = nx - pl.x; pl.py = ny - pl.y;
    pl.x = nx; pl.y = ny;
  }
}

/* ================= 恋爱终章机关：心之桥 / 平衡升降台 / 同心连压板 ================= */
/* 心之桥：双人中心距 ≤ BRIDGE_DX/DY 时桥砖实体化（牵手同行过深渊），分开即消失 */
function computeBridgeOn() {
  const a = players[0], b = players[1];
  if (!a || !b || !bridges.length) { bridgeOn = false; return; }
  const dx = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2));
  const dy = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2));
  bridgeOn = dx <= BRIDGE_DX && dy <= BRIDGE_DY;
}

/* 平衡升降台：双人同站顶面 → 匀速上升；都离开 → 缓降回位；单人 → 停留 */
function updateLifts() {
  if (!lifts.length) return;
  let onCount = 0;
  for (const p of players) if (p.onPlat && p.onPlat.axis === 'lift') onCount++;
  if (onCount >= 2) liftOff = Math.min(liftOff + LIFT_SPEED * STEP, rows * TILE);
  else if (onCount === 0) liftOff = Math.max(liftOff - LIFT_SPEED * STEP, 0);
  for (const pl of lifts) {
    const ny = pl.oy - liftOff;
    pl.px = 0; pl.py = ny - pl.y;
    pl.y = ny;
  }
}

/* 同心连压板：一对板各站一人（交叉亦可）→ 点亮并开启配对 K 门；离开即关（momentary） */
function updateLinkPlates() {
  if (!jPairs.length) return;
  const a = players[0], b = players[1];
  const on = (plate, p) => {
    const foot = { x: p.x + 2, y: p.y + p.h - 4, w: p.w - 4, h: 4 };
    return collide(foot, { x: plate.x, y: plate.y + plate.h - 10, w: plate.w, h: 10 });
  };
  for (const pr of jPairs) {
    const lit = (on(pr.a, a) && on(pr.b, b)) || (on(pr.a, b) && on(pr.b, a));
    pr.a.lit = pr.b.lit = lit;
    if (pr.door) pr.door.open = lit;
  }
}

/* ================= 协作弹跳台：双人同站蓄力→共同高跳 ================= */
function padUnder(p) {
  const foot = { x: p.x + 2, y: p.y + p.h - 6, w: p.w - 4, h: 8 };
  for (const pad of pads) if (collide(foot, { x: pad.x, y: pad.y, w: pad.w, h: 10 })) return pad;
  return null;
}
function updatePads() {
  const a = players[0], b = players[1];
  const ready = a && b && a.onGround && b.onGround;
  const pa = ready ? padUnder(a) : null;
  const pb = ready ? padUnder(b) : null;
  const pad = pa || pb;
  const bothOnPad = pa && pb && Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) < PAD_JOINT_DX;
  if (pad) {
    if (bothOnPad) {
      pad.charge += STEP;
      if (pad.charge >= PAD_CHARGE) {
        pad.charge = 0; pad.flash = 0.6;
        for (const p of [a, b]) { p.vy = p.gflip ? JOINT_JUMP : -JOINT_JUMP; p.onGround = false; p.onPlat = null; }
        sfxJump(); beep(680, 0.16, 'square', 0.09);
        save.loveStats.joint = (save.loveStats.joint || 0) + 1;
        addLove(LOVE_JOINT_JUMP);
      }
    } else {
      pad.charge = Math.max(0, pad.charge - STEP * 2);
    }
  }
  for (const pd of pads) if (pd.flash > 0) pd.flash = Math.max(0, pd.flash - STEP);
}

/* ================= 木箱推动 ================= */
function pushBoxes() {
  for (const box of boxes) {
    box.vx = 0;
    for (const p of players) {
      const facing = p.face > 0 ? p.x + p.w : p.x;
      const boxEdge = p.face > 0 ? box.x : box.x + box.w;
      if (Math.abs(facing - boxEdge) < 4 && Math.abs((p.y + p.h) - (box.y + box.h)) < 8) {
        box.vx = p.vx * BOX_PUSH;
        break;
      }
    }
    if (box.vx === 0) continue;
    box.x += box.vx * STEP;
    for (const s of solids) {
      if (collide(box, s)) { box.x = box.vx > 0 ? s.x - box.w : s.x + s.w; box.vx = 0; }
    }
    for (const d of doors) {
      if (!d.open) {
        const db = { x: d.x - TILE / 2 + 4, y: d.baseY - TILE, w: TILE - 8, h: TILE };
        if (collide(box, db)) { box.x = box.vx > 0 ? db.x - box.w : db.x + db.w; box.vx = 0; }
      }
    }
    for (const other of boxes) {
      if (other !== box && collide(box, other)) { box.x = box.vx > 0 ? other.x - box.w : other.x + other.w; box.vx = 0; }
    }
  }
}

/* ================= 史莱姆巡逻 ================= */
function updateSlimes() {
  for (const s of slimes) {
    s.x += s.dir * 40 * STEP;
    if (s.x > s.homeX + s.range - TILE) s.dir = -1;
    if (s.x < s.homeX - TILE * 0.4) s.dir = 1;
    s.hop = Math.abs(Math.sin(animT * 4 + s.homeX)) * 4;
  }
}

/* ================= Boss：冰火双子 =================
   攻击循环：idle → telegraph（预警）→ attack（发射）
   - projectile：冰侧发射蓝色弹，布布(火)可挡、一二要跳
   - wave：火侧发射火浪，一二(水)可熄、布布要跳
   - 每次攻击后 1.2s 弱点暴露：冰核只能布布碰、火核只能一二碰（属性协作破防） */
function updateBoss() {
  if (!boss) return;
  if (boss.dead) { boss.deathT += STEP; return; }
  const b = boss;
  b.pt += STEP;
  if (b.hitFlash > 0) b.hitFlash -= STEP;

  if (b.phase === 'idle' && b.pt > 1.6) {
    b.phase = 'telegraph'; b.pt = 0;
    b.attack = (Math.floor(animT * 0.7) % 2 === 0) ? 'projectile' : 'wave';
  } else if (b.phase === 'telegraph' && b.pt > 0.9) {
    b.phase = 'attack'; b.pt = 0;
    if (b.attack === 'projectile') {
      b.projectiles.push({ x: b.ice.x + 10, y: b.baseY - 14, w: 20, h: 20, vx: -160, type: 'ice' });
      b.projectiles.push({ x: b.ice.x + 10, y: b.baseY - 14, w: 20, h: 20, vx: 160, type: 'ice' });
    } else {
      b.waves.push({ x: b.fire.x + 10, y: b.baseY - 12, w: 22, h: 14, vx: -140, type: 'fire' });
      b.waves.push({ x: b.fire.x + 10, y: b.baseY - 12, w: 22, h: 14, vx: 140, type: 'fire' });
    }
  } else if (b.phase === 'attack' && b.pt > 0.5) {
    b.phase = 'idle'; b.pt = 0;
  }

  for (const pr of b.projectiles) pr.x += pr.vx * STEP;
  for (const wv of b.waves) wv.x += wv.vx * STEP;
  b.projectiles = b.projectiles.filter(pr => pr.x > -40 && pr.x < cols * TILE + 40);
  b.waves = b.waves.filter(wv => wv.x > -40 && wv.x < cols * TILE + 40);

  b.weak = (b.phase === 'idle' && b.pt < 1.2);
  b.weakSide = b.attack === 'projectile' ? 'ice' : 'fire';

  if (b.weak) {
    const core = b.weakSide === 'ice' ? b.ice : b.fire;
    const coreBox = { x: core.x + 8, y: b.baseY - 16, w: 26, h: 20 };
    const needIdx = b.weakSide === 'ice' ? 1 : 0;   // 冰核→布布，火核→一二
    for (const p of players) {
      if (p.idx === needIdx && collide(p, coreBox)) {
        b.hp--; b.hitFlash = 0.25; b.weak = false;
        if (b.hp <= 0) { b.dead = true; b.deathT = 0; }
      }
    }
  }
}

/* ================= 危险检测 ================= */
function checkHazards() {
  // 爱心护盾：挡下接触伤害（坠落出世界仍致命），挡伤后护盾消耗
  const fatal = checkHazardsFatal();
  if (fatal && shieldT > 0 && players.every(p => p.y <= rows * TILE + 100 && p.y >= -200)) {
    shieldT = 0; shieldCd = 7; sfxShield();
    return false;
  }
  return fatal;
}
function checkHazardsFatal() {
  for (const p of players) {
    const feet = { x: p.x + 2, y: p.y + p.h - 6, w: p.w - 4, h: 6 };
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (const w of waters) if (collide(feet, w) && p.idx !== 0) return true;
    for (const l of lavas) if (collide(feet, l) && p.idx !== 1) return true;
    for (const t of toxins) if (collide(body, t)) return true;
    for (const sp of spikes) {
      const zone = sp.dir === 1 ? feet : body;   // 地刺查脚、顶刺查全身
      if (collide(zone, sp)) return true;
    }
    for (const f of flames) {                     // 火焰喷射：周期 3 秒，喷 1.2 秒；r 节奏火墙全局同相位
      const ph = f.sync ? (animT % RHYTHM_CYCLE) : ((animT + f.t) % 3);
      if (ph < (f.sync ? RHYTHM_ON : 1.2)) {
        const col = { x: f.x - 8, y: f.up ? f.baseY - 88 : f.baseY, w: 16, h: 88 };
        if (collide(body, col)) return true;
      }
    }
    for (const s of slimes) if (collide(body, { x: s.x, y: s.y + s.hop, w: s.w, h: s.h - s.hop })) return true;
    if (p.y > rows * TILE + 100 || p.y < -200) return true;
  }
  // Boss 弹体：免疫属性可挡下（摧毁弹体），否则致命
  if (boss && !boss.dead) {
    for (const pr of boss.projectiles) {
      for (const p of players) {
        if (!collide(p, pr)) continue;
        if (pr.type === 'ice' && p.idx === 1) { pr.safe = true; }
        else if (pr.type === 'fire' && p.idx === 0) { pr.safe = true; }
        else return true;
      }
    }
    for (const wv of boss.waves) {
      for (const p of players) {
        if (!collide(p, wv)) continue;
        if (wv.type === 'fire' && p.idx === 0) { wv.safe = true; }
        else if (wv.type === 'ice' && p.idx === 1) { wv.safe = true; }
        else return true;
      }
    }
    boss.projectiles = boss.projectiles.filter(pr => !pr.safe);
    boss.waves = boss.waves.filter(wv => !wv.safe);
  }
  return false;
}

/* ================= 按钮与门 ================= */
const btnBox = b => ({ x: b.x - b.w / 2, y: b.y, w: b.w, h: b.h });

function updateButtonsAndDoors() {
  for (const btn of buttons) btn.pressed = false;
  for (const p of players) {
    for (const btn of buttons) {
      if (btn.who === -1 || btn.who === p.idx) {
        const box = { x: p.x, y: p.y + p.h - 4, w: p.w, h: 4 };
        if (collide(box, btnBox(btn))) btn.pressed = true;
      }
    }
  }
  for (const box of boxes) {
    for (const btn of buttons) {
      const boxBottom = { x: box.x, y: box.y + box.h - 4, w: box.w, h: 4 };
      if (collide(boxBottom, btnBox(btn))) btn.pressed = true;
    }
  }
  for (const door of doors) {
    if (door.momentary) continue;   // K 连压板门由 updateLinkPlates 驱动
    door.open = false;
    for (const btn of buttons) {
      if (btn.color === door.color && btn.pressed) { door.open = true; break; }
    }
  }
}

/* ================= 甜品收集（一二吃蛋糕/布布喝奶茶） / 过关 ================= */
function collectGems() {
  for (const gem of gems) {
    if (gem.got) continue;
    for (const p of players) {
      if (gem.owner === -1 || gem.owner === p.idx) {
        const dx = (p.x + p.w / 2) - gem.x;
        const dy = (p.y + p.h / 2) - gem.y;
        if (Math.sqrt(dx * dx + dy * dy) < gem.r + 12) {
          gem.got = true;
          if (gem.star) starsGot++;
        }
      }
    }
  }
}

/* 爱心水晶收集：任一角色碰到即得（情侣道具，+5 好感）。
   同一关卡计入任务进度/好感最多 HEART_CAP 次（超出仍拾取消失，但不再涨数值，防刷关）。 */
function heartCounted() { return save.heartLv[curLevel] || 0; }
function collectHearts() {
  for (const hc of hearts) {
    if (hc.got) continue;
    for (const p of players) {
      const dx = (p.x + p.w / 2) - hc.x, dy = (p.y + p.h / 2) - hc.y;
      if (Math.sqrt(dx * dx + dy * dy) < hc.r + 12) {
        hc.got = true;
        if (heartCounted() < HEART_CAP) {
          save.heartLv[curLevel] = heartCounted() + 1;
          save.loveStats.hearts = (save.loveStats.hearts || 0) + 1;
          addLove(LOVE_HEART);
          persistSave();
        }
        sfxHeart();
        break;
      }
    }
  }
}

function checkExit() {
  if (exits.length === 0) return false;
  if (boss && !boss.dead) return false;
  const minX = Math.min(...exits.map(e => e.x)) - TILE / 2 + 4;
  const maxX = Math.max(...exits.map(e => e.x)) + TILE / 2 - 4;
  const exitBox = { x: minX, y: exits[0].baseY - 20, w: maxX - minX, h: 20 };
  for (const p of players) {
    const feetBox = { x: p.x + 4, y: p.y + p.h - 10, w: p.w - 8, h: 10 };
    if (!collide(feetBox, exitBox)) return false;
  }
  return true;
}

/* ================= 评分 ================= */
function computeGrade() {
  const par = PAR_TIME[curLevel] || 40;
  let score = 100;
  if (levelTime > par) score -= Math.min(30, Math.floor((levelTime - par) / par * 30));
  score -= gems.filter(g => !g.got).length * 8;
  score -= deaths * 10;
  score = Math.max(0, score);
  const grade = score >= 95 ? 'S' : score >= 80 ? 'A' : score >= 60 ? 'B' : 'C';
  return { grade, score };
}

/* ================= 角色动画 ================= */
const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function updateAnim(p, dt) {
  const wantSide = p.inputDir !== 0 || Math.abs(p.vx) > 40;
  const wantMode = wantSide ? 'side' : 'front';
  const wantFace = p.inputDir !== 0 ? p.inputDir : (Math.abs(p.vx) > 1 ? Math.sign(p.vx) : p.face);

  const mismatch = wantMode !== p.mode || (wantMode === 'side' && wantFace !== p.face);
  if (mismatch) {
    if (p.flipT == null) {
      p.flipT = 0; p.swapDone = false;
      p.pendingMode = wantMode; p.pendingFace = wantFace;
    } else if (p.swapDone) {
      p.flipT = 0; p.swapDone = false;
      p.pendingMode = wantMode; p.pendingFace = wantFace;
    } else {
      p.pendingMode = wantMode; p.pendingFace = wantFace;
    }
  } else if (p.flipT != null && !p.swapDone && wantMode === p.mode && (wantMode !== 'side' || wantFace === p.face)) {
    p.flipT = null;
  }

  if (p.flipT != null) {
    p.flipT += dt / p.flipDur;
    const e = easeInOutCubic(Math.min(1, p.flipT));
    if (!p.swapDone && e >= 0.5) {
      p.mode = p.pendingMode;
      p.face = p.pendingFace;
      p.swapDone = true;
    }
    if (p.flipT >= 1) { p.flipT = null; p.settleT = 0; }
  } else if (p.settleT != null) {
    p.settleT += dt / 0.14;
    if (p.settleT >= 1) p.settleT = null;
  }

  const targetTilt = Math.max(-1, Math.min(1, p.vx / SPEED)) * 0.12;
  p.tilt += (targetTilt - p.tilt) * Math.min(1, dt * 10);

  const moving = p.onGround && Math.abs(p.vx) > WALK_MIN_VX;
  if (moving) p.walkPhase += Math.abs(p.vx) * dt * WALK_STRIDE;
  // 迈步混合系数：移动趋近 1、静止趋近 0（平滑过渡，脚部自然回到站立）
  p.walkBlend += ((moving ? 1 : 0) - p.walkBlend) * Math.min(1, dt * WALK_BLEND_RATE);
}

/* ================= 相机（横版卷轴：跟随双人中点，限制在关卡边界内） ================= */
function cameraTarget() {
  const maxCam = Math.max(0, cols * TILE - LOGICAL_W);
  if (players.length < 2) return 0;
  const mid = (players[0].x + players[0].w / 2 + players[1].x + players[1].w / 2) / 2;
  return Math.max(0, Math.min(maxCam, mid - LOGICAL_W / 2));
}
function updateCamera(dt) {
  const target = cameraTarget();
  const k = Math.min(1, dt * 6);           // 平滑跟随
  camX += (target - camX) * k;
  if (Math.abs(camX - target) < 0.3) camX = target;
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
    dead = true;
    deaths++;
    sfxDeath();
    showOverlay('⏳ 时间到！', `限时 ${lim}s · 重置中...`);
    setTimeout(() => { if (screenMode === 'play' && dead) loadLevel(curLevel, true); }, 700);
    return;
  }

  if (checkHazards()) {
    dead = true;
    deaths++;
    sfxDeath();
    showOverlay('哎呀！', '重置中...');
    setTimeout(() => { if (screenMode === 'play' && dead) loadLevel(curLevel, true); }, 700);
  }

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

/* ================================================================
   渲染（逻辑坐标 640×400，2x 后备画布高清）
   ================================================================ */
function roundRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground(theme) {
  const W = LOGICAL_W, H = LOGICAL_H;
  // 天空渐变按主题缓存（createLinearGradient 每帧重建是纯浪费）
  if (!theme._skyGrad || theme._skyKey !== theme.sky[0] + theme.sky[1]) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(1, theme.sky[1]);
    theme._skyGrad = g; theme._skyKey = theme.sky[0] + theme.sky[1];
  }
  ctx.fillStyle = theme._skyGrad;
  ctx.fillRect(0, 0, W, H);

  if (theme.celestial === 'moon' || theme.celestial === 'both') {
    ctx.fillStyle = 'rgba(255,244,200,.25)';
    ctx.beginPath(); ctx.arc(548, 62, 42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f6ecc8';
    ctx.beginPath(); ctx.arc(548, 62, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = theme.sky[0];
    ctx.beginPath(); ctx.arc(538, 54, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 24; i++) {
      const sx = (i * 173) % W, sy = (i * 97) % (H * 0.55);
      const tw = 0.5 + 0.5 * Math.sin(animT * 2 + i);
      ctx.globalAlpha = 0.35 + 0.5 * tw;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    if (theme.celestial === 'both') {
      ctx.fillStyle = 'rgba(255,150,80,.35)';
      ctx.beginPath(); ctx.arc(90, 60, 40, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffb37a';
      ctx.beginPath(); ctx.arc(90, 60, 22, 0, Math.PI * 2); ctx.fill();
    }
  } else if (theme.celestial === 'ember') {
    ctx.fillStyle = 'rgba(255,110,40,.18)';
    ctx.beginPath(); ctx.arc(320, 330, 160, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 14; i++) {
      const ex = (i * 211 + animT * 18) % W;
      const ey = H - ((animT * 26 + i * 61) % H);
      ctx.fillStyle = `rgba(255,${140 + (i % 3) * 30},60,${0.25 + 0.2 * Math.sin(animT * 3 + i)})`;
      ctx.fillRect(ex, ey, 2, 2);
    }
  } else {
    const sx = theme.celestial === 'sunLow' ? 120 : 540;
    const sy = theme.celestial === 'sunLow' ? 90 : 58;
    ctx.fillStyle = 'rgba(255,240,180,.5)';
    ctx.beginPath(); ctx.arc(sx, sy, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(sx, sy, 28, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = theme.cloud;
  for (let i = 0; i < 5; i++) {
    const span = W + 200;
    const cx = (((i * 260 + animT * (6 + i * 2) - camX * 0.15) % span) + span) % span - 100;
    const cy = 42 + (i % 3) * 34;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.arc(cx + 18, cy - 6, 13, 0, Math.PI * 2);
    ctx.arc(cx + 36, cy, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  // 远山/近丘：正弦轮廓 + 视差滚动（远 0.3、近 0.55）
  const hills = (par, amp, base, freq, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = x + camX * par;
      const y = H - base - amp * (0.6 + 0.4 * Math.sin(wx * freq)) * (0.5 + 0.5 * Math.sin(wx * freq * 0.37 + 1.7));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath(); ctx.fill();
  };
  hills(0.3, 130, 40, 0.008, theme.hillFar);
  hills(0.55, 90, 10, 0.013, theme.hillNear);

  // 浪漫主题：全屏缓缓上升的爱心粒子
  if (theme.id === 'love') {
    for (let i = 0; i < 10; i++) {
      const hx = (i * 137 + Math.sin(animT * 0.6 + i * 2) * 26) % W;
      const hy = H - ((animT * 22 + i * 83) % (H + 40)) + 20;
      const a = 0.18 + 0.14 * Math.sin(animT * 1.5 + i);
      drawHeartShape(hx, hy, 0.9 + (i % 3) * 0.4, `rgba(255,${150 + (i % 4) * 20},${190 + (i % 3) * 20},${a})`);
    }
  }
}

function drawTiles(theme) {
  // 视口剪裁：只画 camX 可见列（世界 x ∈ [camX-40, camX+LOGICAL_W+40]）；上方实心判断走 solidSet O(1)
  const vx0 = camX - 40, vx1 = camX + LOGICAL_W + 40;
  for (const s of solids) {
    if (s.x + s.w < vx0 || s.x > vx1) continue;
    ctx.fillStyle = theme.ground;
    roundRectPath(s.x + 1, s.y + 1, s.w - 2, s.h - 2, 6);
    ctx.fill();
    const aboveSolid = solidSet.has(s.x + ',' + (s.y - TILE));
    if (!aboveSolid) {
      if (s.ice) {
        ctx.fillStyle = 'rgba(190,235,255,.95)';
        roundRectPath(s.x + 1, s.y + 1, s.w - 2, 12, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x + 6, s.y + 10); ctx.lineTo(s.x + 16, s.y + 3);
        ctx.moveTo(s.x + 20, s.y + 11); ctx.lineTo(s.x + 30, s.y + 4);
        ctx.stroke();
      } else {
        ctx.fillStyle = theme.grass;
        roundRectPath(s.x + 1, s.y + 1, s.w - 2, 12, 6);
        ctx.fill();
      }
    }
  }
}

function drawPools() {
  const wave = (x, y, w, amp) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i <= w; i += 4) {
      ctx.lineTo(x + i, y + Math.sin(animT * 3 + (x + i) * 0.09) * amp);
    }
  };
  for (const p of waters) {
    ctx.fillStyle = 'rgba(96,170,255,.8)';
    ctx.fillRect(p.x, p.y + 8, p.w, p.h - 8);
    ctx.strokeStyle = 'rgba(210,238,255,.95)';
    ctx.lineWidth = 3;
    wave(p.x, p.y + 8, p.w, 2);
    ctx.stroke();
  }
  for (const p of lavas) {
    ctx.fillStyle = 'rgba(255,120,50,.88)';
    ctx.fillRect(p.x, p.y + 8, p.w, p.h - 8);
    ctx.strokeStyle = 'rgba(255,210,120,.95)';
    ctx.lineWidth = 3;
    wave(p.x, p.y + 8, p.w, 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,220,150,.8)';
    const bx = p.x + ((animT * 30 + p.x) % p.w);
    ctx.beginPath(); ctx.arc(bx, p.y + p.h - 10, 3, 0, Math.PI * 2); ctx.fill();
  }
  for (const p of toxins) {
    ctx.fillStyle = 'rgba(150,90,220,.8)';
    ctx.fillRect(p.x, p.y + 8, p.w, p.h - 8);
    ctx.strokeStyle = 'rgba(220,180,255,.9)';
    ctx.lineWidth = 3;
    wave(p.x, p.y + 8, p.w, 2);
    ctx.stroke();
  }
}

function drawSpikes() {
  for (const sp of spikes) {
    ctx.fillStyle = '#c8ccd8';
    ctx.strokeStyle = '#8a8fa3';
    ctx.lineWidth = 1;
    const n = 4, sw = sp.w / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x0 = sp.x + i * sw;
      if (sp.dir === 1) {
        ctx.moveTo(x0, sp.y + sp.h);
        ctx.lineTo(x0 + sw / 2, sp.y);
        ctx.lineTo(x0 + sw, sp.y + sp.h);
      } else {
        ctx.moveTo(x0, sp.y);
        ctx.lineTo(x0 + sw / 2, sp.y + sp.h);
        ctx.lineTo(x0 + sw, sp.y);
      }
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

function drawFlames() {
  for (const f of flames) {
    const cyc = f.sync ? RHYTHM_CYCLE : 3, onDur = f.sync ? RHYTHM_ON : 1.2;
    const ph = f.sync ? (animT % cyc) : ((animT + f.t) % 3);
    const active = ph < onDur;
    const warn = f.sync && !active && ph > cyc - 0.4;   // 点燃前 0.4s 预警闪烁
    ctx.fillStyle = warn ? `rgba(255,140,60,${0.5 + 0.5 * Math.sin(animT * 40)})` : '#5a5f6e';
    roundRectPath(f.x - 10, f.up ? f.baseY - 6 : f.baseY, 20, 6, 2);
    ctx.fill();
    if (active) {
      const hgt = 88 * Math.min(1, ph / 0.15) * (ph > 1 ? (1.2 - ph) / 0.2 : 1);
      const grad = ctx.createLinearGradient(0, f.up ? f.baseY - hgt : f.baseY, 0, f.baseY);
      grad.addColorStop(0, 'rgba(255,240,120,.95)');
      grad.addColorStop(0.5, 'rgba(255,150,50,.9)');
      grad.addColorStop(1, 'rgba(255,80,30,.85)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      const wob = Math.sin(animT * 22 + f.x) * 3;
      const topY = f.up ? f.baseY - hgt : f.baseY + hgt;
      ctx.moveTo(f.x - 9, f.baseY);
      ctx.quadraticCurveTo(f.x - 6 + wob, (f.baseY + topY) / 2, f.x - 3 + wob, topY);
      ctx.quadraticCurveTo(f.x + wob * 0.5, topY + (f.up ? 8 : -8), f.x + 3 + wob, topY);
      ctx.quadraticCurveTo(f.x + 6 + wob, (f.baseY + topY) / 2, f.x + 9, f.baseY);
      ctx.closePath();
      ctx.fill();
    } else if (ph < 1.5) {
      ctx.fillStyle = `rgba(255,120,40,${0.4 + 0.4 * Math.sin(animT * 30)})`;
      ctx.beginPath(); ctx.arc(f.x, f.up ? f.baseY - 3 : f.baseY + 3, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawGravZones() {
  for (const z of gravZones) {
    ctx.fillStyle = `rgba(160,90,255,${0.12 + 0.05 * Math.sin(animT * 2 + z.x)})`;
    ctx.fillRect(z.x, z.y, z.w, z.h);
    ctx.fillStyle = 'rgba(210,170,255,.7)';
    for (let i = 0; i < 3; i++) {
      const py = z.y + z.h - ((animT * 30 + i * 40 + z.x) % z.h);
      ctx.beginPath(); ctx.arc(z.x + 8 + i * 12, py, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawPlats() {
  for (const pl of plats) {
    if (pl.axis === 'none') {
      // 悬空单向平台：金色云台，顶面发光提示"可落脚"
      ctx.fillStyle = '#a8863f';
      roundRectPath(pl.x, pl.y, pl.w, pl.h + 2, 4); ctx.fill();
      ctx.fillStyle = '#e6c266';
      roundRectPath(pl.x + 2, pl.y + 1, pl.w - 4, 4, 2); ctx.fill();
      const g = 0.5 + 0.5 * Math.sin(animT * 2.5 + pl.x * 0.05);
      ctx.fillStyle = `rgba(255,235,150,${0.35 + 0.45 * g})`;
      roundRectPath(pl.x + 4, pl.y, pl.w - 8, 2, 1); ctx.fill();
      continue;
    }
    if (pl.axis === 'lift') {
      // 平衡升降台：粉金台体 + 双人脚印 + 顶/底链条光
      ctx.fillStyle = '#7a4a5e';
      roundRectPath(pl.x, pl.y, pl.w, pl.h + 2, 4); ctx.fill();
      ctx.fillStyle = '#e08fb8';
      roundRectPath(pl.x + 2, pl.y + 1, pl.w - 4, 4, 2); ctx.fill();
      const glow = 0.5 + 0.5 * Math.sin(animT * 3);
      ctx.fillStyle = `rgba(255,225,150,${0.35 + 0.5 * glow})`;
      roundRectPath(pl.x + 4, pl.y, pl.w - 8, 2, 1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      for (const sx of [-6, 6]) {
        ctx.beginPath(); ctx.ellipse(pl.x + pl.w / 2 + sx, pl.y - 4, 2.6, 4, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = `rgba(224,143,184,${0.4 + 0.3 * glow})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(pl.x + pl.w / 2, pl.y + pl.h + 2); ctx.lineTo(pl.x + pl.w / 2, pl.oy + pl.h); ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = '#8a6f52';
    roundRectPath(pl.x, pl.y, pl.w, pl.h, 4); ctx.fill();
    ctx.fillStyle = '#c9a86f';
    roundRectPath(pl.x + 2, pl.y + 1, pl.w - 4, 4, 2); ctx.fill();
    ctx.fillStyle = `rgba(140,220,255,${0.5 + 0.5 * Math.sin(animT * 4)})`;
    ctx.beginPath(); ctx.arc(pl.x + pl.w / 2, pl.y + pl.h / 2, 2, 0, Math.PI * 2); ctx.fill();
  }
}

/* 心之桥：粉色爱心砖。通=实体发光，断=虚影提示 */
function drawBridges() {
  for (const br of bridges) {
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    if (bridgeOn) {
      ctx.save();
      ctx.shadowColor = '#ff6f9c';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,111,156,.9)';
      roundRectPath(br.x + 1, br.y + 1, br.w - 2, br.h - 2, 6); ctx.fill();
      ctx.restore();
      drawHeartShape(cx, cy - 2, 1.6 + 0.2 * Math.sin(animT * 5), 'rgba(255,255,255,.85)');
    } else {
      ctx.fillStyle = 'rgba(255,150,190,.16)';
      roundRectPath(br.x + 4, br.y + 4, br.w - 8, br.h - 8, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,170,200,.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      roundRectPath(br.x + 4, br.y + 4, br.w - 8, br.h - 8, 6); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/* 同心连压板：粉金双板 + 配对连线光束（点亮时） */
function drawLinkPlates() {
  for (const pr of jPairs) {
    for (const plate of [pr.a, pr.b]) {
      ctx.fillStyle = plate.lit ? '#b8860b' : '#6a5a72';
      roundRectPath(plate.x + 2, plate.y + plate.h - 12, plate.w - 4, 10, 3); ctx.fill();
      ctx.fillStyle = plate.lit ? '#ffd54a' : '#c9a0d8';
      roundRectPath(plate.x + 4, plate.y + plate.h - 12 - (plate.lit ? 4 : 0), plate.w - 8, 6, 3); ctx.fill();
      drawHeartShape(plate.x + plate.w / 2, plate.y + plate.h - 20, 1.2, plate.lit ? 'rgba(255,213,74,.95)' : 'rgba(255,255,255,.4)');
    }
    if (pr.door) {
      const g = 0.5 + 0.5 * Math.sin(animT * 4);
      ctx.strokeStyle = `rgba(255,213,74,${pr.a.lit ? 0.85 : 0.25 + 0.15 * g})`;
      ctx.lineWidth = pr.a.lit ? 3 : 1.5;
      ctx.setLineDash(pr.a.lit ? [] : [5, 5]);
      ctx.beginPath();
      ctx.moveTo(pr.a.x + pr.a.w / 2, pr.a.y + pr.a.h - 16);
      ctx.quadraticCurveTo((pr.a.x + pr.b.x) / 2 + TILE, Math.min(pr.a.y, pr.b.y) - 30, pr.b.x + pr.b.w / 2, pr.b.y + pr.b.h - 16);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/* 协作弹跳台：实心台阶 + 双人脚印 + 上升箭头（视觉引导）+ 蓄力进度 */
function drawPads() {
  for (const pad of pads) {
    const cx = pad.x + pad.w / 2, top = pad.y;
    // 台体
    ctx.fillStyle = '#6a5aa0';
    roundRectPath(pad.x + 1, pad.y + 1, pad.w - 2, pad.h - 2, 6); ctx.fill();
    ctx.fillStyle = '#8f7fd0';
    roundRectPath(pad.x + 1, pad.y + 1, pad.w - 2, 10, 6); ctx.fill();
    // 发光弹跳面
    const glow = 0.55 + 0.45 * Math.sin(animT * 3);
    ctx.fillStyle = `rgba(255,225,120,${glow})`;
    roundRectPath(pad.x + 4, pad.y + 2, pad.w - 8, 4, 2); ctx.fill();
    // 双人脚印（提示需两人同站）
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const sx of [-6, 6]) {
      ctx.beginPath(); ctx.ellipse(cx + sx, top + 20, 3.2, 5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // 上升箭头（提示弹跳方向）
    const bob = Math.sin(animT * 4) * 3;
    ctx.strokeStyle = `rgba(255,235,150,${0.7 + 0.3 * Math.sin(animT * 4)})`;
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 2; k++) {
      const ay = top - 10 - k * 9 + bob;
      ctx.beginPath();
      ctx.moveTo(cx - 6, ay + 5); ctx.lineTo(cx, ay); ctx.lineTo(cx + 6, ay + 5);
      ctx.stroke();
    }
    // 蓄力进度条（双人同站时充能）
    if (pad.charge > 0) {
      const r = Math.min(1, pad.charge / PAD_CHARGE);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      roundRectPath(cx - 14, top - 30, 28, 5, 2); ctx.fill();
      ctx.fillStyle = r >= 1 ? '#7ee08a' : '#ffd54a';
      roundRectPath(cx - 14, top - 30, 28 * r, 5, 2); ctx.fill();
    }
    // 弹射闪光
    if (pad.flash > 0) {
      ctx.fillStyle = `rgba(255,255,200,${pad.flash})`;
      ctx.beginPath(); ctx.arc(cx, top + 4, 18 * (0.6 - pad.flash) + 6, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawSlimes() {
  for (const s of slimes) {
    const squash = 1 - s.hop / 30;
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h);
    ctx.scale(2 - squash, squash);
    ctx.fillStyle = 'rgba(110,220,120,.92)';
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.quadraticCurveTo(-14, -22, 0, -22);
    ctx.quadraticCurveTo(14, -22, 14, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2d5a30';
    ctx.beginPath(); ctx.arc(-5, -13, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -13, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawBoss() {
  if (!boss) return;
  const b = boss;
  if (b.dead) {
    const t = Math.min(1, b.deathT / 1.2);
    if (t >= 1) return;
    ctx.globalAlpha = 1 - t;
  }
  const flash = b.hitFlash > 0;
  ctx.fillStyle = flash ? '#ffffff' : '#7ec8ff';
  roundRectPath(b.ice.x, b.ice.y, b.ice.w, b.ice.h, 14); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  roundRectPath(b.ice.x + 6, b.ice.y + 8, b.ice.w - 12, 20, 8); ctx.fill();
  ctx.fillStyle = flash ? '#ffffff' : '#ff9a5c';
  roundRectPath(b.fire.x, b.fire.y, b.fire.w, b.fire.h, 14); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  roundRectPath(b.fire.x + 6, b.fire.y + 8, b.fire.w - 12, 20, 8); ctx.fill();
  ctx.fillStyle = '#3a2a4a';
  ctx.beginPath(); ctx.arc(b.ice.x + 20, b.ice.y + 40, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(b.fire.x + 22, b.fire.y + 40, 5, 0, Math.PI * 2); ctx.fill();

  if (!b.dead) {
    const pulse = 0.6 + 0.4 * Math.sin(animT * 6);
    const iceC = { x: b.ice.x + b.ice.w / 2, y: b.baseY - 10 };
    const fireC = { x: b.fire.x + b.fire.w / 2, y: b.baseY - 10 };
    ctx.fillStyle = b.weak && b.weakSide === 'ice' ? `rgba(120,230,255,${pulse})` : 'rgba(120,230,255,.4)';
    ctx.beginPath(); ctx.arc(iceC.x, iceC.y, b.weak && b.weakSide === 'ice' ? 10 : 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = b.weak && b.weakSide === 'fire' ? `rgba(255,160,80,${pulse})` : 'rgba(255,160,80,.4)';
    ctx.beginPath(); ctx.arc(fireC.x, fireC.y, b.weak && b.weakSide === 'fire' ? 10 : 6, 0, Math.PI * 2); ctx.fill();
  }
  for (const pr of b.projectiles) {
    ctx.fillStyle = 'rgba(140,210,255,.95)';
    ctx.beginPath(); ctx.arc(pr.x + pr.w / 2, pr.y + pr.h / 2, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.arc(pr.x + pr.w / 2 - 3, pr.y + pr.h / 2 - 3, 4, 0, Math.PI * 2); ctx.fill();
  }
  for (const wv of b.waves) {
    ctx.fillStyle = 'rgba(255,130,60,.92)';
    ctx.beginPath();
    ctx.moveTo(wv.x, wv.y + wv.h);
    ctx.quadraticCurveTo(wv.x + wv.w / 2, wv.y - 8, wv.x + wv.w, wv.y + wv.h);
    ctx.closePath(); ctx.fill();
  }
  if (!b.dead) {
    const bw = 160, bx = b.x + b.w / 2 - bw / 2, by = b.y - 18;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    roundRectPath(bx - 2, by - 2, bw + 4, 10, 5); ctx.fill();
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, '#7ec8ff'); grad.addColorStop(1, '#ff9a5c');
    ctx.fillStyle = grad;
    roundRectPath(bx, by, bw * b.hp / b.maxHp, 6, 3); ctx.fill();
  }
  if (b.dead) ctx.globalAlpha = 1;
}

function drawButtons() {
  for (const b of buttons) {
    const x0 = b.x - b.w / 2;
    const y0 = b.pressed ? b.y + 4 : b.y;
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    roundRectPath(x0 - 3, b.y + b.h - 2, b.w + 6, 5, 2.5); ctx.fill();
    ctx.fillStyle = b.pressed ? '#5fd38a' : b.color;
    roundRectPath(x0, y0, b.w, b.h - (b.pressed ? 4 : 0), 4); ctx.fill();
    if (!b.pressed) {
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      roundRectPath(x0 + 3, y0 + 1.5, b.w - 6, 3, 1.5); ctx.fill();
    }
  }
}

function drawDoors() {
  for (const d of doors) {
    const w = TILE - 8, h = TILE;
    const x0 = d.x - w / 2, y0 = d.baseY - h;
    if (d.open) {
      ctx.save();
      ctx.shadowColor = d.color;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 4;
      roundRectPath(x0, y0, w, h, 8);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      roundRectPath(x0, y0, w, h, 8); ctx.fill();
    } else {
      ctx.fillStyle = d.color;
      roundRectPath(x0, y0, w, h, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      roundRectPath(x0 + 5, y0 + 6, w - 10, h - 12, 5); ctx.fill();
    }
  }
  for (const g of ghostDoors) {
    ctx.save();
    ctx.globalAlpha = 0.45 + 0.15 * Math.sin(animT * 2.5 + g.x);
    ctx.fillStyle = g.color;
    roundRectPath(g.x + 4, g.y + 2, g.w - 8, g.h - 4, 8); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 2;
    roundRectPath(g.x + 4, g.y + 2, g.w - 8, g.h - 4, 8); ctx.stroke();
  }
}

function drawGems() {
  for (const g of gems) {
    if (g.got) continue;
    const bob = Math.sin(animT * 2.5 + g.x * 0.05) * 3;
    const y = g.y + bob;
    if (g.star) {
      ctx.save();
      ctx.shadowColor = '#ffd54a';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ffd54a';
      ctx.translate(g.x, y);
      ctx.rotate(Math.sin(animT * 1.5) * 0.2);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * 10, Math.sin(a) * 10);
        ctx.lineTo(Math.cos(a2) * 4.5, Math.sin(a2) * 4.5);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
      continue;
    }
    if (g.owner === 0) {
      /* 🍰 小蛋糕（一二专属）：奶油胚 + 蓝莓霜 + 樱桃顶 */
      ctx.save();
      ctx.shadowColor = '#4a9eff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffe9c9';
      roundRectPath(g.x - 8, y - 1, 16, 10, 3); ctx.fill();
      ctx.fillStyle = '#7fc4ff';
      ctx.beginPath();
      ctx.arc(g.x - 5.2, y - 1, 3.2, Math.PI, 0);
      ctx.arc(g.x, y - 1.6, 3.8, Math.PI, 0);
      ctx.arc(g.x + 5.2, y - 1, 3.2, Math.PI, 0);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff5b7f';
      ctx.beginPath(); ctx.arc(g.x, y - 7, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      /* 🧋 奶茶（布布专属）：杯身 + 茶色液面 + 吸管 + 珍珠 */
      ctx.save();
      ctx.shadowColor = '#ff8a5c';
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.moveTo(g.x - 6.5, y - 9);
      ctx.lineTo(g.x + 6.5, y - 9);
      ctx.lineTo(g.x + 4.5, y + 9);
      ctx.lineTo(g.x - 4.5, y + 9);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#c9885a';
      ctx.beginPath();
      ctx.moveTo(g.x - 5.8, y - 4);
      ctx.lineTo(g.x + 5.8, y - 4);
      ctx.lineTo(g.x + 4.5, y + 9);
      ctx.lineTo(g.x - 4.5, y + 9);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4a2c17';
      for (const [px, py] of [[-2.2, 6], [1.8, 6.8], [-0.2, 3.6]]) {
        ctx.beginPath(); ctx.arc(g.x + px, y + py, 1.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = '#ff8a5c';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(g.x + 1, y - 3);
      ctx.lineTo(g.x + 6.5, y - 12);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawHearts() {
  for (const hc of hearts) {
    if (hc.got) continue;
    const bob = Math.sin(animT * 2.5 + hc.x * 0.05) * 3;
    const pulse = 1.5 + 0.25 * Math.sin(animT * 4);
    ctx.save();
    ctx.shadowColor = '#ff6f9c';
    ctx.shadowBlur = 14;
    drawHeartShape(hc.x, hc.y + bob, pulse, '#ff6f9c');
    ctx.restore();
    drawHeartShape(hc.x - 1.5, hc.y + bob - 1.5, pulse * 0.55, 'rgba(255,255,255,.65)');
  }
}

function drawBoxes() {
  for (const b of boxes) {
    ctx.fillStyle = '#d9a86c';
    roundRectPath(b.x, b.y, b.w, b.h, 5); ctx.fill();
    ctx.strokeStyle = '#a8763e';
    ctx.lineWidth = 2.5;
    roundRectPath(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, 4); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(b.x + 4, b.y + 4); ctx.lineTo(b.x + b.w - 4, b.y + b.h - 4);
    ctx.moveTo(b.x + b.w - 4, b.y + 4); ctx.lineTo(b.x + 4, b.y + b.h - 4);
    ctx.stroke();
  }
}

function drawExits() {
  if (!exits.length) return;
  const minX = Math.min(...exits.map(e => e.x)) - TILE / 2;
  const maxX = Math.max(...exits.map(e => e.x)) + TILE / 2;
  const baseY = exits[0].baseY;
  const w = maxX - minX, h = TILE + 4;
  const glow = 0.6 + 0.4 * Math.sin(animT * 3);
  ctx.save();
  ctx.shadowColor = 'rgba(255,210,90,.9)';
  ctx.shadowBlur = 16 * glow;
  ctx.strokeStyle = '#ffd54a';
  ctx.lineWidth = 5;
  roundRectPath(minX + 2, baseY - h, w - 4, h, 10);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,236,170,.35)';
  roundRectPath(minX + 2, baseY - h, w - 4, h, 10); ctx.fill();
  const cx = (minX + maxX) / 2;
  ctx.fillStyle = '#ffd54a';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('★', cx, baseY - h - 6 + Math.sin(animT * 2) * 2);
}

/* ================= 角色绘制 ================= */
function drawHeartShape(x, y, s, color) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.bezierCurveTo(-5, -1, -4, -5, 0, -2.5);
  ctx.bezierCurveTo(4, -5, 5, -1, 0, 3);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* 情侣外观（好感等级解锁）：头顶爱心印记 + 爱心护盾 + 牵手爱心 */
function drawLoveFx(p) {
  const lv = loveLevel();
  const cx = p.x + p.w / 2, headY = p.gflip ? p.y + 12 : p.y - 2;
  if (lv >= 2) {   // 热恋起：头顶爱心印记（无光环，按用户要求取消）
    const hb = 1 + 0.15 * Math.sin(animT * 4 + p.idx * 2);
    if (lv >= 6) {   // 白首之约：爱心印记伴环绕小星
      const sa = animT * 1.6 + p.idx * Math.PI;
      ctx.fillStyle = 'rgba(255,244,180,.95)';
      ctx.beginPath(); ctx.arc(cx + Math.cos(sa) * 13, headY - 22 + Math.sin(sa) * 4.5, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - Math.cos(sa) * 13, headY - 22 - Math.sin(sa) * 4.5, 1.4, 0, Math.PI * 2); ctx.fill();
    }
    if (lv >= 5) {   // 琴瑟和鸣：双色爱心（金+粉错位）；情深不渝：粉色那颗彩虹流转
      drawHeartShape(cx - 3, headY - 21, hb * 0.8, 'rgba(255,215,90,.9)');
      const pink = lv >= 7 ? `hsla(${(animT * 90 + p.idx * 120) % 360},90%,70%,.98)` : 'rgba(255,110,150,.95)';
      drawHeartShape(cx + 3, headY - 23, hb * 0.8, pink);
    } else {
      drawHeartShape(cx, headY - 22, hb, lv >= 4 ? 'rgba(255,215,120,.95)' : 'rgba(255,110,150,.95)');
    }
  }
}

function drawShieldAndHands() {
  if (!players.length) return;
  const a = players[0], b = players[1];
  // 爱心护盾：双人共享粉色泡泡
  if (shieldT > 0) {
    const mx = (a.x + b.x) / 2 + a.w / 2, my = (a.y + b.y) / 2 + a.h / 2;
    const r = 46 + Math.sin(animT * 6) * 3;
    const alpha = Math.min(0.5, shieldT);
    ctx.strokeStyle = `rgba(255,140,190,${alpha + 0.25})`;
    ctx.fillStyle = `rgba(255,170,210,${alpha * 0.35})`;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawHeartShape(mx, my - r + 4, 1.6, `rgba(255,120,170,${alpha + 0.3})`);
  }
  // 牵手：两人之间粉色爱心链
  if (handHolding) {
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const hx = ax + (bx - ax) * t, hy = ay + (by - ay) * t - Math.sin(animT * 5 + i) * 3;
      drawHeartShape(hx, hy, 0.9, 'rgba(255,150,190,.85)');
    }
  }
}

function drawPlayer(p) {
  const cx = p.x + p.w / 2;
  const feetY = p.y + p.h;

  ctx.fillStyle = 'rgba(60,40,20,.18)';
  ctx.beginPath();
  ctx.ellipse(cx, feetY + 3, 16, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const sp = sprites[p.idx];
  const img = p.mode === 'side' ? (sp.side || sp.front) : (sp.front || sp.side);

  if (img) {
    const iw = img.width, ih = img.height;
    const targetH = p.mode === 'side' ? 56 : 54;
    let dw = iw * (targetH / ih);
    const maxW = p.mode === 'side' ? 84 : 72;
    if (dw > maxW) dw = maxW;
    const dh = dw * ih / iw;

    let sx = 1;
    if (p.flipT != null) {
      const e = easeInOutCubic(Math.min(1, p.flipT));
      sx = Math.max(0.3, Math.abs(Math.cos(e * Math.PI)));
    }
    if (p.settleT != null) sx *= 1 + 0.08 * Math.sin(Math.PI * p.settleT);
    const mirror = (p.mode === 'side' && p.face > 0) ? -1 : 1;
    const bob = (p.onGround && Math.abs(p.vx) > WALK_MIN_VX) ? Math.abs(Math.sin(p.walkPhase)) * -2.5 : 0;

    ctx.save();
    // 重力反转时脚朝上：以身体框顶为锚点垂直翻转贴图
    ctx.translate(cx, (p.gflip ? p.y : feetY + bob));
    if (p.gflip) ctx.scale(1, -1);
    ctx.rotate(p.tilt);
    ctx.scale(mirror * sx, 1);
    const sl = (p.mode === 'side' && p.walkBlend > 0.02) ? sp.slices : null;
    if (sl) {
      // 迈步动画：身体(无脚)不动，前后脚绕脚踝反向摆动（相位相反、交替迈步），可叠加抬脚
      const k = dh / ih;                                   // 切片画布与整图同源，统一缩放
      const ph = Math.sin(p.walkPhase);
      const sw = ph * sl.swing * p.walkBlend;
      const lift = sl.lift * Math.max(0, ph) * p.walkBlend;   // 前摆相抬脚
      const slide = sl.slide * ph * p.walkBlend;              // 前后滑步（矮脚墩旋转不可见，靠位移显步态）
      const foot = (f, ang, lf, sx) => {
        const fw = f.cv.width * k, fh = f.cv.height * k;
        ctx.save();
        ctx.translate(-dw / 2 + f.ankle * k + sx, -dh + (f.top + 1) * k - lf);   // 锚点=脚踝（脚掌重心 x、切片顶边 y）
        ctx.rotate(ang);
        ctx.drawImage(f.cv, -(f.ankle - f.x0) * k, -1, fw, fh);
        ctx.restore();
      };
      foot(sl.back, -sw, lift * 0.4, slide);      // 后脚：前摆相向后
      ctx.drawImage(sl.body, -dw / 2, -dh, dw, dh);
      foot(sl.front, sw, lift, -slide);           // 前脚：前摆相向前
    } else {
      ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    }
    ctx.restore();
    drawLoveFx(p);
    return;
  }

  const OUT = '#4a2f23';
  const fill = p.idx === 0 ? '#ffffff' : '#d9a06b';
  const ear = p.idx === 0 ? '#4a2f23' : '#b57c4a';
  const blush = p.idx === 0 ? 'rgba(255,150,170,.85)' : 'rgba(255,190,110,.9)';
  ctx.save();
  ctx.translate(cx, feetY);
  ctx.rotate(p.tilt);
  const headR = 13, headY = -40;
  ctx.lineWidth = 2.2; ctx.strokeStyle = OUT; ctx.lineJoin = 'round';
  ctx.fillStyle = ear;
  ctx.beginPath(); ctx.arc(-headR + 3, headY - headR + 4, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(headR - 3, headY - headR + 4, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(0, headY, headR, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  roundRectPath(-11, -28, 22, 26, 9); ctx.fill(); ctx.stroke();
  const e = p.face > 0 ? 1.5 : -1.5;
  ctx.fillStyle = OUT;
  ctx.beginPath(); ctx.arc(e - 4.5, headY + 1, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(e + 4.5, headY + 1, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = blush;
  ctx.beginPath(); ctx.arc(-8.5, headY + 6, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(8.5, headY + 6, 3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  drawLoveFx(p);
}

/* ================= 渲染入口 ================= */
function render() {
  const theme = THEMES[curLevel] || THEMES[0];
  drawBackground(theme);
  ctx.save();
  ctx.translate(-camX, 0);   // 世界坐标 → 屏幕坐标（横版卷轴）
  drawGravZones();
  drawExits();
  drawPools();
  drawBridges();
  drawTiles(theme);
  drawSpikes();
  drawFlames();
  drawButtons();
  drawLinkPlates();
  drawDoors();
  drawPlats();
  drawPads();
  drawSlimes();
  drawBoss();
  drawGems();
  drawHearts();
  drawBoxes();
  for (const p of players) drawPlayer(p);
  drawShieldAndHands();
  ctx.restore();
  // 好感升级：全屏飘心特效（屏幕坐标；暂停时冻结）
  if (loveUpFx > 0) {
    if (!paused) loveUpFx -= STEP;
    const t = 1 - loveUpFx / 2.6;
    for (let i = 0; i < 12; i++) {
      const hx = LOGICAL_W / 2 + Math.sin(i * 2.6 + t * 6) * (40 + t * 140);
      const hy = LOGICAL_H - 30 - t * (LOGICAL_H - 40) * (0.6 + (i % 4) * 0.13);
      const a = Math.max(0, 1 - t * 1.1);
      drawHeartShape(hx, hy, 1.2 + (i % 3) * 0.5, `rgba(255,120,170,${a * 0.9})`);
    }
    ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.85 - t * 1.2)})`;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`💕 好感度升级 · ${LOVE_LEVELS[loveLevel()].name}！`, LOGICAL_W / 2, 60);
  }
  // 任务达成提示（屏幕坐标飘字；暂停时冻结）
  if (loveFxToast && loveFxToast.t > 0) {
    if (!paused) loveFxToast.t -= STEP;
    const a = Math.min(1, loveFxToast.t);
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(255,140,190,${a})`;
    ctx.strokeStyle = `rgba(40,10,30,${a * 0.8})`;
    ctx.lineWidth = 3;
    const ty = 92 - (3 - loveFxToast.t) * 8;
    ctx.strokeText(loveFxToast.txt, LOGICAL_W / 2, ty);
    ctx.fillText(loveFxToast.txt, LOGICAL_W / 2, ty);
    if (loveFxToast.t <= 0) loveFxToast = null;
  }
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

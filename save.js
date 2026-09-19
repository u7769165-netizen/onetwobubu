/* ================= save.js =================
   存档与情侣成长模块：由 game.js 拆出（系统性优化 Phase 3c）。
   localStorage 存档读写、好感度成长、爱情任务线、纪念册、
   特殊称号、章节可达性、胜利进度写入。
   加载顺序：levels.js → audio.js → ui.js → save.js → mechanics.js → render.js → game.js
   说明：save 为纯字面量初始化，本文件只须在其余共享全局作用域脚本之前完成加载；
   函数体引用的其余全局在运行时求值，与加载先后无关。
   ================================================================ */
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
let _saveWarned = false;   // 存档写入失败只提醒一次，不打扰玩家
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch (e) { if (!_saveWarned) { _saveWarned = true; console.warn('存档写入失败（可能超出存储配额）:', e); } }
}

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

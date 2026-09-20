/* ================= ui.js =================
   界面：DOM 引用与渲染、界面状态机 showScreen、选关/地图/恋爱空间/纪念册/合照界面、HUD、事件绑定
   由 index.html 模块化拆分而来（原单文件 >144KB）。加载顺序：
   levels.js → audio.js → ui.js → game.js（index.html 中的 script 标签顺序）
   跨文件引用说明：本文件顶层只声明、不在加载时调用其他模块的函数（启动逻辑统一在 game.js 末尾）。
   ================================================================ */
/* ================= DOM ================= */
const canvas = document.getElementById('game');
const wrap = document.getElementById('wrap');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const retryBtn = document.getElementById('retryBtn');
const gradeBox = document.getElementById('gradeBox');
const detailBox = document.getElementById('detailBox');
const titleScreen = document.getElementById('titleScreen');
const levelScreen = document.getElementById('levelScreen');
const settingsScreen = document.getElementById('settingsScreen');
const netScreen = document.getElementById('netScreen');
const lvGrid = document.getElementById('lvGrid');
const progressLine = document.getElementById('progressLine');
const continueBtn = document.getElementById('continueBtn');
const menuBtn = document.getElementById('menuBtn');
const homeBtn = document.getElementById('homeBtn');
const ctrls = document.querySelector('.ctrls');
const pauseMenu = document.getElementById('pauseMenu');
const netBar = document.getElementById('netBar');
const netDot = document.getElementById('netDot');
const netBarText = document.getElementById('netBarText');

/* ---- 恋爱空间界面：好感等级进度 + 任务列表 + 互动统计 ---- */
function buildLoveScreen() {
  const lv = loveLevel();
  const cur = LOVE_LEVELS[lv], next = LOVE_LEVELS[lv + 1] || null;
  document.getElementById('loveHead').textContent =
    `一二 ❤ 布布 · ${cur.name} Lv.${lv + 1}${next ? '' : '（满级）'}`;
  const bar = document.getElementById('loveBar');
  const barTxt = document.getElementById('loveBarTxt');
  if (next) {
    const pct = Math.min(100, Math.max(0, (save.love - cur.need) / (next.need - cur.need) * 100));
    bar.style.width = pct + '%';
    barTxt.textContent = `好感 ${save.love} / ${next.need}（${next.name}）`;
  } else {
    bar.style.width = '100%';
    barTxt.textContent = `好感 ${save.love} · ${cur.name} ❤`;
  }
  document.getElementById('lovePerk').textContent =
    `当前加成：${cur.perk}` + (next ? `　→　下一级：${next.name} · ${next.perk}` : '');
  const qs = document.getElementById('loveQs');
  qs.innerHTML = '';
  for (const f of LOVE_FAMILIES) {
    const doneT = save.loveTiers[f.id] || 0;
    const allDone = doneT >= f.tiers.length;
    const tier = f.tiers[Math.min(doneT, f.tiers.length - 1)];
    const now = Math.min(f.get(), tier.goal);
    const el = document.createElement('div');
    el.className = 'love-q' + (allDone ? ' done' : '');
    const dots = f.tiers.map((_, i) => `<span class="lq-dot${i < doneT ? ' on' : ''}"></span>`).join('');
    el.innerHTML =
      `<div><div class="lq-name">${allDone ? '✅ ' : f.icon + ' '}${f.name} <span class="lq-tier-n">第 ${Math.min(doneT + 1, f.tiers.length)}/${f.tiers.length} 阶</span> ${dots}</div>` +
      `<div class="lq-desc">累计 ${f.get()} ${f.unit} · 本阶目标 ${tier.goal} ${f.unit}</div></div>` +
      `<div style="text-align:right"><div class="lq-prog">${allDone ? '全部达成' : now + ' / ' + tier.goal}</div><div class="lq-rw">💕+${tier.reward}</div></div>`;
    qs.appendChild(el);
  }
  const st = save.loveStats || {};
  const ab = save.album;
  document.getElementById('loveStats').innerHTML =
    `💕 爱心水晶累计 ${st.hearts || 0} 颗 · 🤝 协作弹跳 ${st.joint || 0} 次 · ` +
    `🛡 爱心护盾 ${st.shield || 0} 次 · 👫 牵手奔跑 ${Math.floor(st.holding || 0)} 秒` +
    (ab ? `<br>📅 相识第 ${albumDays()} 天 · 🏅 称号「${loveTitleNow().name}」 · 纪念日 ${Object.keys(ab.anni || {}).length}/${LOVE_ANNIS.length}` : '');
}

/* ---- 纪念册界面渲染：总览 / 称号墙 / 纪念日 / 时光轴 ---- */
function buildAlbumScreen() {
  const ab = ensureAlbum();
  const st = save.loveStats || {};
  const days = ab.days.length;
  document.getElementById('albumTip').textContent =
    `记录一二 & 布布共同走过的每一天 · 首次相遇 ${ab.first}`;
  const got = loveTitlesGot();
  document.getElementById('albumOverview').innerHTML =
    `<div class="album-overview-grid">
      <div class="ao-cell"><div class="ao-num">${albumDays()}</div><div class="ao-lab">相识天数</div></div>
      <div class="ao-cell"><div class="ao-num">${days}</div><div class="ao-lab">陪伴日数</div></div>
      <div class="ao-cell"><div class="ao-num">${fmtDur(ab.playSec)}</div><div class="ao-lab">共同游玩</div></div>
      <div class="ao-cell"><div class="ao-num">${st.hearts || 0}</div><div class="ao-lab">爱心水晶</div></div>
      <div class="ao-cell"><div class="ao-num">${st.joint || 0}</div><div class="ao-lab">协作弹跳</div></div>
      <div class="ao-cell"><div class="ao-num">${st.shield || 0}</div><div class="ao-lab">爱心护盾</div></div>
      <div class="ao-cell"><div class="ao-num">${Math.floor(st.holding || 0)}s</div><div class="ao-lab">牵手奔跑</div></div>
      <div class="ao-cell"><div class="ao-num">${(save.photos || []).length}/${PHOTOS.length}</div><div class="ao-lab">合照回忆</div></div>
      <div class="ao-cell"><div class="ao-num">${totalSubsDone()}/${LEVELS.length}</div><div class="ao-lab">通过层数</div></div>
    </div>
    <div class="album-title-now">当前称号 <b>🏅 ${loveTitleNow().name}</b> · 已获 ${got.length}/${LOVE_TITLES.length} 个称号 · 连续陪伴 ${ab.daily.streak || 0} 天</div>`;
  const tg = document.getElementById('titleGrid');
  tg.innerHTML = '';
  for (const t of LOVE_TITLES) {
    const has = t.cond();
    const el = document.createElement('div');
    el.className = 't-cell' + (has ? '' : ' locked');
    el.innerHTML = `<div class="t-name">${has ? '' : '🔒 '}${t.name}</div><div class="t-desc">${t.desc}</div>`;
    tg.appendChild(el);
  }
  const ar = document.getElementById('anniRow');
  ar.innerHTML = '';
  for (const a of LOVE_ANNIS) {
    const gotAn = !!ab.anni[a.day];
    const el = document.createElement('div');
    el.className = 'an-cell' + (gotAn ? ' got' : '');
    el.innerHTML = `<div class="an-name">${gotAn ? '🎊 ' : '⭕ '}${a.name}</div><div class="an-day">相识第 ${a.day} 天 · 💕+${a.reward}</div>`;
    ar.appendChild(el);
  }
  const ml = document.getElementById('momentList');
  ml.innerHTML = '';
  ab.moments.slice().reverse().forEach(m => {
    const el = document.createElement('div');
    el.className = 'mo-item';
    el.innerHTML = `<span class="mo-date">${m.d}</span><span class="mo-txt">${m.t}</span>`;
    ml.appendChild(el);
  });
}

/* ================= 合照收藏界面 ================= */
function photoUnlocked(i) { return save.photos.includes(i); }
function buildPhotoScreen() {
  const grid = document.getElementById('phGrid');
  grid.innerHTML = '';
  const n = save.photos.length;
  document.getElementById('photoTip').textContent =
    `已收集 ${n} / ${PHOTOS.length} 张合照 · 通过主关卡解锁对应回忆 · 点击已解锁合照查看大图`;
  PHOTOS.forEach((ph, i) => {
    const cell = document.createElement('div');
    const unlocked = photoUnlocked(i);
    cell.className = 'ph-cell' + (unlocked ? '' : ' locked');
    if (unlocked) {
      const thumb = document.createElement('div');
      thumb.className = 'ph-thumb';
      const img = new Image();
      img.loading = 'lazy'; img.alt = ph.name; img.src = ph.src;
      img.onerror = () => { cell.classList.add('broken'); cell.innerHTML = '🖼 图片缺失'; };
      thumb.appendChild(img);
      const badge = document.createElement('span');
      badge.className = 'ph-badge';
      badge.textContent = i < MAJOR_COUNT ? `${i + 1}号` : '彩蛋';
      thumb.appendChild(badge);
      cell.appendChild(thumb);
      const cap = document.createElement('div');
      cap.className = 'ph-name'; cap.textContent = ph.name;
      cell.appendChild(cap);
      cell.addEventListener('click', () => openPhotoView(i));
    } else {
      const lock = document.createElement('div');
      lock.className = 'ph-lock';
      lock.innerHTML = `🔒<small>${i < MAJOR_COUNT ? `通关「${MAJORS[i].name}」解锁` : '通关全部关卡解锁'}</small>`;
      cell.appendChild(lock);
    }
    grid.appendChild(cell);
  });
}
/* 大图预览：点击空白关闭、←→切换、Esc 关闭 */
let pvIdx = -1;
function openPhotoView(i) {
  pvIdx = i;
  const ph = PHOTOS[i];
  const img = document.getElementById('pvImg');
  img.onerror = () => { img.removeAttribute('src'); };
  img.src = ph.src;
  document.getElementById('pvCap').textContent = `${i + 1} / ${PHOTOS.length} · ${ph.name}`;
  document.getElementById('photoView').classList.remove('hidden');
}
function closePhotoView() { pvIdx = -1; document.getElementById('photoView').classList.add('hidden'); }
/* 通关瞬间合照弹出 */
let pendingSubAdvance = false;   // 非末层：合照收起后才继续进下一层
let prTimer = null;              // 非末层合照弹出兜底：超时自动收起，防止流程卡死
function openPhotoReveal(i) {
  const ph = PHOTOS[i];
  document.getElementById('prCap').textContent = `「${ph.name}」 ${i + 1} / ${PHOTOS.length}`;
  document.getElementById('prImg').src = ph.src;
  document.getElementById('photoReveal').classList.remove('hidden');
  sfxLoveUp();
  if (prTimer) clearTimeout(prTimer);
  prTimer = setTimeout(() => { prTimer = null; if (pendingSubAdvance) closePhotoReveal(); }, 8000);
}
function closePhotoReveal() {
  if (prTimer) { clearTimeout(prTimer); prTimer = null; }
  document.getElementById('photoReveal').classList.add('hidden');
  if (pendingSubAdvance) {
    pendingSubAdvance = false;
    if (subTransTimer) clearTimeout(subTransTimer);
    subTransTimer = setTimeout(() => { subTransTimer = null; if (screenMode === 'play' && won) advanceAfterWin(); }, 900);
  }
}
function pvStep(d) {
  if (pvIdx < 0) return;
  // 只在已解锁合照间切换
  for (let k = 1; k <= PHOTOS.length; k++) {
    const j = (pvIdx + d * k + PHOTOS.length * k) % PHOTOS.length;
    if (photoUnlocked(j)) { openPhotoView(j); return; }
  }
}

/* ================= 界面状态机 ================= */
let screenMode = 'title'; // title | levels | settings | play
function showScreen(name) {
  screenMode = name;
  titleScreen.classList.toggle('hidden', name !== 'title');
  levelScreen.classList.toggle('hidden', name !== 'levels');
  settingsScreen.classList.toggle('hidden', name !== 'settings');
  netScreen.classList.toggle('hidden', name !== 'net');
  document.getElementById('authScreen').classList.toggle('hidden', name !== 'auth');
  document.getElementById('subPick').classList.toggle('hidden', name !== 'subpick');
  document.getElementById('mapScreen').classList.toggle('hidden', name !== 'map');
  document.getElementById('helpScreen').classList.toggle('hidden', name !== 'help');
  document.getElementById('loveScreen').classList.toggle('hidden', name !== 'love');
  document.getElementById('photoScreen').classList.toggle('hidden', name !== 'photos');
  document.getElementById('albumScreen').classList.toggle('hidden', name !== 'album');
  closePhotoView();
  if (name !== 'play') { running = false; overlay.classList.add('hidden'); paused = false; wasRunningBeforePause = false; pauseMenu.classList.add('hidden'); }
  ctrls.classList.toggle('hidden', name !== 'play');
  document.getElementById('touchLayer').classList.toggle('hidden', !(touchPadVisible && name === 'play'));
  if (name === 'play') releaseAllTouch();
  netBar.classList.toggle('show', net.mode === 'online' && name === 'play');
  if (name === 'title') { dailyLoveCheck(); updateTitleUI(); }
  if (name === 'levels') buildLevelCards();
  if (name === 'subpick') buildSubPick();
  if (name === 'map') buildMap();
  if (name === 'love') { checkLoveQuests(); buildLoveScreen(); }
  if (name === 'album') buildAlbumScreen();
  if (name === 'photos') buildPhotoScreen();
  updateMusic();
  if (name === 'net') {
    netRoomShow.textContent = net.role === 'host' ? net.room : '';
    netStatus(net.connected ? (net.peerOnline ? '队友在线' : '已连接，等待队友…') : '未连接');
  }
}

function updateTitleUI() {
  const totalStars = STARS_PER_LEVEL.reduce((a, b) => a + b, 0);
  const gotStars = STARS_PER_LEVEL.reduce((a, n, i) => a + (save.stars[i] || 0), 0);
  const done = totalSubsDone();
  const unlockedMajors = MAJORS.filter(m => m.first <= save.unlocked).length;
  const tn = save.album ? loveTitleNow() : null;
  progressLine.textContent =
    `已解锁 ${unlockedMajors}/${MAJOR_COUNT} 关 · 已通过 ${done}/${LEVELS.length} 层 · ` +
    `⭐ ${gotStars + (save.bonusStars || 0)}/${totalStars + LEVELS.length} · 📷 ${(save.photos || []).length}/${PHOTOS.length}` +
    (tn ? ` · 🏅 ${tn.name}` : '');
  continueBtn.style.display = save.unlocked > 0 ? '' : 'none';
  // 每日陪伴 / 纪念日飘带（标题界面提示）
  const bn = document.getElementById('albumBanner');
  if (albumBanner && albumBanner.t > 0 && screenMode === 'title') {
    bn.innerHTML = albumBanner.html;
    bn.style.opacity = '1';
    bn.classList.remove('hidden');
  } else {
    bn.classList.add('hidden');
  }
}

function startLevel(i) {
  showScreen('play');
  loadLevel(i, false);
}

/* ================= 关卡缩略图 ================= */
function drawThumb(cv, idx) {
  const c = cv.getContext('2d');
  const theme = THEMES[idx];
  const rows = LEVELS[idx];
  const colsN = Math.max(...rows.map(r => r.length));
  const s = Math.min(cv.width / (colsN * TILE), cv.height / (rows.length * TILE));
  const ox = (cv.width - colsN * TILE * s) / 2, oy = (cv.height - rows.length * TILE * s) / 2;
  const g = c.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, theme.sky[0]); g.addColorStop(1, theme.sky[1]);
  c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
  const colors = {
    '#': theme.ground, 'W': '#4a9eff', 'L': '#ff6b35', 'T': '#9a5ae0', '~': '#d8ecf8',
    'D': '#4a9eff', 'E': '#ff7fa8', 'd': 'rgba(74,158,255,.55)', 'e': 'rgba(255,127,168,.55)',
    '1': '#4a9eff', '2': '#ff7fa8', 'C': '#d9a86c', 'X': '#ffd54a',
    '^': '#c8ccd4', 'v': '#c8ccd4', 'f': '#ff8a3c', 'F': '#ff8a3c',
    's': '#6fd06f', 'g': 'rgba(165,95,225,.5)', 'm': '#b98cff', 'M': '#b98cff',
    'G': '#ff5a7a', 'H': '#8f7fd0', '=': '#e6c266', 'P': '#ffffff', 'B': '#d9a06b',
    'J': '#c9a0d8', 'b': 'rgba(255,111,156,.7)', 'z': '#e08fb8', 'r': '#ff8a3c', 'K': '#ffd54a',
  };
  const dot = { 'w': '#4a9eff', 'l': '#ff8a5c', '*': '#ffd54a', 'h': '#ff6f9c' };
  for (let r = 0; r < rows.length; r++) {
    for (let cc = 0; cc < rows[r].length; cc++) {
      const ch = rows[r][cc];
      if (ch === '.' || ch === ' ') continue;
      const x = ox + cc * TILE * s, y = oy + r * TILE * s;
      if (dot[ch]) {
        c.fillStyle = dot[ch];
        c.beginPath(); c.arc(x + TILE * s / 2, y + TILE * s / 2, TILE * s * 0.28, 0, Math.PI * 2); c.fill();
        continue;
      }
      c.fillStyle = colors[ch] || '#888';
      c.fillRect(x, y, TILE * s + 0.5, TILE * s + 0.5);
      if (ch === '#') { c.fillStyle = theme.grass; c.fillRect(x, y, TILE * s + 0.5, TILE * s * 0.28); }
    }
  }
}

/* ================= 选关卡片（主关卡粒度） ================= */
function buildLevelCards() {
  lvGrid.innerHTML = '';
  MAJORS.forEach((m, mi) => {
    const preLocked = m.first > save.unlocked;
    const loveLock = !preLocked && m.loveNeed && save.love < m.loveNeed;   // 心之试炼：好感门票未达
    const locked = preLocked || loveLock;
    const clearedCnt = m.subs.filter((_, s) => subDone(mi, s)).length;
    const allDone = clearedCnt === m.subs.length;
    const card = document.createElement('div');
    card.className = 'lv-card' + (locked ? ' locked' : '') + (loveLock ? ' love-lock' : '');

    const cv = document.createElement('canvas');
    cv.width = 336; cv.height = 210;
    drawThumb(cv, m.first);
    card.appendChild(cv);

    if (loveLock) {
      const lock = document.createElement('div');
      lock.className = 'lock'; lock.textContent = '💕';
      card.appendChild(lock);
    } else if (locked) {
      const lock = document.createElement('div');
      lock.className = 'lock'; lock.textContent = '🔒';
      card.appendChild(lock);
    } else if (allDone) {
      const best = document.createElement('div');
      const g = majorBest(mi);
      best.className = 'best ' + (g || 'c').toLowerCase();
      best.textContent = g || '✓';
      card.appendChild(best);
    } else {
      const prog = document.createElement('div');
      prog.className = 'best b';
      prog.textContent = clearedCnt + '/' + m.subs.length;
      card.appendChild(prog);
    }

    const info = document.createElement('div');
    info.className = 'info';
    const dots = m.subs.map((_, s) =>
      `<span class="sdot${subDone(mi, s) ? ' ok' : locked ? '' : ' reach'}"></span>`).join('');
    info.innerHTML =
      `<div class="num">第 ${mi + 1} 关${m.subs.length > 1 ? ' · ' + m.subs.length + ' 层' : ''}${m.boss ? ' · BOSS' : ''}</div>` +
      `<div class="name">${m.name}</div>` +
      `<div class="diff">${'★'.repeat(m.diff)}${'☆'.repeat(5 - m.diff)}</div>` +
      (loveLock ? `<div class="love-lock-hint">💕 需好感 ${m.loveNeed}（当前 ${save.love}）</div>` : '') +
      (m.subs.length > 1 ? `<div class="subs-dots">${dots}</div>` : '');
    card.appendChild(info);

    if (!locked) card.addEventListener('click', e => {
      e.stopPropagation();
      if (m.subs.length === 1) startLevel(m.first);
      else openSubPick(mi);
    });
    lvGrid.appendChild(card);
  });
}

/* ================= 子层级选择（多层级主关卡） ================= */
let subPickMajor = 0;
function openSubPick(mi) { subPickMajor = mi; showScreen('subpick'); }
function buildSubPick() {
  const m = MAJORS[subPickMajor];
  document.getElementById('spTitle').textContent = `${m.name} · ${m.subs.length} 个层级`;
  const list = document.getElementById('spList');
  list.innerHTML = '';
  m.subs.forEach((name, s) => {
    const flat = m.first + s;
    const locked = flat > save.unlocked;
    const done = subDone(subPickMajor, s);
    const btn = document.createElement('div');
    btn.className = 'sp-btn' + (locked ? ' locked' : '');
    const state = locked ? '🔒 未解锁'
      : done ? `<span class="sp-state ok">已通过${save.best[flat] ? ' · ' + save.best[flat] : ''} ↻</span>`
      : `<span class="sp-state next">▶ 挑战本层</span>`;
    btn.innerHTML =
      `<span class="sp-idx">层级 ${s + 1}</span>` +
      `<span>${name}${LEVEL_LIMIT[flat] ? ` · ⏳限时 ${LEVEL_LIMIT[flat]}s` : ''}</span>${state}`;
    if (!locked) btn.addEventListener('click', () => startLevel(flat));
    list.appendChild(btn);
  });
}

/* ================= 层级地图导航 ================= */
function buildMap() {
  const totalStars = STARS_PER_LEVEL.reduce((a, b) => a + b, 0);
  const gotStars = STARS_PER_LEVEL.reduce((a, n, i) => a + (save.stars[i] || 0), 0);
  document.getElementById('mapSummary').textContent =
    `总进度 ${totalSubsDone()}/${LEVELS.length} 层 · ` +
    `⭐ ${gotStars + (save.bonusStars || 0)}/${totalStars + LEVELS.length}`;
  const list = document.getElementById('mapList');
  list.innerHTML = '';
  const curMajor = majorOf(Math.min(save.unlocked, LEVELS.length - 1));
  MAJORS.forEach((m, mi) => {
    const preLocked = m.first > save.unlocked;
    const loveLock = !preLocked && m.loveNeed && save.love < m.loveNeed;
    const locked = preLocked || loveLock;
    const row = document.createElement('div');
    row.className = 'map-row' + (locked ? ' locked' : '') + (mi === curMajor && !locked ? ' cur' : '');
    const subsHtml = m.subs.map((_, s) => {
      const flat = m.first + s;
      const cls = subDone(mi, s) ? 'done' : (flat <= save.unlocked ? 'reach' : '') + (mi === curMajor && flat === Math.min(save.unlocked, LEVELS.length - 1) ? ' here' : '');
      return `<i class="${cls}" title="层级 ${s + 1} ${m.subs[s]}"></i>`;
    }).join('');
    const bestG = majorBest(mi);
    row.innerHTML =
      `<span class="m-num">${String(mi + 1).padStart(2, '0')}</span>` +
      `<span class="m-name">${m.name}${loveLock ? ` <i class="love-lock-hint">💕${m.loveNeed}</i>` : ''}</span>` +
      `<span class="m-diff">${'★'.repeat(m.diff)}</span>` +
      `<span class="m-subs">${subsHtml}</span>` +
      `<span class="m-best">${bestG || ''}</span>`;
    if (!locked) row.addEventListener('click', () => {
      if (m.subs.length === 1) startLevel(m.first); else openSubPick(mi);
    });
    list.appendChild(row);
  });
}

/* ---- 高清渲染：2x 后备画布，解决角色清晰度低 ---- */
const DPR = 2;
const LOGICAL_W = 640, LOGICAL_H = 400;
canvas.width = LOGICAL_W * DPR;
canvas.height = LOGICAL_H * DPR;
const ctx = canvas.getContext('2d');
ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';

function showOverlay(title, sub, grade, detail) {
  overlay.querySelector('.title').textContent = title;
  overlay.querySelector('.sub').textContent = sub || '';
  gradeBox.textContent = grade || '';
  gradeBox.style.color = grade === 'S' ? '#ffd54a' : grade === 'A' ? '#7ee08a' : grade === 'B' ? '#8ec8ff' : '#fff';
  detailBox.innerHTML = detail || '';
  overlay.classList.remove('hidden');
}
function hideOverlay() { overlay.classList.add('hidden'); }

let _hudLast = '';   // 上一次写入的 HUD 文本：60Hz 调用中绝大多数帧内容不变，跳过相同赋值避免冗余 DOM 写
function updateHUD() {
  const water = gems.filter(g => g.owner === 0);
  const fire = gems.filter(g => g.owner === 1);
  const gw = water.filter(g => g.got).length;
  const gf = fire.filter(g => g.got).length;
  const bossHp = boss && !boss.dead ? ` · BOSS ❤️${boss.hp}/${boss.maxHp}` : '';
  const mi = majorOf(curLevel), si = subOf(curLevel);
  const lvTxt = MAJORS[mi].subs.length > 1 ? `第 ${mi + 1} 关·层${si + 1}/${MAJORS[mi].subs.length}` : `第 ${mi + 1}/${MAJOR_COUNT} 关`;
  let timeTxt = '';
  const lim = LEVEL_LIMIT[curLevel];
  if (lim) {
    const left = Math.max(0, lim - levelTime);
    timeTxt = left <= 10 ? ` · ⚠️⏳${left.toFixed(0)}s` : ` · ⏳${left.toFixed(0)}s`;
  }
  const heartsTxt = hearts.length ? ` · 💕${hearts.filter(h => h.got).length}/${hearts.length}` : '';
  const shieldTxt = shieldT > 0 ? ` · 🛡护盾${shieldT.toFixed(1)}s` : '';
  const txt = `${lvTxt} · ${LEVEL_NAMES[curLevel]} · 🍰${gw}/${water.length} · 🧋${gf}/${fire.length} · ⭐${starsGot}/${starsTotal}${heartsTxt}${timeTxt}${bossHp}${shieldTxt}`;
  if (txt !== _hudLast) { _hudLast = txt; hud.textContent = txt; }
}


/* ================= mechanics.js =================
   物理与机关模块：由 game.js 拆出（系统性优化 Phase 3b）。
   协作技能、碰撞与角色步进、移动平台、心之桥/升降台/连压板、弹跳台、
   木箱、史莱姆、Boss、危险检测、按钮门、收集与过关、评分、动画、相机。
   加载顺序：levels.js → audio.js → ui.js → mechanics.js → render.js → game.js
   说明：本文件函数体引用的其余全局（players、keys、save、STEP 等）在运行时求值，
   与脚本加载先后无关，只须在 game.js 末尾启动段执行前完成加载。
   ================================================================ */
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
  const mapW = cols * TILE;
  if (mapW <= LOGICAL_W) return (mapW - LOGICAL_W) / 2;   // 地图窄于视口：居中（负 camX），两侧露天空（当前 48 列关卡用不到，防御未来小关卡）
  const maxCam = Math.max(0, mapW - LOGICAL_W);
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

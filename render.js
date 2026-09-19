/* ================= render.js =================
   渲染模块：由 game.js 拆出（系统性优化 Phase 3a）。
   画布绘制全部函数（逻辑坐标 640×400，2x 后备画布高清）。
   加载顺序：levels.js → audio.js → ui.js → render.js → game.js
   说明：本文件函数体引用的其余全局（ctx、players、save 等）在运行时求值，
   与脚本加载先后无关，只须在 game.js 末尾启动段执行前完成加载。
   ================================================================ */
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

/* 液面波纹路径（animT 驱动的正弦波） */
function poolWave(x, y, w, amp) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i <= w; i += 4) {
    ctx.lineTo(x + i, y + Math.sin(animT * 3 + (x + i) * 0.09) * amp);
  }
}

/* 一类液池的统一绘制：水体填充 + 波纹描边；岩浆额外带上升气泡 */
function drawPool(list, fill, stroke, bubbles) {
  for (const p of list) {
    ctx.fillStyle = fill;
    ctx.fillRect(p.x, p.y + 8, p.w, p.h - 8);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    poolWave(p.x, p.y + 8, p.w, 2);
    ctx.stroke();
    if (bubbles) {
      ctx.fillStyle = 'rgba(255,220,150,.8)';
      const bx = p.x + ((animT * 30 + p.x) % p.w);
      ctx.beginPath(); ctx.arc(bx, p.y + p.h - 10, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawPools() {
  drawPool(waters, 'rgba(96,170,255,.8)', 'rgba(210,238,255,.95)', false);
  drawPool(lavas, 'rgba(255,120,50,.88)', 'rgba(255,210,120,.95)', true);
  drawPool(toxins, 'rgba(150,90,220,.8)', 'rgba(220,180,255,.9)', false);
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

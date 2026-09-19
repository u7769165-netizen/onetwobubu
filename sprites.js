/* ================= sprites.js =================
   角色贴图模块：由 game.js 拆出（系统性优化 Phase 3d）。
   贴图加载、边缘洪水抠图、连通域清理、内容裁剪、皮肤切换与侧面切脚。
   加载顺序：levels.js → audio.js → ui.js → save.js → sprites.js → mechanics.js → render.js → game.js
   说明：顶层 SIDE_SRC/SKIN_NAMES/SKIN_SLICE/sprites 均为纯字面量初始化；
   函数体引用的其余全局（WALK_SWING 等）在运行时求值，与加载先后无关。
   ================================================================ */
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

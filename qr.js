/* ================= qr.js =================
   零依赖 QR Code 编码器（Version 1-10 · 纠错等级 M · UTF-8 Byte 模式）。
   供 qr.html「扫码即玩」页面使用：把游戏地址（location.origin 或 ?u= 覆盖）
   编码为 SVG 二维码。纯函数实现，无 DOM 依赖段可被 tests/unit_qr.js 在
   vm 沙箱中直接加载做性质断言。
   参考规范：ISO/IEC 18004（QR Code symbol specification）。
   ================================================================ */

/* ---------- GF(256) 域运算（本原多项式 0x11D） ---------- */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) { return (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0; }

/* 生成多项式 (x-α^0)(x-α^1)...(x-α^(n-1))，系数降幂排列，首项 1 */
function genPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const g2 = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { g2[j] ^= g[j]; g2[j + 1] ^= gfMul(g[j], GF_EXP[i]); }
    g = g2;
  }
  return g;
}

/* RS 编码：对 data 求 (data·x^ecLen) mod genPoly(ecLen) 的余式（即纠错码字） */
function rsRem(data, ecLen) {
  const gen = genPoly(ecLen);
  const rem = data.slice().concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const c = rem[i];
    if (c) for (let j = 0; j < gen.length; j++) rem[i + j] ^= gfMul(gen[j], c);
  }
  return rem.slice(data.length);
}

/* ---------- EC-M 分块表：version → [[块数, 数据码字/块, 纠错码字/块], ...] ----------
   （与 ISO/IEC 18004 Table 13-22 的 M 行一致，各版本 数据+纠错 总数自洽） */
const RS_BLOCKS = {
  1: [[1, 16, 10]], 2: [[1, 28, 16]], 3: [[1, 44, 26]], 4: [[2, 32, 18]], 5: [[2, 43, 24]],
  6: [[4, 27, 16]], 7: [[4, 31, 18]], 8: [[2, 38, 22], [2, 39, 22]],
  9: [[3, 36, 22], [2, 37, 22]], 10: [[4, 43, 26], [1, 44, 26]],
};
/* Byte 模式容量（字节，M 级）：由分块表扣除模式/计数字段推得，与 ISO 容量表一致 */
const CAP_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
/* 定位图形（alignment pattern）中心坐标表 V2-10 */
const ALIGN_POS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/* ---------- 数据位流：模式 0100 + 字符计数 + 字节 + 终止符 + 填充码字 ---------- */
function buildDataBits(bytes, ver) {
  const groups = RS_BLOCKS[ver];
  const totalData = groups.reduce((s, g) => s + g[0] * g[1], 0);
  const capBits = totalData * 8;
  const ccBits = ver <= 9 ? 8 : 16;
  if (bytes.length > CAP_M[ver]) throw new Error('QR: 数据超出 Version ' + ver + '-M 容量');
  const bits = [];
  const push = (n, val) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(4, 4);                       // Byte 模式指示符 0100
  push(ccBits, bytes.length);       // 字符计数
  for (let i = 0; i < bytes.length; i++) push(8, bytes[i]);
  push(Math.min(4, capBits - bits.length), 0);   // 终止符（不足 4 位则截短）
  while (bits.length % 8) bits.push(0);          // 补齐到字节边界
  for (let pad = 0xEC; bits.length < capBits; pad = pad === 0xEC ? 0x11 : 0xEC) push(8, pad);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  return cw;
}

/* ---------- RS 分块 + 码字交织（数据按块轮询、纠错按块轮询） ---------- */
function interleaveBlocks(dataCw, ver) {
  const groups = RS_BLOCKS[ver];
  const blocks = [];
  let off = 0;
  for (const [num, dLen, eLen] of groups) {
    for (let i = 0; i < num; i++) {
      const data = dataCw.slice(off, off + dLen); off += dLen;
      blocks.push({ data, ec: rsRem(data, eLen) });
    }
  }
  const out = [];
  const maxData = Math.max.apply(null, blocks.map(b => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  const maxEc = Math.max.apply(null, blocks.map(b => b.ec.length));
  for (let i = 0; i < maxEc; i++) for (const b of blocks) if (i < b.ec.length) out.push(b.ec[i]);
  return out;
}

/* ---------- 功能图形绘制（fn 标记函数/保留模块，mods 存值） ---------- */
function setMod(mods, fn, size, r, c, v) {
  if (r < 0 || c < 0 || r >= size || c >= size) return;
  mods[r * size + c] = v; fn[r * size + c] = 1;
}
function drawFinder(mods, fn, size, r0, c0) {
  for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
    const r = r0 + dr, c = c0 + dc;
    if (r < 0 || c < 0 || r >= size || c >= size) continue;
    const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));   // 以 7×7 中心 (3,3) 的切比雪夫距离
    setMod(mods, fn, size, r, c, d === 4 || d === 2 ? 0 : 1); // 外圈分隔符/环 0，其余 1
  }
}
function drawAlign(mods, fn, size, r0, c0) {
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const d = Math.max(Math.abs(dr), Math.abs(dc));
    setMod(mods, fn, size, r0 + dr, c0 + dc, d === 1 ? 0 : 1);
  }
}
/* 格式信息 15 位：5 数据位(等级 M=00 + 掩码) BCH(15,5) 补 10 校验位，XOR 0x5412 */
function formatBits(mask) {
  const d = (0b00 << 3) | mask;
  let rem = d << 10;
  for (let i = 4; i >= 0; i--) if (rem & (1 << (i + 10))) rem ^= 0x537 << i;
  return ((d << 10) | rem) ^ 0x5412;
}
function drawFormat(mods, size, mask) {
  const b = formatBits(mask);
  const bit = i => (b >> i) & 1;
  // 左上区（f0→(8,0) … f14→(0,8)，跳过第 6 行/列定时位）
  const tl = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let i = 0; i < 15; i++) { const [r, c] = tl[i]; mods[r * size + c] = bit(i); }
  // 第二副本：左下竖段 f0-7 + 右上横段 f8-14
  for (let i = 0; i < 8; i++) mods[(size - 1 - i) * size + 8] = bit(i);
  for (let i = 8; i < 15; i++) mods[8 * size + (size - 15 + i)] = bit(i);
  mods[(size - 8) * size + 8] = 1;   // 固定暗模块
}
/* 版本信息 18 位（V7+）：ver<<12 + BCH(18,6) 校验 */
function versionBits(ver) {
  let rem = ver << 12;
  for (let i = 5; i >= 0; i--) if (rem & (1 << (i + 12))) rem ^= 0x1F25 << i;
  return (ver << 12) | rem;
}
function drawVersion(mods, size, ver) {
  const b = versionBits(ver);
  for (let i = 0; i < 18; i++) {
    const bit = (b >> i) & 1;
    mods[(Math.floor(i / 3)) * size + (size - 11 + i % 3)] = bit;      // 右上块
    mods[(size - 11 + i % 3) * size + Math.floor(i / 3)] = bit;        // 左下块
  }
}

/* ---------- 掩码函数（r=行 c=列） ---------- */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
];

/* ---------- 掩码罚分（ISO 四规则） ---------- */
function penalty(mat, size) {
  let p = 0;
  const at = (r, c) => mat[r * size + c];
  // 规则1：行/列同色连段 ≥5 → 3+(len-5)
  for (let i = 0; i < size; i++) {
    for (let horiz = 0; horiz < 2; horiz++) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        const same = j < size && at(horiz ? j : i, horiz ? i : j) === at(horiz ? j - 1 : i, horiz ? i : j - 1);
        if (same) run++;
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
    }
  }
  // 规则2：2×2 同色块 ×3
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = at(r, c);
    if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) p += 3;
  }
  // 规则3：行/列中出现 1011101 前后 4 空 → ×40
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const hit = (seq, arr) => { for (let k = 0; k < seq.length; k++) if (seq[k] !== arr[k]) return false; return true; };
  for (let i = 0; i < size; i++) for (let j = 0; j + 11 <= size; j++) {
    const row = [], col = [];
    for (let k = 0; k < 11; k++) { row.push(at(i, j + k)); col.push(at(j + k, i)); }
    if (hit(P1, row) || hit(P2, row)) p += 40;
    if (hit(P1, col) || hit(P2, col)) p += 40;
  }
  // 规则4：暗色比例偏离 50% → 每 5% ×10
  let dark = 0;
  for (let i = 0; i < size * size; i++) dark += mat[i];
  const pct = dark * 100 / (size * size);
  p += 10 * Math.floor(Math.abs(pct - 50) / 5);
  return p;
}

/* ---------- 主编码：文本 → {size, modules(Uint8Array 0/1)} ---------- */
function qrEncode(text) {
  const bytes = [];
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xC0 | c >> 6, 0x80 | c & 63); }
    else if (c >= 0xD800 && c < 0xDC00 && i + 1 < s.length) {   // 代理对 → 4 字节
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
      bytes.push(0xF0 | cp >> 18, 0x80 | (cp >> 12) & 63, 0x80 | (cp >> 6) & 63, 0x80 | cp & 63);
    } else { bytes.push(0xE0 | c >> 12, 0x80 | (c >> 6) & 63, 0x80 | c & 63); }
  }
  let ver = 0;
  for (let v = 1; v <= 10; v++) if (bytes.length <= CAP_M[v]) { ver = v; break; }
  if (!ver) throw new Error('QR: 地址过长（超过 Version 10-M 的 213 字节容量）');
  const size = 17 + ver * 4;

  const codewords = interleaveBlocks(buildDataBits(bytes, ver), ver);
  const bits = [];
  for (const cwv of codewords) for (let k = 7; k >= 0; k--) bits.push((cwv >> k) & 1);

  // 功能图形
  const mods = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  drawFinder(mods, fn, size, 0, 0); drawFinder(mods, fn, size, 0, size - 7); drawFinder(mods, fn, size, size - 7, 0);
  for (let i = 8; i < size - 8; i++) { setMod(mods, fn, size, 6, i, i % 2 === 0 ? 1 : 0); setMod(mods, fn, size, i, 6, i % 2 === 0 ? 1 : 0); }
  const ap = ALIGN_POS[ver];
  if (ap) for (const r of ap) for (const c of ap) {
    if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (r === ap[ap.length - 1] && c === 6)) continue;
    drawAlign(mods, fn, size, r, c);
  }
  for (let i = 0; i < 9; i++) { if (!fn[8 * size + i]) setMod(mods, fn, size, 8, i, 0); if (!fn[i * size + 8]) setMod(mods, fn, size, i, 8, 0); }
  for (let i = 0; i < 8; i++) { setMod(mods, fn, size, 8, size - 1 - i, 0); setMod(mods, fn, size, size - 1 - i, 8, 0); }
  if (ver >= 7) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) { setMod(mods, fn, size, r, size - 11 + c, 0); setMod(mods, fn, size, size - 11 + c, r, 0); }
    drawVersion(mods, size, ver);
  }

  // 数据放置：右下角起，两列一列宽蛇形向上/向下交替（第 6 列为功能列自动跳过）
  let bi = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const up = ((size - 1 - col) >> 1) % 2 === 0;   // 列对奇偶决定方向
      const r = up ? size - 1 - i : i;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (!fn[r * size + c]) mods[r * size + c] = bi < bits.length ? bits[bi++] : 0;
      }
    }
  }

  // 8 种掩码逐一评估，取罚分最小
  let best = null, bestP = Infinity;
  for (let m = 0; m < 8; m++) {
    const cand = Uint8Array.from(mods);
    const mf = MASKS[m];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r * size + c] && mf(r, c)) cand[r * size + c] ^= 1;
    drawFormat(cand, size, m);
    if (ver >= 7) drawVersion(cand, size, ver);
    const p = penalty(cand, size);
    if (p < bestP) { bestP = p; best = cand; }
  }
  return { size, modules: best };
}

/* ---------- SVG 渲染（4 模块静区，白底黑码） ---------- */
function qrToSvg(qr) {
  const s = qr.size;
  let d = '';
  for (let r = 0; r < s; r++) for (let c = 0; c < s; c++) if (qr.modules[r * s + c]) d += 'M' + c + ' ' + r + 'h1v1h-1z';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-4) + ' ' + (-4) + ' ' + (s + 8) + ' ' + (s + 8) +
    '" shape-rendering="crispEdges" role="img" aria-label="游戏地址二维码">' +
    '<rect x="' + (-4) + '" y="' + (-4) + '" width="' + (s + 8) + '" height="' + (s + 8) + '" fill="#fff"/>' +
    '<path d="' + d + '" fill="#000"/></svg>';
}

/* ---------- 页面装配（仅浏览器环境；vm 单测沙箱不注入 document 即跳过） ---------- */
if (typeof document !== 'undefined' && document.getElementById('qrBox')) {
  (function () {
    const params = new URLSearchParams(location.search);
    const url = (params.get('u') || location.origin).replace(/\/$/, '');
    document.getElementById('qrUrl').textContent = url;
    const box = document.getElementById('qrBox');
    try {
      box.innerHTML = qrToSvg(qrEncode(url));
    } catch (e) {
      box.textContent = '地址过长，无法生成二维码：请手动输入 ' + url;
    }
  })();
}

/* 内部件导出：供 tests/unit_qr.js 在 vm 沙箱做性质断言（浏览器挂到 window 无副作用） */
if (typeof globalThis !== 'undefined') {
  globalThis.qrInternals = { RS_BLOCKS, CAP_M, ALIGN_POS, gfMul, genPoly, rsRem, formatBits, versionBits, buildDataBits, interleaveBlocks, MASKS, penalty };
}

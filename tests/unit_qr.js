// unit_qr.js — qr.js 零依赖 QR 编码器性质单测（无浏览器）：
// 版本自适应/容量边界、RS 纠错余式为 0、功能图形坐标、格式/版本信息 BCH、掩码确定性。
// 用法：node unit_qr.js（run_all.js 自动发现 unit_ 前缀）
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'qr.js'), 'utf8');
const ctx = vm.createContext({});           // 不注入 document → 页面装配段自动跳过
vm.runInContext(code, ctx);
const { qrEncode, qrToSvg } = ctx;
const I = ctx.qrInternals;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}
const at = (qr, r, c) => qr.modules[r * qr.size + c];

/* ---------- 1. 版本自适应与容量边界 ---------- */
{
  ok(qrEncode('https://a.b').size === 21, 'V1 短地址（11B≤14）选 Version 1（21×21）');
  ok(qrEncode('x'.repeat(14)).size === 21, 'V1 容量上边界 14B 仍 Version 1');
  ok(qrEncode('x'.repeat(15)).size === 25, '15B 升 Version 2（25×25）');
  ok(qrEncode('x'.repeat(26)).size === 25, 'V2 容量上边界 26B');
  ok(qrEncode('x'.repeat(180)).size === 53, 'V9 容量上边界 180B（53×53）');
  ok(qrEncode('x'.repeat(213)).size === 57, 'V10 容量上边界 213B（57×57）');
  let threw = false;
  try { qrEncode('x'.repeat(214)); } catch (e) { threw = true; }
  ok(threw, '214B 超容量抛错（页面走文本地址兜底）');
  // 隧道公网地址典型长度（~40B）应落在 V3
  ok(qrEncode('https://random-subdomain.trycloudflare.com').size === 29, '典型隧道地址 43B → Version 3');
}

/* ---------- 2. 功能图形坐标 ---------- */
function checkFinder(qr, r0, c0, label) {
  let good = true;
  for (let dr = 0; dr < 7; dr++) for (let dc = 0; dc < 7; dc++) {
    const d = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
    const expect = d === 2 ? 0 : 1;
    if (at(qr, r0 + dr, c0 + dc) !== expect) good = false;
  }
  ok(good, label + ' 定位图形 7×7（外环/中心 1，内环 0）');
}
{
  const qr = qrEncode('https://192.168.1.100:8765');
  checkFinder(qr, 0, 0, '左上');
  checkFinder(qr, 0, qr.size - 7, '右上');
  checkFinder(qr, qr.size - 7, 0, '左下');
  let t = true;
  for (let c = 8; c <= qr.size - 9; c++) {
    if (at(qr, 6, c) !== (c % 2 === 0 ? 1 : 0)) t = false;
    if (at(qr, c, 6) !== (c % 2 === 0 ? 1 : 0)) t = false;
  }
  ok(t, '水平/垂直定时图形在第 6 行/列交替且起于暗');
  ok(at(qr, qr.size - 8, 8) === 1, '固定暗模块 (size-8,8)');
  // 定位图形分隔符（第 8 行/列紧邻区）应全为 0
  let sep = true;
  for (let i = 0; i < 7; i++) { if (at(qr, 7, i) !== 0 || at(qr, i, 7) !== 0) sep = false; }
  ok(sep, '左上定位图形分隔符全亮');
  // V2 对齐图形中心 (18,18) 5×5 同心
  const q2 = qrEncode('x'.repeat(20));
  let a = true;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const d = Math.max(Math.abs(dr), Math.abs(dc));
    if (at(q2, 18 + dr, 18 + dc) !== (d === 1 ? 0 : 1)) a = false;
  }
  ok(a, 'V2 对齐图形 (18,18) 5×5 同心');
  // V10 应有 6 个对齐图形（9 格点减 3 角）
  ok(I.ALIGN_POS[10].length === 3, 'V10 对齐坐标表 3 组');
}

/* ---------- 3. RS 纠错：(数据+纠错) 码字多项式除生成多项式余式为 0 ---------- */
{
  let allZero = true, blockCount = 0;
  for (let ver = 1; ver <= 10; ver++) {
    const bytes = new Array(I.CAP_M[ver]).fill(0x41);   // 满容量数据
    const dataCw = I.buildDataBits(bytes, ver);
    const totalData = I.RS_BLOCKS[ver].reduce((s, g) => s + g[0] * g[1], 0);
    if (dataCw.length !== totalData) allZero = false;
    let off = 0;
    for (const [num, dLen, eLen] of I.RS_BLOCKS[ver]) {
      for (let b = 0; b < num; b++) {
        const data = dataCw.slice(off, off + dLen); off += dLen;
        const ec = I.rsRem(data, eLen);
        blockCount++;
        if (ec.length !== eLen) allZero = false;
        const rem = I.rsRem(data.concat(ec), eLen);      // 完整码字多项式 mod gen
        if (rem.some(v => v !== 0)) allZero = false;
      }
    }
  }
  ok(allZero, 'V1-10 全部 ' + blockCount + ' 个 RS 块：码字多项式 mod 生成多项式 余式=0');
  // GF 域性质：α^255=1，乘法交换律抽查
  let gf = I.gfMul(0x53, 0xa7) === I.gfMul(0xa7, 0x53);
  const exp = (n) => { let r = 1; for (let i = 0; i < n; i++) r = I.gfMul(r, 2); return r; };
  ok(gf && exp(255) === 1 && exp(8) === 0x1d % 0x100, 'GF(256) 乘法交换律与 α^255=1（本原多项式 0x11D）');
}

/* ---------- 4. 格式/版本信息 BCH ---------- */
{
  let f = true;
  for (let mask = 0; mask < 8; mask++) {
    const b = I.formatBits(mask);
    if (((b ^ 0x5412) >> 10) !== mask) f = false;       // M 级 00 → 数据位即掩码
    if (b < 0 || b > 0x7fff) f = false;
  }
  ok(f, '格式信息 8 种掩码：M 等级编码 + BCH 余式自洽（XOR 0x5412 可还原）');
  let v = true;
  for (let ver = 7; ver <= 10; ver++) {
    let rem = I.versionBits(ver);
    for (let i = 5; i >= 0; i--) if (rem & (1 << (i + 12))) rem ^= 0x1F25 << i;
    if (rem !== 0 || (I.versionBits(ver) >> 12) !== ver) v = false;
  }
  ok(v, 'V7-10 版本信息 BCH(18,6) 余式=0 且高 6 位=版本号');
}

/* ---------- 5. 确定性与掩码选优 ---------- */
{
  const a = qrEncode('http://192.168.1.5:8765');
  const b = qrEncode('http://192.168.1.5:8765');
  let same = a.size === b.size;
  for (let i = 0; i < a.modules.length && same; i++) if (a.modules[i] !== b.modules[i]) same = false;
  ok(same, '同一地址两次编码矩阵完全一致（确定性）');
  ok(I.penalty(a.modules, a.size) > 0, '罚分函数对成品矩阵返回正分');
  // 掩码后数据区不应全 0/全 1
  let dark = 0;
  for (let i = 0; i < a.modules.length; i++) dark += a.modules[i];
  ok(dark > a.modules.length * 0.2 && dark < a.modules.length * 0.8, '成品矩阵明暗分布合理（掩码生效）');
}

/* ---------- 6. SVG 输出 ---------- */
{
  const svg = qrToSvg(qrEncode('http://a.b'));
  ok(svg.startsWith('<svg') && svg.includes('viewBox="-4 -4 29 29"') && svg.includes('<path'), 'SVG 含 4 模块静区 viewBox 与路径');
  ok(svg.includes('fill="#fff"') && svg.includes('fill="#000"'), 'SVG 白底黑码');
}

console.log('===== RESULT: ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);

// 将 _levels_out.txt 生成的关卡块注入 levels.js 的 `const LEVELS = [ ... ];`（模块化拆分后关卡数据在 levels.js）
const fs = require('fs');
let html = fs.readFileSync('d:/onetwobubu/levels.js', 'utf8');
const body = fs.readFileSync('d:/onetwobubu/_levels_out.txt', 'utf8').trimEnd();
const start = html.indexOf('const LEVELS = [');
if (start < 0) { console.error('未找到 LEVELS 起点'); process.exit(1); }
const endMarker = '\n];';
const end = html.indexOf(endMarker, start);
if (end < 0) { console.error('未找到 LEVELS 终点'); process.exit(1); }
const newBlock = 'const LEVELS = [\n' + body + '\n];';
html = html.slice(0, start) + newBlock + html.slice(end + endMarker.length);
fs.writeFileSync('d:/onetwobubu/levels.js', html, 'utf8');
// 校验注入后的关卡数
const block = html.match(/const LEVELS = \[[\s\S]*?\n\];/)[0];
const n = (block.match(/^    "/gm) || []).length;
console.log('注入完成，LEVELS 关卡数 =', n / 10);

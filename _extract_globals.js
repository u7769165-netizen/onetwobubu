// 提取浏览器侧各 JS 文件的顶层声明名，写入 _globals.json 供 eslint.config.js 注入 globals。
// 背景：项目无模块系统，多个 <script> 文件共享同一全局作用域，逐文件 lint 时需把
// 其他文件的顶层声明注入为全局，否则跨文件引用会被 no-undef 误报。
// 用法：npm run globals   （即 node _extract_globals.js）
// 实现：用 espree（ESLint 自带依赖）解析 AST，只取 Program 顶层的
//   VariableDeclaration（含逗号多段/解构）、FunctionDeclaration、ClassDeclaration。
//   文件清单随 game.js 拆分同步追加。
const fs = require('fs');
const path = require('path');
const espree = require('espree');

// 浏览器侧共享全局作用域的脚本（按 index.html 加载顺序维护）
const BROWSER_FILES = [
  'levels.js',
  'audio.js',
  'ui.js',
  'save.js',
  'sprites.js',
  'mechanics.js',
  'render.js',
  'net.js',
  'game.js',
];

// 收集 binding 名（处理对象/数组解构的兜底，项目顶层目前均为标识符）
function collectNames(id, out) {
  if (!id) return;
  if (id.type === 'Identifier') out.add(id.name);
  else if (id.type === 'ObjectPattern') id.properties.forEach(p => collectNames(p.value, out));
  else if (id.type === 'ArrayPattern') id.elements.forEach(el => collectNames(el, out));
  else if (id.type === 'AssignmentPattern') collectNames(id.left, out);
  else if (id.type === 'RestElement') collectNames(id.argument, out);
}

const names = new Set();
for (const f of BROWSER_FILES) {
  const fp = path.join(__dirname, f);
  if (!fs.existsSync(fp)) { console.error('缺少文件: ' + f); process.exit(1); }
  const ast = espree.parse(fs.readFileSync(fp, 'utf8'), { ecmaVersion: 2022, sourceType: 'script' });
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') node.declarations.forEach(d => collectNames(d.id, names));
    else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
  }
}

const sorted = [...names].sort();
const out = JSON.stringify(sorted);
const prevPath = path.join(__dirname, '_globals.json');
let prev = [];
try { prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')); } catch (e) { /* 首次运行或文件缺失 */ }
fs.writeFileSync(prevPath, out);
const removed = prev.filter(n => !names.has(n));
const added = sorted.filter(n => !prev.includes(n));
console.log(`_globals.json: ${sorted.length} 个名字（原 ${prev.length}）`);
if (removed.length) console.log('移除: ' + removed.join(', '));
if (added.length) console.log('新增: ' + added.join(', '));

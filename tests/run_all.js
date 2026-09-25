// 一键回归：串行运行全部 CDP 测试脚本，汇总 PASS/FAIL。
// 前提：游戏服务器已启动（node ../server.js，端口 8765）。
// 用法：node run_all.js [脚本名过滤关键字]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const scripts = fs.readdirSync(__dirname)
  .filter(f => (f.startsWith('cdp_') || f.startsWith('unit_') || f === 'auth_api.js') && f.endsWith('.js'))
  .filter(f => !process.argv[2] || f.includes(process.argv[2]))
  .sort();

const results = [];
for (const s of scripts) {
  console.log(`\n========== ${s} ==========`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8', cwd: __dirname, timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  // 只回显失败行与结果行，成功脚本压缩输出
  const lines = out.split(/\r?\n/);
  const fails = lines.filter(l => l.startsWith('FAIL') || l.includes('FATAL') || l.includes('=== NET'));
  const result = lines.find(l => /===== RESULT|NET INTERPOLATION|CONSOLE/.test(l)) || (r.status === 0 ? 'exit 0' : `exit ${r.status}`);
  fails.filter(l => l.startsWith('FAIL') || l.includes('FATAL')).forEach(l => console.log('  ' + l));
  const m = out.match(/(\d+) passed, (\d+) failed/);
  // 无断言计数的脚本（如纯截图冒烟）：以退出码 + 无 FAIL/FATAL 行为准
  const okAll = m ? (+m[2] === 0) : (r.status === 0 && !/FAIL|FATAL/.test(out));
  console.log(`${okAll ? '✔' : '✘'} ${s}  ${result}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  results.push({ s, ok: okAll, detail: m ? `${m[1]}/${+m[1] + +m[2]}` : (okAll ? 'ok' : 'fail') });
}

console.log('\n================ 汇总 ================');
let bad = 0;
for (const x of results) { if (!x.ok) bad++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.s}  ${x.detail}`); }
console.log(bad === 0 ? `全部通过（${results.length} 个脚本）` : `${bad} 个脚本失败`);
process.exit(bad === 0 ? 0 : 1);

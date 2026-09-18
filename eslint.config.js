// ESLint 宽松规则集：核心目标是 no-undef 抓「真正未定义」的跨文件引用（重构改名漏改的防线）。
// 四文件共享同一全局作用域（无模块系统），故把各文件顶层声明名注入 globals，
// 避免逐文件 lint 时把跨文件引用误报为未定义。
// 运行：npx eslint .   （package.json 的 lint 脚本）
const fs = require('fs');

// 浏览器/环境全局（够用即可，非穷举）
const browserGlobals = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly', navigator: 'readonly',
  location: 'readonly', console: 'readonly', performance: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  AudioContext: 'readonly', webkitAudioContext: 'readonly', WebSocket: 'readonly',
  Image: 'readonly', URL: 'readonly', Blob: 'readonly', FileReader: 'readonly',
  getComputedStyle: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  encodeURIComponent: 'readonly', decodeURIComponent: 'readonly', btoa: 'readonly', atob: 'readonly',
  URLSearchParams: 'readonly', FormData: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
  PointerEvent: 'readonly', TouchEvent: 'readonly', HTMLElement: 'readonly', Node: 'readonly',
  ImageData: 'readonly', Path2D: 'readonly', OffscreenCanvas: 'readonly', DOMParser: 'readonly',
  MutationObserver: 'readonly', ResizeObserver: 'readonly', matchMedia: 'readonly',
  innerWidth: 'readonly', innerHeight: 'readonly', devicePixelRatio: 'readonly',
  queueMicrotask: 'readonly', structuredClone: 'readonly', crypto: 'readonly', Intl: 'readonly',
  fetch: 'readonly',
  Math: 'readonly', JSON: 'readonly', Date: 'readonly', parseInt: 'readonly', parseFloat: 'readonly',
  isNaN: 'readonly', Number: 'readonly', String: 'readonly', Array: 'readonly', Object: 'readonly',
  Set: 'readonly', Map: 'readonly', Promise: 'readonly', Infinity: 'readonly', NaN: 'readonly',
};

// 项目四文件顶层声明名（自动提取，避免误报跨文件引用）
const projectGlobals = {};
try {
  for (const n of JSON.parse(fs.readFileSync('./_globals.json', 'utf8'))) {
    if (!(n in browserGlobals)) projectGlobals[n] = 'readonly';
  }
} catch (e) { /* _globals.json 缺失时跳过，仅靠浏览器全局 */ }

module.exports = [
  {
    files: ['levels.js', 'audio.js', 'ui.js', 'game.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ...projectGlobals },
    },
    rules: {
      'no-undef': 'error',            // 主目标：未定义引用
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }], // 顶层声明会被当"使用"（跨文件共享），只报局部
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],  // 存档 try/catch 空 catch 是有意为之
      'no-const-assign': 'error',
      'no-redeclare': ['error', { builtinGlobals: false }],  // 允许文件声明与注入的全局同名（共享作用域），仍抓同文件内真重复
      'no-unsafe-negation': 'warn',
      'no-cond-assign': ['warn', 'except-parens'],
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'off',                // 项目用 let/const 为主，但不强制
    },
  },
  {
    // Node 侧脚本（生成器/注入器/测试）：用 node 全局，规则更宽松
    files: ['_gen_levels.js', '_inject_levels.js', '_extract_globals.js', 'server.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'readonly', exports: 'readonly', __dirname: 'readonly',
                 process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly',
                 setInterval: 'readonly', clearTimeout: 'readonly', clearInterval: 'readonly',
                 URL: 'readonly', WebSocket: 'readonly', fetch: 'readonly', globalThis: 'readonly',
                 localStorage: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'off', 'no-empty': 'off' },
  },
  { ignores: ['_legacy/', 'node_modules/', 'img/', 'tests/profile*', 'tests/pA', 'tests/pB', '_globals.json'] },
];

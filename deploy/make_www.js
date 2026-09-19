// 把游戏静态资源拷贝到 www/，作为 Capacitor 打包目录（APK 内置离线资源）
// 用法: node deploy/make_www.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const FILES = [
  'index.html', 'style.css',
  'levels.js', 'audio.js', 'ui.js', 'save.js', 'sprites.js',
  'mechanics.js', 'render.js', 'net.js', 'game.js',
  '一二.png', '布布.png', '一二侧面.png', '布布侧面.png',
];
const DIRS = ['img', 'bgm'];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

let n = 0;
for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
  n++;
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!fs.existsSync(src)) continue;
  fs.cpSync(src, path.join(WWW, d), { recursive: true });
  n++;
}
console.log('www/ 就绪：' + n + ' 项');

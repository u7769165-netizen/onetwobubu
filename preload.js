// preload.js — 早期资源预载（原 index.html 内联脚本，P1-4 外置以启用严格 CSP script-src 'self'）
// 与 CSS/JS 解析并行下载角色贴图，缩短首帧等待。
// 正面图必载；侧面图按存档所选皮肤只载对应一张（避免预载未用皮肤浪费带宽）。
(function () {
  var skin = 'classic';
  try {
    var s = JSON.parse(localStorage.getItem('onetwobubu_save_v1') || '{}');
    if (s.settings && s.settings.skin === 'outing') skin = 'outing';
  } catch (e) {}
  var srcs = ['一二.png', '布布.png'].concat(skin === 'outing'
    ? ['img/微信图片_20260917172505_169_32.jpg', 'img/微信图片_20260917172503_168_32.jpg']
    : ['一二侧面.png', '布布侧面.png']);
  for (var i = 0; i < srcs.length; i++) {
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'image'; l.href = srcs[i];
    document.head.appendChild(l);
  }
})();

// PWA Service Worker：网络优先 + 写穿缓存（离线时回退缓存），支撑「添加到主屏」离线游玩。
// 版本升级只改 CACHE 名即可整体换新（activate 时清旧桶）。
const CACHE = 'owb-pwa-v1';
const CORE = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './levels.js', './audio.js', './ui.js', './save.js', './sprites.js',
  './mechanics.js', './render.js', './net.js', './game.js',
  './一二.png', './布布.png', './一二侧面.png', './布布侧面.png',
  './pwa-icon-192.png', './pwa-icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;   // 只接管同源请求（联机 ws/wss 不经 SW）
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then(r =>
          r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
        )
      )
  );
});

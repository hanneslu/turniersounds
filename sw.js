// Service Worker: macht die App offline nutzbar.
// Bei Änderungen an der App die Versionsnummer erhöhen, damit Geräte die neue Fassung laden.
const VERSION = 'turniersounds-v3';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'ANLEITUNG.html',
  'js/app.js', 'js/audio.js', 'js/editor.js', 'js/model.js', 'js/store.js', 'js/theme.js', 'js/util.js', 'js/zip.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst aus dem Cache antworten (schnell, offline), im Hintergrund aktualisieren.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

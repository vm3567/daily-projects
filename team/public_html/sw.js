// Work Task app shell: keeps the screens on the phone so the app opens fast and shows something
// without internet. Data (api/) and the projects app (projects/, it has its own) are never kept here.
const CACHE = 'worktask-v1';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // only our own old copies: the projects app keeps its own cache on the same site
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('worktask-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/projects/')) return;
  // online: always the newest copy (and keep it); offline: the kept copy
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

// Work Task app shell: keeps the screens on the phone so the app opens fast and shows something
// without internet. Data (api/) and the projects app (projects/, it has its own) are never kept here.
const CACHE = 'worktask-v3';
const SHELL = ['./', 'index.html', 'app.js', 'styles.css', 'projects/styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // only our own old copies: the projects app keeps its own cache on the same site
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('worktask-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || (url.pathname.startsWith('/projects/') && url.pathname !== '/projects/styles.css')) return; // the shared look is kept here too
  // online: always the newest copy (and keep it); offline: the kept copy
  const net = fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
    return res;
  });
  const kept = () => caches.match(e.request).then((r) => r || caches.match('index.html'));
  // weak signal (connected, but nothing moves): after 4 seconds use the kept copy, if there is one
  const slow = new Promise((resolve) => setTimeout(() => caches.match(e.request).then(resolve, () => resolve(null)), 4000));
  e.respondWith(Promise.race([net, slow.then((r) => r || net)]).catch(() => kept()));
});

// ---------------------------------------------------------------- phone notifications (like new mail)
// The server sends a short message (new task, new project step, an update, a message). If the app is
// open and in front, the app shows it as a coloured bar at the top; otherwise the phone shows a notification.
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Work Task', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const app = list.filter((c) => new URL(c.url).pathname === '/');
    app.forEach((c) => c.postMessage({ type: 'push', msg: m }));
    if (app.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined; // they are looking at it: the bar is enough
    return self.registration.showNotification(m.title || 'Work Task', {
      body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, icon: 'icons/icon-192.png', data: { url: m.url || '/' },
    });
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin); // only ever our own pages
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => new URL(x.url).pathname === '/');
    if (c) { c.postMessage({ type: 'open', hash: url.hash }); return c.focus(); }
    return self.clients.openWindow(url.href);
  }));
});

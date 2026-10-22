// Work Task app shell: keeps the screens on the phone so the app opens fast and shows something
// without internet. Data (api/) and the projects app (projects/, it has its own) are never kept here.
const CACHE = 'worktask-v25';
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'styles.css', 'projects/styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // all app files at once, fresh from the server (not the browser's own store): one version, all or nothing
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // only our own old copies: the projects app keeps its own cache on the same site
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('worktask-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/outlook.php' || (url.pathname === '/version.txt' && url.search) || (url.pathname.startsWith('/projects/') && url.pathname !== '/projects/styles.css')) return; // the shared look is kept here too
  // only this version's copies (never a leftover from another cache)
  const fromCache = (req) => caches.open(CACHE).then((c) => c.match(req));
  // online: always the newest copy (and keep it); offline: the kept copy
  const net = fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return res; }
    return fromCache(e.request).then((r) => r || res); // the host answered with an error page: the saved copy, if there is one
  });
  const kept = () => fromCache(e.request).then((r) => r || (e.request.mode === 'navigate' ? fromCache('index.html') : Response.error()));
  // code (app.js, logic.js, styles): wait for the network, the kept copy only when there is none (offline).
  // A slow logic.js must never be the old one next to a new app.js: the modules would not fit and the app would not start.
  if (e.request.mode !== 'navigate' && /\.(js|mjs|css)$/.test(url.pathname)) { e.respondWith(net.catch(() => kept())); return; }
  // the kept (old) page was shown because the network was slow, and a newer one then arrived: tell the page
  let netDone = false;
  net.then(() => { netDone = true; }, () => { netDone = true; });
  const stamp = (r) => (r && (r.headers.get('etag') || r.headers.get('last-modified'))) || '';
  // weak signal (connected, but nothing moves): after 4 seconds use the kept page (or picture), if there is one
  const slow = new Promise((resolve) => setTimeout(() => fromCache(e.request).then(resolve, () => resolve(null)), 4000));
  slow.then((old) => {
    if (!old || netDone || !(e.request.mode === 'navigate' || /\.html$|\/$/.test(url.pathname))) return;
    net.then((res) => { if (res.ok && stamp(res) !== stamp(old)) self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'new-version' }))); }).catch(() => {});
  });
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
    if (self.navigator.setAppBadge && m.kind === 'task') self.navigator.setAppBadge().catch(() => {}); // a dot on the app icon until it is opened
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
    const c = url.pathname === '/' ? list.find((x) => new URL(x.url).pathname === '/') : null; // a projects reminder (/projects/#open=…) is for the projects page
    if (c) { c.postMessage({ type: 'open', hash: url.hash }); return c.focus(); }
    // another page of this site is open (the owner's projects): use that window, or a new one if it cannot be moved
    const other = list.find((x) => new URL(x.url).origin === self.location.origin && 'navigate' in x);
    if (other) return other.navigate(url.href).then((w) => (w || other).focus()).catch(() => self.clients.openWindow(url.href));
    return self.clients.openWindow(url.href);
  }));
});

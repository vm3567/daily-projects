// Work Task's start page (it sends everyone to the one app, worktask.in/projects/) and the phone notifications.
// Keeps the start page on the phone so an installed app opens without internet. Data (api/) and the one app
// (projects/, it has its own) are never kept here.
const CACHE = 'worktask-v29';
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'styles.css', 'projects/styles.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // all app files at once, fresh from the server (not the browser's own store): one version, all or nothing.
  // Their version is noted with them (asked first: an upload in between only makes the set look older, so it is renewed;
  // not known: '' = old, renewed at the first version check)
  const ver = fetch('version.txt', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((t) => t.trim(), () => '');
  e.waitUntil(caches.open(CACHE).then((c) => ver.then((v) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))).then(() => c.put(STAMP, new Response(v))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // only our own old copies: the projects app keeps its own cache on the same site
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('worktask-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// The code files kept here are always ONE matched set: written only all at once (install, or when version.txt
// says a new version was uploaded), never one file at a time.
const STAMP = 'kept-version.txt'; // the version of the kept set
// resolves true when the kept set was of an older version (a page that got its code from it runs old code)
const keepSet = (stamp) => caches.open(CACHE).then((c) => c.match(STAMP).then((old) => (old ? old.text() : null)).then((was) => {
  if (was === stamp) return false;
  const save = () => c.put(STAMP, new Response(stamp));
  return was === null ? save().then(() => false) : c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))).then(save).then(() => true, () => true); // all or nothing
}));
// weak signal: a code file waits this long for the network, then this version's kept copy is used
const CODE_WAIT = 8000;
// per open page: once one code file came from the network (or the kept set), the rest come the same way (never mixed)
const pageWay = new Map();
const decide = (id, way) => { if (!id || pageWay.has(id)) return; pageWay.set(id, way); if (pageWay.size > 50) pageWay.delete(pageWay.keys().next().value); };

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/outlook.php' || (url.pathname === '/version.txt' && url.search) || (url.pathname.startsWith('/projects/') && url.pathname !== '/projects/styles.css')) return; // the shared look is kept here too
  // version.txt: only ever from the server (never a kept copy), so "New version ready" is never false.
  // A new version: the kept code set is renewed, all at once.
  if (url.pathname === '/version.txt') {
    let text = null;
    const got = fetch(url.href, { cache: 'no-store' }).then((r) => { text = r.ok ? r.clone().text() : null; return r; });
    // the pages that got their code from the kept (old) set run old code, but their first stamp is already the new one: tell them (they offer the reload)
    const oldPages = () => Promise.all([...pageWay].filter(([, way]) => way === 'kept').map(([id]) => self.clients.get(id).then((c) => c && c.postMessage({ type: 'new-version' }))));
    e.waitUntil(got.then(() => text).then((t) => (t && t.trim() ? keepSet(t.trim()) : false)).then((wasOld) => (wasOld ? oldPages() : undefined)).catch(() => {}));
    e.respondWith(got);
    return;
  }
  const code = e.request.mode !== 'navigate' && /\.(js|mjs|css)$/.test(url.pathname);
  // only this version's copies (never a leftover from another cache)
  const fromCache = (req) => caches.open(CACHE).then((c) => c.match(req));
  const id = code && /\.m?js$/.test(url.pathname) ? e.clientId : null; // the modules decide; a style sheet only has its own time limit
  let from = 'net'; // where net's answer came from: 'net', 'kept' (the saved copy), or null (an error answer)
  // online: always the newest copy (and keep it, except code: that is kept only as a whole set); offline: the kept copy
  const net = fetch(e.request).then((res) => {
    if (res.ok) { if (!code) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); } return res; }
    from = null;
    if (pageWay.get(id) === 'net') return res; // this page has new code: the error, never an old kept copy next to it
    return fromCache(e.request).then((r) => { if (r) from = 'kept'; return r || res; }); // the host answered with an error page: the saved copy, if there is one
  });
  const kept = () => fromCache(e.request).then((r) => r || (e.request.mode === 'navigate' ? fromCache('index.html') : Response.error()));
  // code (app.js, logic.js, styles): the network, or after CODE_WAIT (weak signal) / offline the kept set of this version.
  // A page that got one code file from the network waits for the network for the rest, and the other way round:
  // a new app.js never meets an old logic.js.
  if (code) {
    if (pageWay.get(id) === 'kept') { e.respondWith(fromCache(e.request).then((r) => r || net)); return; }
    const late = pageWay.get(id) === 'net' ? new Promise(() => {}) : new Promise((resolve) => setTimeout(() => fromCache(e.request).then(resolve, () => resolve(null)), CODE_WAIT));
    e.respondWith(Promise.race([
      net.then((r) => { if (from) decide(id, from); return r; }), // a kept copy (the host's error page swapped) marks the page 'kept'
      late.then((r) => { if (!r || pageWay.get(id) === 'net') return net; decide(id, 'kept'); return r; }),
    ]).catch(() => { if (pageWay.get(id) === 'net') return Response.error(); decide(id, 'kept'); return kept(); })); // new code on this page: fail cleanly, never mix
    return;
  }
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
    // the one app, open: it looks for the news at once (the phone still shows the notification)
    list.filter((c) => new URL(c.url).pathname.startsWith('/projects/')).forEach((c) => c.postMessage({ type: 'push', msg: m }));
    if (self.navigator.setAppBadge && m.kind === 'task') self.navigator.setAppBadge().catch(() => {}); // a dot on the app icon until it is opened
    return self.registration.showNotification(m.title || 'Work Task', {
      body: m.body || '', tag: m.tag || undefined, renotify: !!m.tag, icon: 'icons/icon-192.png', data: { url: m.url || '/' },
    });
  }));
});

/** An old notification's address (worktask.in/#open=<id>, worktask.in/): the same place in the one app. */
function oneApp(url) {
  if (url.pathname !== '/') return url;
  const n = /^#(?:open|task)=(\d+)$/.exec(url.hash);
  return new URL(n ? '/projects/#team-task=' + n[1] : '/projects/', url.origin);
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin); // only ever our own pages
  url = oneApp(url);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    // the one app is open: it opens that task (or project reminder) itself, without loading again
    const c = url.pathname === '/projects/' && url.hash ? list.find((x) => new URL(x.url).pathname === '/projects/') : null;
    if (c) { c.postMessage({ type: 'open', hash: url.hash }); return c.focus(); }
    // another page of this site is open: use that window, or a new one if it cannot be moved
    const other = list.find((x) => new URL(x.url).origin === self.location.origin && 'navigate' in x);
    if (other) return other.navigate(url.href).then((w) => (w || other).focus()).catch(() => self.clients.openWindow(url.href));
    return self.clients.openWindow(url.href);
  }));
});

// Keeps a copy of the app's own files on the device, so Daily Projects opens without internet.
// Online: always the newest files from the website (so updates arrive by themselves).
// Offline or very slow: the copy on the device.
// Your data is NOT handled here (it goes to GitHub directly; the app keeps its own data copy).

const CACHE = 'daily-projects-app-40'; // new name: drops the old copy (so phones get the new code at once; -3 had no ui/mains.js; -2 also held data files ../api/)
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'app.js', 'ai.js', 'config.js', 'device.js', 'github.js', 'mockrepo.js', 'ops.js', 'reports.js', 'rich.js', 'rules.js', 'store.js', 'voice.js', 'serverrepo.js',
  'ui/autocorrect.js', 'ui/bell.js', 'ui/connections.js', 'ui/dashboard.js', 'ui/detail.js', 'ui/dom.js', 'ui/files.js', 'ui/listkeys.js', 'ui/mains.js', 'ui/rowmenu.js', 'ui/mention.js', 'ui/people.js', 'ui/replies.js', 'ui/richedit.js', 'ui/signin.js', 'ui/staff.js', 'ui/staffbox.js', 'ui/stage.js', 'ui/team.js', 'ui/timereport.js', 'ui/workparts.js',
  'vendor/sortable.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
// Work Task's rules, used by the staff view (one app): kept here too, so a team member's phone opens it offline.
// Best effort: only worktask.in has it (elsewhere it is simply not kept).
const TEAM_FILES = ['../logic.js'];
const WAIT_MS = 3000; // weak signal: after 3 s use the copy on the device

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES).then(() => Promise.all(TEAM_FILES.map((u) => c.add(u).catch(() => {}))))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('daily-projects-app') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub / AI calls are not touched
  const team = TEAM_FILES.some((f) => new URL(f, self.location).pathname === url.pathname);
  if (!team && !url.pathname.startsWith(new URL('./', self.location).pathname)) return; // only the app's own files: never data (../api/)
  if (url.pathname.endsWith('/version.txt') && url.search) return; // the "new version?" check: always the server, never kept
  event.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = new Request(url.origin + url.pathname); // ?mock=1 and similar do not matter
  const fromNetwork = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  // Only the page itself falls back after 3 s on a weak signal. The code files wait for the network and use the
  // device copy only when there is no internet — so a new page never runs with half old, half new code.
  const isPage = url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  const timeout = new Promise((resolve) => setTimeout(resolve, isPage ? WAIT_MS : 60000, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch { /* no internet */ }
  const cached = await cache.match(key) || (url.pathname.endsWith('/') ? await cache.match(new Request(url.origin + url.pathname + 'index.html')) : null);
  if (cached) return cached;
  return fromNetwork; // nothing kept yet: wait for the network after all
}

// Keeps a copy of the app's own files on the device, so Daily Projects opens without internet.
// Online: always the newest files from the website (so updates arrive by themselves).
// Offline or very slow: the copy on the device.
// Your data is NOT handled here (it goes to GitHub directly; the app keeps its own data copy).

const CACHE = 'daily-projects-app';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'app.js', 'ai.js', 'config.js', 'device.js', 'github.js', 'mockrepo.js', 'ops.js', 'reports.js', 'rules.js', 'store.js',
  'ui/dashboard.js', 'ui/detail.js', 'ui/dom.js', 'ui/files.js', 'ui/mention.js', 'ui/people.js', 'ui/timereport.js',
  'vendor/sortable.min.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const WAIT_MS = 3000; // weak signal: after 3 s use the copy on the device

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub / AI calls are not touched
  event.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = new Request(url.origin + url.pathname); // ?mock=1 and similar do not matter
  const fromNetwork = fetch(req).then((res) => {
    if (res.ok) cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, WAIT_MS, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch { /* no internet */ }
  const cached = await cache.match(key) || (url.pathname.endsWith('/') ? await cache.match(new Request(url.origin + url.pathname + 'index.html')) : null);
  if (cached) return cached;
  return fromNetwork; // nothing kept yet: wait for the network after all
}

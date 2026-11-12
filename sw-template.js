// DRONE 3D's service worker (written into dist/sw.js by vite.config.js): it keeps every file of the game on the
// phone the first time the game is opened, and serves them from there, so the game plays offline. A new build
// has a new version: the phone fetches the new files and drops the old ones.
const VERSION = '__VERSION__';
const CACHE = 'drone3d-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('drone3d-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // the page itself: the cached game, whatever the address says after it (?, #)
      // (ignoreVary: a server may answer 'Vary: Origin', and a module script is asked for with an Origin)
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true }) || (req.mode === 'navigate' ? await cache.match('./', { ignoreVary: true }) : null);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (req.mode === 'navigate') { const page = await cache.match('./', { ignoreVary: true }); if (page) return page; }
        throw e;
      }
    }),
  );
});

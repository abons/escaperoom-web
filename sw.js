/* Service worker: cache-first app shell, precache of every story file, network-first index.html.
 * To ship a new version: bump CACHE below (escaperoom-v1 -> escaperoom-v2). Old caches are deleted on activate.
 * All paths are relative to this file, so it works under a sub-path (GitHub Pages). */
const CACHE = 'escaperoom-v3';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/engine.js',
  './js/ui.js',
  './js/wall.js',
  './js/codepad.js',
  './js/i18n.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './stories/index.json',
];

async function addAllTolerant(cache, urls) {
  // one missing file must not fail the whole install
  await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (res.ok) await cache.put(u, res);
    } catch (e) { /* offline during install or absent: skip */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await addAllTolerant(cache, SHELL);
    try {
      const res = await fetch('./stories/index.json', { cache: 'reload' });
      const idx = await res.json();
      const files = [];
      for (const s of idx.stories || []) for (const f of s.files || []) files.push('./stories/' + f);
      await addAllTolerant(cache, files);
    } catch (e) { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  if (isPage) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put('./index.html', res.clone());
        return res;
      } catch (e) {
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return Response.error();
    }
  })());
});

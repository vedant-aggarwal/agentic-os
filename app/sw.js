// Network first, cache as fallback, so the app shell opens without the PC (the web/PWA build; the iPhone app bundles
// its files and has no service worker). Data is never cached here: the app keeps its own copy and syncs through
// /api/v1. /healthz is never answered from the cache either: the app's connection probe must hear the PC itself,
// or it would say "online" while the PC is away.
const CACHE = 'agentic-os-shell-v2';
const SHELL = ['/', '/js/main.js', '/js/core.js', '/js/data.js', '/js/data-demo.js', '/js/svc/api.js', '/js/svc/sync.js', '/css/system.css', '/css/engine.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-180.png'];
const SKIP = (p) => p.startsWith('/api/') || p === '/healthz' || p.startsWith('/mock/') || p === '/login' || p.startsWith('/c/');
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || SKIP(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      // never cache the login redirect in place of the app
      if (r.ok && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});

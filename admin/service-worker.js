// Cahaya Phone Admin — PWA Service Worker
// Strategy:
//   - App shell (HTML/CSS/JS/icons): cache-first with background update
//   - API calls (/api/*): network-only (data must stay live)
//   - Everything else: network-first, fallback to cache

const CACHE_VERSION = 'cp-admin-v2';
const SHELL_ASSETS = [
  '/admin/',
  '/admin/index.html',
  '/admin/dashboard.html',
  '/admin/admin.css',
  '/admin/admin.js',
  '/admin/manifest.json',
  '/admin/icons/icon-192.png',
  '/admin/icons/icon-512.png',
  '/admin/icons/icon-maskable.png',
  '/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API responses — admin always needs fresh data
  if (url.pathname.startsWith('/api/')) return;

  // Skip cross-origin (Google Fonts, etc.) — let browser handle
  if (url.origin !== self.location.origin) return;

  // App shell: cache-first with background refresh
  if (SHELL_ASSETS.some((asset) => url.pathname.endsWith(asset.replace('/admin', '')) || url.pathname === asset)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Default: network-first, fallback to cache
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

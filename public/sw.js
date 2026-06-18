// Earth Intelligence — PWA Service Worker
// Cache static assets only. API responses are NEVER cached because they are
// user-scoped (auth tokens, personal data) and must always be fresh.

const CACHE_NAME = 'earth-intel-v2';
const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB cap
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

// Install: cache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting()),
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      );
    }).then(() => self.clients.claim()),
  );
});

async function evictIfOverLimit(cache) {
  try {
    const keys = await cache.keys();
    let total = 0;
    const entries = [];
    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      const size = Number(res.headers.get('content-length') || 0);
      total += size;
      entries.push({ req, size });
    }
    if (total <= MAX_CACHE_SIZE) return;
    entries.sort((a, b) => a.size - b.size);
    for (const e of entries) {
      if (total <= MAX_CACHE_SIZE) break;
      cache.delete(e.req).catch(() => {});
      total -= e.size;
    }
  } catch { /* eviction best-effort */ }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip source maps, hot-module reload, and other dev-only requests
  if (url.pathname.endsWith('.map') || url.pathname.includes('/@vite/') || url.pathname.includes('/@react-refresh')) {
    return;
  }

  // NEVER cache /api/* — these are user-scoped, auth-gated, and per-user.
  // Caching them risks cross-user data leakage and stale auth state.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Static assets — network first for HTML, cache first for everything else
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then(async (response) => {
        const clone = response.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, clone).catch(() => {});
        evictIfOverLimit(cache);
        return response;
      });
    }),
  );
});

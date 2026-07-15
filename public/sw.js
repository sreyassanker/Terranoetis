// Earth Intelligence — PWA Service Worker (Offline-First)
// Caches static assets, API responses, and tile data for offline operation.
// Critical for deployed/field environments with no internet connectivity.

const CACHE_NAME = 'earth-intel-v3';
const MAX_CACHE_SIZE = 200 * 1024 * 1024; // 200MB cap (increased for offline data)
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/index.html',
];

// API endpoints to cache for offline access (public read-only data)
const CACHEABLE_API_PATHS = [
  '/api/earthquakes',
  '/api/weather/open-meteo',
  '/api/weather/alerts',
  '/api/eonet',
  '/api/firms',
  '/api/lightning',
  '/api/iss',
  '/api/aurora',
  '/api/vaac/',
  '/api/gdacs/',
  '/api/tectonic',
  '/api/ndbc/',
  '/api/shakemap/',
  '/api/spc/',
  '/api/openaq',
  '/api/mgrs',
];

// Tile cache for offline basemaps
const TILE_CACHE_NAME = 'earth-intel-tiles';
const TILE_CACHE_MAX = 500 * 1024 * 1024; // 500MB for tiles

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

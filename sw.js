// Archive Quest service worker.
// Оболочка приложения: сначала сеть (3 с), без сети — кэш.
// Тайлы карты и шрифты: сначала кэш — всё, что ты уже смотрел онлайн, открывается офлайн.
const VERSION = '17';
const SHELL_CACHE = 'aq-shell-v' + VERSION;
const TILE_CACHE = 'aq-tiles-v1';
const FONT_CACHE = 'aq-fonts-v1';
const MAX_TILES = 4000;
const SHELL = ['./', 'index.html', 'styles.css?v=' + VERSION, 'app.js?v=' + VERSION, 'sync.js?v=' + VERSION, 'config.js?v=' + VERSION, 'vendor/supabase/supabase.js', 'manifest.webmanifest', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const KEEP = [SHELL_CACHE, TILE_CACHE, FONT_CACHE];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}

let trimming = false;
async function trimTiles() {
  if (trimming) return;
  trimming = true;
  try {
    const c = await caches.open(TILE_CACHE);
    const keys = await c.keys();
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) await c.delete(keys[i]); // самые старые первыми
  } finally { trimming = false; }
}

async function cacheFirst(req, cacheName, isTile) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') {
      c.put(req, res.clone());
      if (isTile && Math.random() < 0.05) trimTiles();
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

async function shell(req) {
  const c = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), 3000);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' });
    return hit || (await c.match('index.html')) || new Response('Офлайн', { status: 503 });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') return e.respondWith(cacheFirst(req, TILE_CACHE, true));
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(req, FONT_CACHE, false));
  if (url.origin === location.origin) return e.respondWith(shell(req));
});

// Сколько тайлов сохранено — для экрана настроек.
self.addEventListener('message', async (e) => {
  if (e.data === 'tile-count') {
    const keys = await (await caches.open(TILE_CACHE)).keys();
    e.source.postMessage({ tileCount: keys.length, max: MAX_TILES });
  } else if (e.data === 'clear-tiles') {
    await caches.delete(TILE_CACHE);
    e.source.postMessage({ tileCount: 0, max: MAX_TILES });
  }
});

// PoGo Companion service worker: offline app shell + game data, cached sprites.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const IMG = 'img-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA, IMG].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}
async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch { return new Response('', { status: 504 }); }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Sprites & type icons from PokeMiners / Leek Duck
  if (/\.(png|jpg|jpeg|webp|svg)$/i.test(url.pathname) && url.origin !== location.origin) { e.respondWith(cacheFirst(IMG, req)); return; }
  // Live feeds are handled by the app (localStorage cache) — go to network
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('ScrapedDuck')) return;
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) { e.respondWith(staleWhileRevalidate(DATA, req)); return; }
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('./index.html'))); return; }
  e.respondWith(staleWhileRevalidate(SHELL, req));
});

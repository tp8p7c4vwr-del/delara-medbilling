/* Offline cache for deLara MedBilling. Same-origin only; never caches or forwards anything else. */
const V = 'mb-v1-2026-04-01';
const ASSETS = ['./', 'index.html', 'css/app.css', 'js/search.js', 'js/app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'data/meta.json', 'data/codes.json', 'data/rules.json', 'data/modifiers.json', 'data/explanatory.json',
  'data/icd9.json', 'data/bulletins.json', 'data/resources.json'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(V).then(c => c.put(e.request, copy)); return res;
  })));
});

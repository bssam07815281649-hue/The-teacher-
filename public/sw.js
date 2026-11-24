// Only cache public app-shell files. Never cache private school, auth or upload responses.
const CACHE_NAME = 'smart-school-shell-v2';

function isSafeStaticUrl(url) {
  const u = new URL(url, self.location.href);
  const scope = new URL(self.registration.scope);
  if (u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return false;
  if (u.search) return false;
  const suffix = u.pathname.slice(scope.pathname.length);
  if (suffix.includes('..')) return false;
  return suffix === '' || suffix === 'index.html' ||
    suffix === 'manifest.webmanifest' || suffix === 'sw.js' ||
    /^icons\/[\w-]+\.png$/.test(suffix) ||
    /^assets\/[\w.-]+\.(?:js|css|png|jpg|jpeg|svg|woff2?)$/.test(suffix);
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const urls = [
      new URL('./', self.registration.scope).href,
      new URL('manifest.webmanifest', self.registration.scope).href,
      new URL('icons/icon-192.png', self.registration.scope).href,
      new URL('icons/icon-512.png', self.registration.scope).href,
    ];
    await Promise.all(urls.map(async url => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok && response.type !== 'opaque') await cache.put(url, response);
      } catch { /* First install may be offline or asset not yet available. */ }
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('smart-school-shell-') && k !== CACHE_NAME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_STATIC') return;
  const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(urls.filter(isSafeStaticUrl).map(async url => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok && response.type !== 'opaque') await cache.put(url, response);
      } catch { /* Offline remains read-only for cached app-shell assets. */ }
    }));
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isSafeStaticUrl(url.href) && request.mode !== 'navigate') return;
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.includes('/api/') || url.pathname.includes('/uploads/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (request.mode === 'navigate') {
      try {
        const response = await fetch(request);
        // Do not cache arbitrary navigation response paths or personalized HTML.
        if (response.ok && isSafeStaticUrl(url.href)) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) ||
          (await cache.match(new URL('./', self.registration.scope).href)) ||
          Response.error();
      }
    }
    try {
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    } catch {
      return (await cache.match(request)) || Response.error();
    }
  })());
});

// App-shell cache: only public static assets. Never cache school API responses.
const CACHE_NAME = 'smart-school-shell-v1';
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('smart-school-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_STATIC') return;
  const urls=Array.isArray(event.data.urls)?event.data.urls:[];
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE_NAME);
    await Promise.all(urls.map(async raw => {
      try {
        const url=new URL(String(raw),self.location.href);
        if (url.origin!==self.location.origin || url.pathname.includes('/api/')) return;
        const response=await fetch(url.href,{credentials:'same-origin'});
        if (response.ok && response.type!=='opaque') await cache.put(url.href,response);
      } catch { /* Static cache is best effort. */ }
    }));
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request;
  if (request.method!=='GET') return;
  const url=new URL(request.url);
  if (url.origin!==self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try {
      const response=await fetch(request);
      if (response.ok && response.type!=='opaque') await cache.put(request,response.clone());
      return response;
    } catch {
      const cached=await cache.match(request);
      if (cached) return cached;
      if (request.mode==='navigate') {
        const shell=await cache.match(new URL(self.registration.scope).href);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});

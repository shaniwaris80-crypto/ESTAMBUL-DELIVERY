// Cache the public shell only. Never cache API calls, tokens, order details or map tiles.
const CACHE='estambul-v9-shell-2';const SHELL=['./','./index.html','./style.css','./entry.mjs','./map-guard.mjs','./app.mjs','./domain.mjs','./transport.mjs','./demo.mjs','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('estambul-v9-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||u.search||!SHELL.some(p=>new URL(p,self.registration.scope).pathname===u.pathname))return;event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));});

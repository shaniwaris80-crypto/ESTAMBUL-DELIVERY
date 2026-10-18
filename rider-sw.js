/* Cache only the Rider app shell. Do not store orders, accounts or Supabase API responses. */
const CACHE="estambul-rider-shell-v26";
const assets=["./rider.html","./rider.webmanifest","./docs/rider.css","./docs/v2-rider.css","./docs/rider-pro-v3.css","./docs/rider-pro-v4.css","./docs/visual-rider-v5.css","./docs/rider-packing.css","./docs/rider-profiles.js","./docs/rider-items.js","./docs/rider.js","./docs/live-config.js","./docs/icon.svg","./docs/visual-burgos-rider.svg"];
self.addEventListener("install", event => {
 event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("estambul-rider-shell-") && key!==CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
 const request=event.request;
 if(request.method!=="GET")return;
 const reqUrl=new URL(request.url);
 if(reqUrl.origin!==self.location.origin)return; // Never cache Supabase endpoints
 if(!assets.some(path => reqUrl.pathname.endsWith(path.replace("./","/"))))return;
 event.respondWith(fetch(request).then(response => {
  if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache => cache.put(request,copy));}
  return response;
 }).catch(() => caches.match(request)));
});
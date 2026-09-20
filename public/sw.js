const CACHE='torbox-main-v2.0.4';
const SHELL=['./','./index.html','./style.css','./discover.css','./portable-setup.css','./app.js','./runtime.js','./vault.js','./history.js','./settings.js','./watchlist.js','./search-history.js','./source-memory.js','./parental-controls.js','./direct-runtime.js','./portable-setup.js','./portable-setup-ui.js','./vendor/qrcode.js','./vendor/jsqr.js','./playback-errors.js','./discover.js','./source-client.js','./manifest.webmanifest','./icon.svg','./relay-config.json'];
const shellUrls=new Set(SHELL.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(path=>new Request(path,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('torbox-main-v')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||!shellUrls.has(url.origin+url.pathname))return;
 // Never intercept /key/, /direct/, APIs, media, or other apps on this origin.
 const cacheKey=url.origin+url.pathname;
 event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(cacheKey,clone)));}return response;}).catch(()=>caches.open(CACHE).then(c=>c.match(cacheKey))));
});

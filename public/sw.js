const CACHE_PREFIX='torbox-player:'+self.registration.scope+':';
const CACHE=CACHE_PREFIX+'release-1.2.2-games.2';
const BUILD='release-1.2.2-games.2';
const SHELL=[
  './','./index.html',
  `./style.css?v=${BUILD}`,`./discover.css?v=${BUILD}`,`./boot.js?v=${BUILD}`,`./app.js?v=${BUILD}`,
  `./playback-lifecycle.js?v=${BUILD}`,`./runtime.js?v=${BUILD}`,`./history.js?v=${BUILD}`,`./settings.js?v=${BUILD}`,`./vault.js?v=${BUILD}`,
  `./watchlist.js?v=${BUILD}`,`./search-history.js?v=${BUILD}`,`./source-memory.js?v=${BUILD}`,`./parental-controls.js?v=${BUILD}`,
  `./device-transfer.js?v=${BUILD}`,`./playback-errors.js?v=${BUILD}`,`./discover.js?v=${BUILD}`,`./source-client.js?v=${BUILD}`,
  `./sports-player.html?v=${BUILD}`,`./sports-player.js?v=${BUILD}`,`./sports-player.css?v=${BUILD}`,`./sports.js?v=${BUILD}`,`./sports-core.js?v=${BUILD}`,`./sports.css?v=${BUILD}`,`./sports-catalog.json?v=${BUILD}`,`./hls.min.js?v=${BUILD}`,
  `./buffstreams.js?v=${BUILD}`,`./buffstreams-ui.js?v=${BUILD}`,`./buffstreams-opening.html?v=${BUILD}`,`./buffstreams-opening.css?v=${BUILD}`,
  `./games-nav.js?v=${BUILD}`,`./games.js?v=${BUILD}`,`./games-core.js?v=${BUILD}`,`./games.css?v=${BUILD}`,`./games-catalog.json?v=${BUILD}`,
  `./games-pointer.js?v=${BUILD}`,
  './vendor/jsnes-2.1.0.min.js?v=2.1.0',`./vendor/nes-audio-worklet.js?v=${BUILD}`,
  `./manifest.webmanifest?v=${BUILD}`,'./icon.svg'
];
const shellUrls=new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
const fresh=request=>fetch(new Request(request,{cache:'no-store'}));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{for(const path of SHELL){const response=await fresh(new Request(new URL(path,self.registration.scope)));if(!response.ok)throw new Error('shell fetch failed');await cache.put(new Request(new URL(path,self.registration.scope)),response);}}).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(event.request.mode!=='navigate'&&!shellUrls.has(event.request.url))return;
  event.respondWith(fresh(event.request).then(response=>{
    if(response.ok&&shellUrls.has(event.request.url)){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.open(CACHE).then(async cache=>{if(url.pathname.endsWith('/sports-player.html')||url.pathname.endsWith('/buffstreams-opening.html'))return (await cache.match(event.request))||new Response('Sports player unavailable offline.',{status:503});return event.request.mode==='navigate'?cache.match('./'):cache.match(event.request);})));
});

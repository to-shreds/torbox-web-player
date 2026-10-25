const CACHE_PREFIX='torbox-player:'+self.registration.scope+':';
const CACHE=CACHE_PREFIX+'release-1.2.10-audio.1';
const BUILD='release-1.2.10-audio.1';
const STATIC_BUILD='release-1.2.8-party.1';
const SHELL=[
  './','./index.html',
  `./style.css?v=${STATIC_BUILD}`,`./discover.css?v=${STATIC_BUILD}`,`./boot.js?v=${BUILD}`,`./app.js?v=${BUILD}`,`./trakt.js?v=${BUILD}`,`./trakt-vault.js?v=${BUILD}`,`./trakt.css?v=${BUILD}`,
  `./playback-lifecycle.js?v=${BUILD}`,`./runtime.js?v=${STATIC_BUILD}`,`./history.js?v=${STATIC_BUILD}`,`./settings.js?v=${STATIC_BUILD}`,`./vault.js?v=${STATIC_BUILD}`,
  `./watchlist.js?v=${STATIC_BUILD}`,`./search-history.js?v=${STATIC_BUILD}`,`./source-memory.js?v=${STATIC_BUILD}`,`./parental-controls.js?v=${STATIC_BUILD}`,
  `./device-transfer.js?v=${STATIC_BUILD}`,`./playback-errors.js?v=${STATIC_BUILD}`,`./discover.js?v=${BUILD}`,`./source-client.js?v=${STATIC_BUILD}`,
  `./sports-player.html?v=${STATIC_BUILD}`,`./sports-player.js?v=${STATIC_BUILD}`,`./sports-player.css?v=${STATIC_BUILD}`,`./sports.js?v=${STATIC_BUILD}`,`./sports-core.js?v=${STATIC_BUILD}`,`./sports.css?v=${STATIC_BUILD}`,`./sports-catalog.json?v=${STATIC_BUILD}`,`./hls.min.js?v=${STATIC_BUILD}`,
  `./buffstreams.js?v=${STATIC_BUILD}`,`./buffstreams-ui.js?v=${STATIC_BUILD}`,`./buffstreams-opening.html?v=${STATIC_BUILD}`,`./buffstreams-opening.css?v=${STATIC_BUILD}`,
  `./games-nav.js?v=${STATIC_BUILD}`,`./games.js?v=${STATIC_BUILD}`,`./games-core.js?v=${STATIC_BUILD}`,`./games.css?v=${STATIC_BUILD}`,`./games-catalog.json?v=${STATIC_BUILD}`,
  `./games-pointer.js?v=${STATIC_BUILD}`,
  `./games-cheats.js?v=${STATIC_BUILD}`,
  `./watch-party.js?v=${STATIC_BUILD}`,`./watch-party-core.js?v=${STATIC_BUILD}`,`./watch-party.css?v=${STATIC_BUILD}`,
  `./extra-games.js?v=${STATIC_BUILD}`,`./extra-games-core.js?v=${STATIC_BUILD}`,`./extra-games-catalog.json?v=${STATIC_BUILD}`,
  `./dos-player.html?v=${STATIC_BUILD}`,`./dos-player.js?v=${STATIC_BUILD}`,`./dos-player.css?v=${STATIC_BUILD}`,
  `./games-web/skifree/index.html?v=${STATIC_BUILD}`,`./games-web/skifree/game.js?v=${STATIC_BUILD}`,`./games-web/skifree/style.css?v=${STATIC_BUILD}`,
  './vendor/jsnes-2.1.0-torbox.1.min.js?v=2.1.0-torbox.1',`./vendor/nes-audio-worklet.js?v=${STATIC_BUILD}`,
  `./manifest.webmanifest?v=${STATIC_BUILD}`,'./icon.svg'
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
  }).catch(()=>caches.open(CACHE).then(async cache=>{if(url.pathname.endsWith('/sports-player.html')||url.pathname.endsWith('/buffstreams-opening.html'))return (await cache.match(event.request))||new Response('Sports player unavailable offline.',{status:503});if(url.pathname.endsWith('/dos-player.html')||url.pathname.includes('/games-web/'))return (await cache.match(event.request))||new Response('Game unavailable offline. Reconnect and open it again.',{status:503});return event.request.mode==='navigate'?cache.match('./'):cache.match(event.request);})));
});

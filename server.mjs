import { SourceLookup, MultiSourceLookup, SourceLookupError } from './lib/source-lookup.mjs';
import { Discovery, discoveryBody } from './lib/discovery.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Sessions, Limiter, GuestInvites, verifyPassword, validHash } from './lib/auth.mjs';
import { ProgressStore, VIEWERS, validViewer } from './lib/progress.mjs';
import { MediaTickets, validatedRange } from './lib/media.mjs';
import { TorBox, AppError, parseVideoId, validatedPlaybackUrl, safePlaybackUrl, TORBOX_MEDIA_HOSTS } from './lib/torbox.mjs';
import { Catalog } from './lib/catalog.mjs';
import { DriveTransferTests } from './lib/drive-share.mjs';
import { TorBoxStatusChecker } from './lib/torbox-status.mjs';
import { SetupTransfers } from './lib/setup-transfer.mjs';
import { WatchParties, prepareExactPartyFile, prepareHostedPartyFile, samePartyMedia } from './lib/watch-party.mjs';
import { browserContainerHints } from './public/source-client.js';
const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/setup', ['setup.html', 'text/html; charset=utf-8']],
  ['/setup.html', ['setup.html', 'text/html; charset=utf-8']],
  ['/recover', ['recover/index.html', 'text/html; charset=utf-8']],
  ['/recover/', ['recover/index.html', 'text/html; charset=utf-8']],
  ['/recover/index.html', ['recover/index.html', 'text/html; charset=utf-8']],
  ['/boot.js', ['boot.js', 'text/javascript; charset=utf-8']],
  ['/watch-party.js', ['watch-party.js', 'text/javascript; charset=utf-8']],
  ['/watch-party-core.js', ['watch-party-core.js', 'text/javascript; charset=utf-8']],
  ['/watch-party.css', ['watch-party.css', 'text/css; charset=utf-8']],
  ['/games-nav.js', ['games-nav.js', 'text/javascript; charset=utf-8']],
  ['/games.js', ['games.js', 'text/javascript; charset=utf-8']],
  ['/games-core.js', ['games-core.js', 'text/javascript; charset=utf-8']],
  ['/games-pointer.js', ['games-pointer.js', 'text/javascript; charset=utf-8']],
  ['/games-cheats.js', ['games-cheats.js', 'text/javascript; charset=utf-8']],
  ['/extra-games.js', ['extra-games.js', 'text/javascript; charset=utf-8']],
  ['/extra-games-core.js', ['extra-games-core.js', 'text/javascript; charset=utf-8']],
  ['/extra-games-catalog.json', ['extra-games-catalog.json', 'application/json; charset=utf-8']],
  ['/dos-player.html', ['dos-player.html', 'text/html; charset=utf-8']],
  ['/dos-player.js', ['dos-player.js', 'text/javascript; charset=utf-8']],
  ['/dos-player.css', ['dos-player.css', 'text/css; charset=utf-8']],
  ['/vendor/dos/emulators.js', ['vendor/dos/emulators.js', 'text/javascript; charset=utf-8']],
  ['/vendor/dos/wdosbox.js', ['vendor/dos/wdosbox.js', 'text/javascript; charset=utf-8']],
  ['/vendor/dos/wdosbox.wasm', ['vendor/dos/wdosbox.wasm', 'application/wasm']],
  ['/vendor/dos/wlibzip.js', ['vendor/dos/wlibzip.js', 'text/javascript; charset=utf-8']],
  ['/vendor/dos/wlibzip.wasm', ['vendor/dos/wlibzip.wasm', 'application/wasm']],
  ['/vendor/dos/LICENSE', ['vendor/dos/LICENSE', 'text/plain; charset=utf-8']],
  ['/vendor/dos/SOURCES.md', ['vendor/dos/SOURCES.md', 'text/markdown; charset=utf-8']],
  ['/vendor/dos/THIRD-PARTY-NOTICES.txt', ['vendor/dos/THIRD-PARTY-NOTICES.txt', 'text/plain; charset=utf-8']],
  ['/vendor/dos/SOURCE-PROVENANCE.json', ['vendor/dos/SOURCE-PROVENANCE.json', 'application/json; charset=utf-8']],
  ['/vendor/dos/emulators-8.5.2-source.tar.gz', ['vendor/dos/emulators-8.5.2-source.tar.gz', 'application/gzip']],
  ['/games-data/dosdefender.jsdos', ['games-data/dosdefender.jsdos', 'application/octet-stream']],
  ['/games-data/master-mind.jsdos', ['games-data/master-mind.jsdos', 'application/octet-stream']],
  ['/games-data/zmiy.jsdos', ['games-data/zmiy.jsdos', 'application/octet-stream']],
  ['/games-data/licenses/dosdefender-UNLICENSE.txt', ['games-data/licenses/dosdefender-UNLICENSE.txt', 'text/plain; charset=utf-8']],
  ['/games-data/licenses/master-mind-CC0-readme.txt', ['games-data/licenses/master-mind-CC0-readme.txt', 'text/plain; charset=utf-8']],
  ['/games-data/licenses/zmiy-BSD-2-Clause-readme.txt', ['games-data/licenses/zmiy-BSD-2-Clause-readme.txt', 'text/plain; charset=utf-8']],
  ['/games-data/sources/dosdefender-source-40e98d2.zip', ['games-data/sources/dosdefender-source-40e98d2.zip', 'application/zip']],
  ['/games-data/sources/zmiy-freedos-source-and-binary-0.85.2a.zip', ['games-data/sources/zmiy-freedos-source-and-binary-0.85.2a.zip', 'application/zip']],
  ['/games-web/skifree/index.html', ['games-web/skifree/index.html', 'text/html; charset=utf-8']],
  ['/games-web/skifree/game.js', ['games-web/skifree/game.js', 'text/javascript; charset=utf-8']],
  ['/games-web/skifree/style.css', ['games-web/skifree/style.css', 'text/css; charset=utf-8']],
  ['/games-web/skifree/LICENSE', ['games-web/skifree/LICENSE', 'text/plain; charset=utf-8']],
  ['/games-web/skifree/UPSTREAM.md', ['games-web/skifree/UPSTREAM.md', 'text/markdown; charset=utf-8']],
  ['/games.css', ['games.css', 'text/css; charset=utf-8']],
  ['/games-catalog.json', ['games-catalog.json', 'application/json; charset=utf-8']],
  ['/vendor/jsnes-2.1.0.min.js', ['vendor/jsnes-2.1.0.min.js', 'text/javascript; charset=utf-8']],
  ['/vendor/jsnes-2.1.0-torbox.1.min.js', ['vendor/jsnes-2.1.0-torbox.1.min.js', 'text/javascript; charset=utf-8']],
  ['/vendor/jsnes-2.1.0-torbox.1.patch', ['vendor/jsnes-2.1.0-torbox.1.patch', 'text/plain; charset=utf-8']],
  ['/vendor/nes-audio-worklet.js', ['vendor/nes-audio-worklet.js', 'text/javascript; charset=utf-8']],
  ['/vendor/jsnes-2.1.0.LICENSE.txt', ['vendor/jsnes-2.1.0.LICENSE.txt', 'text/plain; charset=utf-8']],
  ['/sports.js', ['sports.js', 'text/javascript; charset=utf-8']],
  ['/buffstreams.js', ['buffstreams.js', 'text/javascript; charset=utf-8']],
  ['/buffstreams-ui.js', ['buffstreams-ui.js', 'text/javascript; charset=utf-8']],
  ['/buffstreams-opening.html', ['buffstreams-opening.html', 'text/html; charset=utf-8']],
  ['/buffstreams-opening.css', ['buffstreams-opening.css', 'text/css; charset=utf-8']],
  ['/sports-core.js', ['sports-core.js', 'text/javascript; charset=utf-8']],
  ['/sports.css', ['sports.css', 'text/css; charset=utf-8']],
  ['/sports-player.html', ['sports-player.html', 'text/html; charset=utf-8']],
  ['/sports-player.js', ['sports-player.js', 'text/javascript; charset=utf-8']],
  ['/sports-player.css', ['sports-player.css', 'text/css; charset=utf-8']],
  ['/sports-catalog.json', ['sports-catalog.json', 'application/json; charset=utf-8']],
  ['/hls.min.js', ['hls.min.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/runtime.js', ['runtime.js', 'text/javascript; charset=utf-8']],
  ['/playback-lifecycle.js', ['playback-lifecycle.js', 'text/javascript; charset=utf-8']],
  ['/vault.js', ['vault.js', 'text/javascript; charset=utf-8']],
  ['/history.js', ['history.js', 'text/javascript; charset=utf-8']],
  ['/settings.js', ['settings.js', 'text/javascript; charset=utf-8']],
  ['/watchlist.js', ['watchlist.js', 'text/javascript; charset=utf-8']],
  ['/search-history.js', ['search-history.js', 'text/javascript; charset=utf-8']],
  ['/source-memory.js', ['source-memory.js', 'text/javascript; charset=utf-8']],
  ['/parental-controls.js', ['parental-controls.js', 'text/javascript; charset=utf-8']],
  ['/device-transfer.js', ['device-transfer.js', 'text/javascript; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml; charset=utf-8']],
  ['/playback-errors.js', ['playback-errors.js', 'text/javascript; charset=utf-8']],
  ['/discover.js', ['discover.js', 'text/javascript; charset=utf-8']],
  ['/source-client.js', ['source-client.js', 'text/javascript; charset=utf-8']],
  ['/discover.css', ['discover.css', 'text/css; charset=utf-8']],
  ['/password.js', ['password.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
function cookieId(request) {
  const item = (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('tw_session='));
  return item ? item.slice('tw_session='.length) : '';
}
function bearerId(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || '');
  return match ? match[1] : '';
}
async function body(request, maxBytes = 8192) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new AppError('JSON_REQUIRED', 'Send a JSON request.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError('REQUEST_TOO_LARGE', 'This request is too large.', 413);
    chunks.push(chunk);
  }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new AppError('INVALID_JSON', 'This request could not be read.', 400); }
}

const TORBOX_RELAY_PREFIX='/relay/torbox/';
const TORBOX_RELAY_RULES=Object.freeze({
  'user/me':Object.freeze({method:'GET',query:new Set(['settings'])}),
  'torrents/checkcached':Object.freeze({method:'GET',query:new Set(['hash','format','list_files'])}),
  'torrents/mylist':Object.freeze({method:'GET',query:new Set(['id','offset','limit','bypass_cache'])}),
  'torrents/createtorrent':Object.freeze({method:'POST',query:new Set()}),
  'torrents/requestdl':Object.freeze({method:'GET',query:new Set(['torrent_id','file_id','zip_link','redirect']),tokenInQuery:true})
});
function relayApiKey(request){
  const match=/^Bearer ([^\u0000-\u001f\u007f]{8,512})$/.exec(request.headers.authorization||'');
  if(!match)throw new AppError('RELAY_AUTH_REQUIRED','A TorBox API key is required for this bridge request.',401);
  return match[1];
}
function relayRule(path,method){
  if(!path.startsWith(TORBOX_RELAY_PREFIX))return null;
  const route=path.slice(TORBOX_RELAY_PREFIX.length),rule=TORBOX_RELAY_RULES[route];
  if(!rule)throw new AppError('RELAY_ROUTE_NOT_ALLOWED','That TorBox route is not allowed through this bridge.',404);
  if(method!==rule.method)throw new AppError('RELAY_METHOD_NOT_ALLOWED','That method is not allowed for this TorBox route.',405);
  return {route,rule};
}
function relayQuery(input,allowed){
  const output=new URLSearchParams();
  for(const [name,value] of input){
    if(!allowed.has(name))throw new AppError('RELAY_QUERY_NOT_ALLOWED','That TorBox query parameter is not allowed.',400);
    if(value.length>512||/[\u0000-\u001f\u007f]/.test(value))throw new AppError('RELAY_QUERY_INVALID','A TorBox query parameter is invalid.',400);
    output.append(name,value);
  }
  return output;
}
async function torboxRelayRequest(request,url,{fetchFn=fetch,backend='render'}={}){
  const selected=relayRule(url.pathname,request.method);
  if(!selected)return null;
  const key=relayApiKey(request),query=relayQuery(url.searchParams,selected.rule.query);
  const upstream=new URL(selected.route,'https://api.torbox.app/v1/api/');
  for(const [name,value] of query)upstream.searchParams.append(name,value);
  const headers={Accept:'application/json'};
  let bodyValue;
  if(selected.rule.tokenInQuery)upstream.searchParams.set('token',key);
  else headers.Authorization='Bearer '+key;
  if(selected.route==='torrents/createtorrent'){
    const data=await body(request,4096),hash=typeof data.hash==='string'?data.hash.toLowerCase():'';
    if(!/^[a-f0-9]{40}$/.test(hash))throw new AppError('RELAY_HASH_INVALID','A valid torrent hash is required.',400);
    const form=new FormData();
    form.set('magnet','magnet:?xt=urn:btih:'+hash);
    form.set('allow_zip','false');
    form.set('add_only_if_cached',String(data.onlyCached===true));
    bodyValue=form;
  }
  let upstreamResponse;
  try{
    upstreamResponse=await fetchFn(upstream,{
      method:selected.rule.method,
      headers,
      ...(bodyValue?{body:bodyValue}:{}),
      redirect:'error',
      signal:AbortSignal.timeout(20000)
    });
  }catch(error){
    if(['TimeoutError','AbortError'].includes(error?.name))throw new AppError('RELAY_UPSTREAM_TIMEOUT','TorBox took too long to respond through this bridge.',504);
    throw new AppError('RELAY_UPSTREAM_UNAVAILABLE','This bridge could not reach TorBox.',502);
  }
  const contentType=upstreamResponse.headers.get('content-type')||'';
  if(!/^application\/json(?:;|$)/i.test(contentType)){
    await upstreamResponse.body?.cancel();
    throw new AppError('RELAY_INVALID_RESPONSE','The bridge accepts TorBox JSON only. Video must play directly from TorBox.',502);
  }
  const chunks=[];let size=0;
  const reader=upstreamResponse.body?.getReader();
  try{
    while(reader){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>8*1024*1024)throw new AppError('RELAY_RESPONSE_TOO_LARGE','TorBox returned too much data through this bridge.',502);
      chunks.push(Buffer.from(value));
    }
  }finally{await reader?.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks);
  return {
    status:upstreamResponse.status,
    body:bytes,
    contentType:upstreamResponse.headers.get('content-type')||'application/json; charset=utf-8',
    retryAfter:upstreamResponse.headers.get('retry-after')||'',
    backend
  };
}
function sendRelay(response,result){
  response.statusCode=result.status;
  response.setHeader('Content-Type',result.contentType);
  response.setHeader('X-TorBox-Bridge',result.backend);
  response.setHeader('Cache-Control','no-store, private');
  if(result.retryAfter)response.setHeader('Retry-After',result.retryAfter);
  response.end(Buffer.from(result.body));
}
export function createApp({ env = process.env, provider, providerFactory, mediaFetch = fetch, discoveryFetch = fetch, discoveryService, sourceLookupService, driveTransferService, now = Date.now } = {}) {
  const production = env.NODE_ENV === 'production';
  const origin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 10000}`;
  const passwordHash = env.HOUSEHOLD_PASSWORD_HASH || '';
  const apiKeyMode = env.AUTH_MODE === 'api-key';
  const frontendOrigins = new Set((env.FRONTEND_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
  frontendOrigins.add(origin);
  const trustedOrigin = value => typeof value === 'string' && frontendOrigins.has(value);
  const applyCors = (request, response) => {
    const value = request.headers.origin;
    if (!trustedOrigin(value)) return false;
    response.setHeader('Access-Control-Allow-Origin', value);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token, Range');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Retry-After, X-TorBox-Bridge');
    return true;
  };
  const sessions = new Sessions(now), progress = new ProgressStore(), mediaTickets = new MediaTickets(now), guestInvites = new GuestInvites(now), driveTransfers = driveTransferService || new DriveTransferTests({ now }), torboxStatus = new TorBoxStatusChecker({ fetchFn: discoveryFetch, now }), setupTransfers = new SetupTransfers({ now }), watchParties = new WatchParties(now);
  const partyCreateRate = new Limiter(6, 60000, now), partyJoinRate = new Limiter(15, 60000, now), partySyncRate = new Limiter(240, 60000, now), partyPrepareRate = new Limiter(8, 60000, now);
  const loginRate = new Limiter(15, 15 * 60000, now), operationRate = new Limiter(30, 60000, now), progressRate = new Limiter(120, 60000, now), transferCreateRate = new Limiter(6, 60000, now), transferRedeemRate = new Limiter(30, 60000, now);
  let activeLogins = 0;
  const mediaHosts = (env.MEDIA_HOST_SUFFIXES || TORBOX_MEDIA_HOSTS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const torbox = provider || new TorBox({ key: env.TORBOX_API_KEY || '', mediaHosts });
  const makeProvider = key => providerFactory ? providerFactory(key) : new TorBox({ key, mediaHosts });
  // Catalog metadata is public. Share its cache across devices, never their account data.
  const catalog = new Catalog({ fetchFn: discoveryFetch, now });
  const discovery = discoveryService || new Discovery({ provider: torbox, fetchFn: discoveryFetch, catalog, now });
  const sourceMode = env.SOURCE_PROVIDER || 'zilean';
  const sourceLookup = sourceLookupService || (sourceMode === 'multi'
    ? new MultiSourceLookup({ fetchFn: discoveryFetch, now })
    : new SourceLookup({ fetchFn: discoveryFetch, now, provider: sourceMode }));
  const catalogRate = new Limiter(90, 60000, now), preparationRate = new Limiter(8, 60000, now);
  const configured = apiKeyMode || validHash(passwordHash);
  const setCookie = (response, value, maxAge = 30 * 86400) => response.setHeader('Set-Cookie', `tw_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`);
  const revokePartyGuest = session => {
    mediaTickets.revokeSession(session.id); watchParties.revokeSession(session.id); sessions.revoke(session.id);
  };
  const partyAccess = session => {
    if (!session?.partyGuest) return null;
    try {
      sessions.prune();
      const { room, member } = watchParties.get(session.partyRoomId, session.id);
      const host = sessions.rows.get(room.host.sessionId), proof = watchParties.proofs.get(room.host.sessionId);
      if (!sessions.rows.has(session.id) || member !== room.guest || !host || host.guest || host.id !== session.ownerId ||
        (host.provider || torbox) !== session.provider || !room.host.proof || proof?.proof !== room.host.proof || !samePartyMedia(proof.identity, room.media.identity)) throw new Error('Party authorization ended');
      return { room, member, host, proof };
    } catch {
      revokePartyGuest(session);
      throw new AppError('WATCH_PARTY_ENDED', 'This watch party ended or the host’s connection changed.', 401);
    }
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://images.metahub.space https://image.tmdb.org https://m.media-amazon.com; media-src 'self' https://torbox.app https://*.torbox.app https://*.tb-cdn.cx https://*.tb-cdn.io https://*.tb-cdn.pw https://*.tb-cdn.sh https://*.tb-cdn.st https://*.tb-cdn.to https://*.tb-cdn.earth; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url || '/', origin), path = url.pathname, method = request.method;
      const corsAllowed = applyCors(request, response);
      if (method === 'OPTIONS') {
        if (!corsAllowed) throw new AppError('BAD_ORIGIN', 'This frontend is not allowed to use the private API.', 403);
        response.statusCode = 204; response.end(); return;
      }
      if (method === 'GET' && path === '/healthz') return json(response, 200, { ok: true, version: '1.2.8', stage: 'catalog-first-preview' });
      if (method === 'GET' && path === '/relay/health') {
        if(!corsAllowed)throw new AppError('BAD_ORIGIN','This frontend is not allowed to use the TorBox bridge.',403);
        response.setHeader('X-TorBox-Bridge','render');
        return json(response,200,{ok:true,bridge:'render',protocol:1});
      }
      if (path.startsWith(TORBOX_RELAY_PREFIX)) {
        if(!corsAllowed)throw new AppError('BAD_ORIGIN','This frontend is not allowed to use the TorBox bridge.',403);
        const relayed=await torboxRelayRequest(request,url,{fetchFn:discoveryFetch,backend:'render'});
        return sendRelay(response,relayed);
      }
      if (method === 'GET' && path === '/robots.txt') { response.writeHead(200, { 'Content-Type': 'text/plain' }); return response.end('User-agent: *\nDisallow: /\n'); }
      // Public ROMs are flat, explicitly named files. Never resolve caller paths.
      if (method === 'GET' && /^\/roms\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.nes$/i.test(path)) {
        try { const data=await readFile(join(root,'public','roms',path.slice('/roms/'.length)));response.setHeader('Content-Type','application/octet-stream');return response.end(data); }
        catch(error) { if(error.code==='ENOENT')throw new AppError('NOT_FOUND','That game file was not found.',404);throw error; }
      }
      if (method === 'GET' && publicFiles.has(path)) {
        const [filename, type] = publicFiles.get(path);
        if(filename==='index.html'){const html=await readFile(join(root,'public',filename),'utf8');const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];if(csp)response.setHeader('Content-Security-Policy',csp+"; frame-ancestors 'none'");response.setHeader('Content-Type',type);return response.end(html);}
        if(filename==='sports-player.html'||filename==='dos-player.html'||filename==='games-web/skifree/index.html'){
          const html=await readFile(join(root,'public',filename),'utf8');
          const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
          if(csp)response.setHeader('Content-Security-Policy',csp+"; frame-ancestors 'self'");
          response.setHeader('X-Frame-Options','SAMEORIGIN');response.setHeader('Content-Type',type);return response.end(html);
        }
        response.setHeader('Content-Type', type); return response.end(await readFile(join(root, 'public', filename)));
      }

      const bearer = bearerId(request), cookie = cookieId(request), sessionToken = bearer || cookie;
      const session = configured ? sessions.read(sessionToken) : null;
      const bearerSession = !!bearer && !!session;
      if (session?.partyGuest) partyAccess(session);
      if (path.startsWith('/media/')) {
        if (!['GET', 'HEAD'].includes(method)) throw new AppError('METHOD_NOT_ALLOWED', 'This media request method is not allowed.', 405);
        const mediaId = path.slice('/media/'.length);
        let ticket = session ? mediaTickets.read(mediaId, session.id) : mediaTickets.readAny(mediaId);
        // Native video cannot attach the temporary bearer token. An owner cookie
        // preserved for a signed-in guest must not hide its separate party ticket.
        if (!ticket) {
          const candidate = mediaTickets.readAny(mediaId);
          if (sessions.rows.get(candidate?.sessionId)?.partyGuest) ticket = candidate;
        }
        sessions.prune();
        const ticketSession = ticket ? sessions.rows.get(ticket.sessionId) : null;
        if (!ticket || !ticketSession) {
          if (ticket && !ticketSession) mediaTickets.revokeSession(ticket.sessionId);
          if (!session) throw new AppError('LOGIN_REQUIRED', 'This playback ticket is no longer available. Reopen the video.', 401);
          throw new AppError('MEDIA_NOT_FOUND', 'This playback session is no longer available. Reopen the video.', 404);
        }
        let partyMediaAccess = null;
        if (ticketSession.partyGuest) {
          partyMediaAccess = partyAccess(ticketSession);
          if (!ticketSession.allowedVideos?.has(ticket.videoId)) throw new AppError('GUEST_FORBIDDEN', 'This playback is outside the watch party.', 403);
        }
        const range = validatedRange(request.headers.range);
        // Never fetch media here. Owners and eligible guests get header-only redirects.
        const directUrl = ticketSession.guest && !partyMediaAccess?.room.allowAccountKeyInPlayback
          ? safePlaybackUrl(ticket.upstreamUrl, (ticketSession.provider || torbox).key, mediaHosts)
          : validatedPlaybackUrl(ticket.upstreamUrl, mediaHosts);
        response.statusCode = 307;
        response.setHeader('Location', directUrl);
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('X-Media-Delivery', 'direct');
        console.log(JSON.stringify({ event: 'media_redirect_issued', ranged: !!range }));
        response.end();
        return;
      }
      if (!path.startsWith('/api/')) throw new AppError('NOT_FOUND', 'Page not found.', 404);
      if (!['GET', 'HEAD'].includes(method) && !trustedOrigin(request.headers.origin)) throw new AppError('BAD_ORIGIN', 'Reload the website before trying again.', 403);
      if (path === '/api/session' && method === 'GET') return json(response, 200, { authenticated: !!session, setupRequired: !configured, authMode: apiKeyMode ? 'api-key' : 'household', ...(session ? { csrf: session.csrf, viewers: VIEWERS, durable: false, guest: session.guest === true, scope: session.guest ? session.scope : undefined, ...(session.partyGuest ? { partyGuest: true, partyRoomId: session.partyRoomId, partySnapshot: watchParties.snapshot(partyAccess(session).room, session.id), expiresAt: new Date(session.expires).toISOString() } : {}), keyConfigured: session.guest ? true : (apiKeyMode ? !!session.provider : !!(env.TORBOX_API_KEY || provider)) } : {}) });
      if (path === '/api/watch-party/join' && method === 'POST') {
        if (!partyJoinRate.allow('ip:' + (request.socket.remoteAddress || 'unknown'))) throw new AppError('SLOW_DOWN', 'Please wait before trying another party link.', 429);
        const data = await body(request, 8192), room = watchParties.invited(data.token);
        sessions.prune();
        const host = sessions.rows.get(room.host.sessionId), proof = watchParties.proofs.get(room.host.sessionId);
        if (!host || host.guest || !room.host.proof || proof?.proof !== room.host.proof || !samePartyMedia(proof.identity, room.media.identity)) {
          watchParties.remove(room);
          throw new AppError('WATCH_PARTY_NOT_FOUND', 'The host is no longer sharing this playback. Ask for a new party link.', 404);
        }
        // Retrying a lost response from the same guest keeps its existing seat.
        if (session?.partyGuest && session.partyRoomId === room.id) return json(response, 200, {
          ...watchParties.join(session.id, data.token), sessionToken, csrf: session.csrf, guest: true, partyGuest: true, scope: session.scope, expiresAt: new Date(session.expires).toISOString()
        });
        const created = sessions.create();
        if (!created) throw new AppError('SESSION_LIMIT', 'Too many temporary sessions are open. Try again later.', 429);
        let joined;
        try { joined = watchParties.join(created.row.id, data.token); }
        catch (error) { sessions.revoke(created.row.id); throw error; }
        Object.assign(created.row, { guest: true, partyGuest: true, partyRoomId: room.id, ownerId: host.id,
          scope: { ...room.media.target, name: room.media.title }, provider: host.provider || torbox, allowedVideos: new Set(),
          expires: Math.min(created.row.expires, room.expires, host.expires) });
        if (!session || session.guest) setCookie(response, created.id, Math.max(1, Math.floor((created.row.expires - now()) / 1000)));
        return json(response, 200, { ...joined, sessionToken: created.id, csrf: created.row.csrf, guest: true, partyGuest: true, scope: created.row.scope, expiresAt: new Date(created.row.expires).toISOString() });
      }
      if (path === '/api/setup-transfer' && method === 'GET') {
        if (!transferRedeemRate.allow(request.socket.remoteAddress || 'unknown')) throw new AppError('SLOW_DOWN', 'Too many transfer attempts. Try again in a minute.', 429);
        const row=setupTransfers.take(url.searchParams.get('id')||'');
        if(!row)throw new AppError('TRANSFER_NOT_FOUND','This setup transfer expired, was already used, or the link is not valid.',404);
        return json(response,200,{envelope:row.envelope,expiresAt:new Date(row.expires).toISOString()});
      }
      if (path === '/api/login' && method === 'POST') {
        if (!configured) throw new AppError('SETUP_REQUIRED', 'This clone is not configured for authentication.', 503);
        if (!loginRate.allow('household') || activeLogins >= 2) throw new AppError('LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again in 15 minutes.', 429);
        const data = await body(request);
        let sessionProvider = null, sessionDiscovery = null;
        activeLogins++;
        try {
          if (apiKeyMode) {
            const key = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
            if (key.length < 8 || key.length > 512 || /[\u0000-\u001f\u007f]/.test(key)) throw new AppError('BAD_API_KEY', 'Enter a valid TorBox API key.', 401);
            sessionProvider = makeProvider(key);
            await sessionProvider.account();
            sessionDiscovery = new Discovery({ provider: sessionProvider, fetchFn: discoveryFetch, catalog, now });
          } else {
            const ok = await verifyPassword(data.password, passwordHash);
            if (!ok) throw new AppError('WRONG_PASSWORD', 'That household password did not match.', 401);
          }
        } finally { activeLogins--; }
        const created = sessions.create();
        if (!created) throw new AppError('SESSION_LIMIT', 'The session limit was reached. Restart the service to revoke old sessions.', 429);
        if (apiKeyMode) { created.row.provider = sessionProvider; created.row.discovery = sessionDiscovery; }
        if (session) { (session.discovery || discovery).revoke(session.id); mediaTickets.revokeSession(session.id); watchParties.revokeSession(session.id); sessions.revoke(session.id); }
        setCookie(response, created.id); return json(response, 200, { ok: true, csrf: created.row.csrf, sessionToken: created.id, authMode: apiKeyMode ? 'api-key' : 'household' });
      }
      if (path === '/api/guest/accept' && method === 'POST') {
        const data = await body(request), invite = guestInvites.read(data.token);
        if (!invite) throw new AppError('GUEST_LINK_INVALID', 'This temporary access link has expired or is no longer valid.', 401);
        sessions.prune();
        const owner = sessions.rows.get(invite.ownerId);
        if (!owner || owner.expires <= now() || !owner.provider) throw new AppError('GUEST_LINK_INVALID', 'The person who shared this title is no longer signed in. Ask them for a new link.', 401);
        const created = sessions.create();
        if (!created) throw new AppError('SESSION_LIMIT', 'Too many temporary sessions are open. Ask for a new link later.', 429);
        created.row.guest = true;
        created.row.ownerId = owner.id;
        created.row.scope = { ...invite.scope };
        created.row.provider = owner.provider;
        created.row.discovery = new Discovery({ provider: owner.provider, fetchFn: discoveryFetch, catalog, now });
        created.row.allowedVideos = new Set();
        created.row.expires = Math.min(created.row.expires, invite.expires);
        setCookie(response, created.id, Math.max(1, Math.floor((created.row.expires - now()) / 1000)));
        return json(response, 200, { ok: true, guest: true, scope: created.row.scope, csrf: created.row.csrf, sessionToken: created.id, expiresAt: new Date(created.row.expires).toISOString() });
      }
      if (!session) throw new AppError('LOGIN_REQUIRED', apiKeyMode ? 'Enter your TorBox API key to sign in.' : 'Sign in to your household first.', 401);
      if (session.partyGuest && !['/api/watch-party/prepare', '/api/watch-party/sync', '/api/watch-party/leave', '/api/playback', '/api/progress', '/api/logout'].includes(path)) throw new AppError('GUEST_FORBIDDEN', 'This temporary session is limited to the watch party’s exact video.', 403);
      const activeProvider = session.provider || torbox;
      const activeDiscovery = session.discovery || discovery;
      const guestScope = session.guest ? session.scope : null;
      const guestAllows = target => !guestScope || !!target && target.type === guestScope.type && target.id === guestScope.id;
      const rememberGuestVideos = result => {
        if (!session.guest || !result) return;
        if (!session.allowedVideos) session.allowedVideos = new Set();
        if (result.state === 'ready' && result.file?.id) session.allowedVideos.add(result.file.id);
        if (result.state === 'choose_file' && Array.isArray(result.files)) for (const file of result.files) if (file?.id) session.allowedVideos.add(file.id);
      };
      if (!['GET', 'HEAD'].includes(method) && !bearerSession && request.headers['x-csrf-token'] !== session.csrf) throw new AppError('BAD_CSRF', 'Reload the page and try again.', 403);
      if (path.startsWith('/api/watch-party/') && method === 'POST') {
        if (session.guest && !session.partyGuest) throw new AppError('GUEST_FORBIDDEN', 'Use the watch party invitation to join this playback.', 403);
        const data = await body(request, 8192);
        // Prune parties when a participant's authenticated session has expired or been revoked.
        sessions.prune();
        for (const room of watchParties.rooms.values()) for (const member of [room.host, room.guest]) if (member && !sessions.rows.has(member.sessionId)) watchParties.revokeSession(member.sessionId);
        if (path === '/api/watch-party/create') {
          if (!partyCreateRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please wait before creating another watch party.', 429);
          return json(response, 200, watchParties.create(session.id, data));
        }
        if (path === '/api/watch-party/prepare') {
          if (!partyPrepareRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please wait before checking the party video again.', 429);
          const access = session.partyGuest ? partyAccess(session) : null;
          const result = await watchParties.prepare(session.id, data.roomId, (identity, state) => access
            ? prepareHostedPartyFile(identity, access.proof.file.id, activeProvider)
            : prepareExactPartyFile(identity, activeDiscovery.gateway, state));
          if (!sessions.read(sessionToken)) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
          if (session.partyGuest) { partyAccess(session); session.allowedVideos = new Set([result.file.id]); }
          return json(response, 200, result);
        }
        if (path === '/api/watch-party/sync') {
          if (!partySyncRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Watch party updates are arriving too quickly.', 429);
          return json(response, 200, watchParties.sync(session.id, data));
        }
        if (path === '/api/watch-party/leave') {
          const result = watchParties.leave(session.id, data.roomId);
          if (session.partyGuest) revokePartyGuest(session);
          return json(response, 200, result);
        }
        throw new AppError('NOT_FOUND', 'This watch party action is unavailable.', 404);
      }
      if (path === '/api/setup-transfer' && method === 'POST') {
        if(session.guest)throw new AppError('GUEST_FORBIDDEN','Temporary guests cannot transfer a setup.',403);
        if(!transferCreateRate.allow(session.id))throw new AppError('SLOW_DOWN','Please wait before creating another setup transfer.',429);
        const data=await body(request,196608),row=setupTransfers.create(data.lookup,data.envelope);
        if(!row)throw new AppError('INVALID_TRANSFER','The encrypted setup transfer could not be saved.',400);
        return json(response,200,{ok:true,expiresAt:new Date(row.expires).toISOString()});
      }
      if (path === '/api/logout' && method === 'POST') {
        watchParties.revokeSession(session.id);
        activeDiscovery.revoke(session.id);
        if (!session.guest) {
          guestInvites.revokeOwner(session.id);
          for (const [id, row] of sessions.rows) if (row.guest && row.ownerId === session.id) { row.discovery?.revokeAll(); mediaTickets.revokeSession(id); watchParties.revokeSession(id); sessions.rows.delete(id); }
          if (session.provider) session.provider.key = '';
        }
        mediaTickets.revokeSession(session.id); sessions.revoke(session.id); if (!session.partyGuest) setCookie(response, '', 0); return json(response, 200, { ok: true });
      }
      if (path === '/api/torbox-status' && method === 'GET') {
        const cached = session.torboxStatus;
        if (cached && cached.until > now()) return json(response, 200, cached.value);
        const value = await torboxStatus.check(activeProvider);
        session.torboxStatus = { value, until: now() + (value.ok ? 60000 : 15000) };
        return json(response, 200, value);
      }
      if (method === 'POST' && ['/api/drive/connect','/api/drive/test/start'].includes(path)) throw new AppError('DRIVE_SHARING_DISABLED', 'Video exports to quota-limited storage are disabled. Playback uses TorBox directly.', 410);
      if (path === '/api/drive/connect' && method === 'POST') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot configure Drive sharing.', 403);
        if (!operationRate.allow('drive:' + session.id)) throw new AppError('SLOW_DOWN', 'Please wait a minute before connecting Drive again.', 429);
        return json(response, 200, await driveTransfers.configure(session, await body(request)));
      }
      if (path === '/api/drive/config' && method === 'GET') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot access Drive sharing.', 403);
        return json(response, 200, driveTransfers.config(session));
      }
      if (path === '/api/drive/test/start' && method === 'POST') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot start Drive sharing.', 403);
        if (!operationRate.allow('drive:' + session.id)) throw new AppError('SLOW_DOWN', 'Please wait a moment before starting another Drive transfer.', 429);
        return json(response, 200, await driveTransfers.start(session, activeProvider, await body(request)));
      }
      if (path === '/api/drive/test/status' && method === 'GET') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot access Drive sharing.', 403);
        return json(response, 200, await driveTransfers.status(session, activeProvider, url.searchParams.get('id') || ''));
      }
      if (path === '/api/drive/test/delete' && method === 'POST') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot access Drive sharing.', 403);
        const data = await body(request);
        return json(response, 200, await driveTransfers.remove(session, data.id));
      }
      if (path === '/api/share/create' && method === 'POST') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot create sharing links.', 403);
        const data = await body(request);
        const type = data.type, id = data.id, hours = Number(data.hours || 6);
        if (!['movie','series'].includes(type) || !/^tt[0-9]{5,12}$/.test(id || '') || !Number.isFinite(hours) || hours < 1 || hours > 24) throw new AppError('INVALID_SHARE', 'Choose a movie/show and an access time from 1 to 24 hours.', 400);
        const meta = await activeDiscovery.catalog.meta(type, id);
        const created = guestInvites.create({ ownerId: session.id, scope: { type, id, name: meta.name, poster: meta.poster || '' }, ttlMs: hours * 3600000 });
        if (!created) throw new AppError('SHARE_LIMIT', 'A temporary access link could not be created right now.', 429);
        return json(response, 200, { token: created.token, scope: created.row.scope, expiresAt: new Date(created.row.expires).toISOString() });
      }
      if (path === '/api/owner/unlock' && method === 'POST') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'Temporary guests cannot open owner tools.', 403);
        if (!loginRate.allow('household') || activeLogins >= 2) throw new AppError('LOGIN_RATE_LIMITED', 'Too many credential checks. Try again in 15 minutes.', 429);
        const data = await body(request); activeLogins++;
        let ok = false;
        try {
          if (apiKeyMode) {
            const supplied = typeof data.apiKey === 'string' ? data.apiKey.trim() : '';
            ok = !!session.provider?.key && supplied === session.provider.key;
          } else ok = await verifyPassword(data.password, passwordHash);
        } finally { activeLogins--; }
        if (!ok) throw new AppError(apiKeyMode ? 'BAD_API_KEY' : 'WRONG_PASSWORD', apiKeyMode ? 'That TorBox API key did not match this session.' : 'That household password did not match.', 401);
        session.ownerUntil = now() + 5 * 60000; return json(response, 200, { ok: true });
      }
      if (path.startsWith('/api/owner/')) {
        if (session.ownerUntil <= now()) throw new AppError('OWNER_REAUTH_REQUIRED', 'Re-enter your TorBox API key to open owner tools.', 403);
        if (path === '/api/owner/revoke' && method === 'POST') { discovery.revokeAll(); mediaTickets.revokeAll(); guestInvites.rows.clear(); watchParties.clear(); for (const row of sessions.rows.values()) { row.discovery?.revokeAll(); if (row.provider && !row.guest) row.provider.key = ''; } sessions.revokeAll(); setCookie(response, '', 0); return json(response, 200, { ok: true }); }
        if (path === '/api/owner/diagnostics' && method === 'POST') {
          if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before checking again.', 429);
          const account = await activeProvider.account();
          return json(response, 200, { account, authMode: apiKeyMode ? 'api-key' : 'household', apiKeyPersistence: apiKeyMode ? 'Render process memory only' : 'Render environment', directMedia: true, proxyEnabled: false, mediaRelayEnabled: false, mediaRelayScope: 'none', credentialProtection: 'Owner playback uses an opaque ticket that redirects to TorBox directly. TorBox may place the account API key in that CDN URL, so it can be visible to the signed-in owner browser network stack but is never returned in playback JSON. Guest playback requires a key-free direct TorBox link; otherwise it is unavailable. No video bytes are relayed.', discoveryConfigured: true, catalogProvider: 'Cinemeta', sourceProvider: sourceMode === 'multi' ? 'Zilean + Torrentio + MediaFusion Torznab, with StremThru Main/ElfHosted fallbacks' : 'Zilean (server-side)', sourceProviders: sourceLookup.diagnostics?.() || [], progressStorage: 'temporary server memory plus browser-local canonical resume history', automaticNextEnabled: true });
        }
      }
      if (path.startsWith('/api/discover/')) {
        if (!catalogRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please pause before checking more titles.', 429);
        let result;
        if (path === '/api/discover/catalog' && method === 'GET') {
          if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'This temporary link is limited to the shared title.', 403);
          result = await activeDiscovery.catalog.search({ type: url.searchParams.get('type') || 'movie', q: url.searchParams.get('q') || '', skip: Number(url.searchParams.get('skip') || 0), genre: url.searchParams.get('genre') || '', feed: url.searchParams.get('feed') || 'popular' });
        } else if (path === '/api/discover/meta' && method === 'GET') {
          const target = { type: url.searchParams.get('type'), id: url.searchParams.get('id') };
          if (!guestAllows(target)) throw new AppError('GUEST_FORBIDDEN', 'This temporary link is limited to the shared title.', 403);
          result = { meta: await activeDiscovery.catalog.meta(target.type, target.id) };
        } else if (path === '/api/discover/lookup' && method === 'GET') {
          const type = url.searchParams.get('type');
          const target = { type, id: url.searchParams.get('id'), ...(type === 'series' ? {
            season: url.searchParams.has('season') ? Number(url.searchParams.get('season')) : undefined,
            episode: url.searchParams.has('episode') ? Number(url.searchParams.get('episode')) : undefined
          } : {}) };
          if (!guestAllows(target)) throw new AppError('GUEST_FORBIDDEN', 'This temporary link is limited to the shared title.', 403);
          result = await sourceLookup.lookup(target, { fast: url.searchParams.get('fast') === '1', complete: url.searchParams.get('complete') === '1', ...(url.searchParams.get('refresh') === '1' ? { refresh: true } : {}) });
        } else if (path === '/api/discover/sources' && method === 'POST') {
          const data = await discoveryBody(request);
          if (!guestAllows(data.target)) throw new AppError('GUEST_FORBIDDEN', 'This temporary link is limited to the shared title.', 403);
          result = await activeDiscovery.register(data, session.id);
          rememberGuestVideos(result);
        } else if (path === '/api/discover/prepare' && method === 'POST') {
          if (!preparationRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Too many preparation requests. Check existing preparations before adding another.', 429);
          const data = await discoveryBody(request);
          result = await activeDiscovery.prepare(data.source, session.id, data.onlyCached === true);
          rememberGuestVideos(result);
        } else if (path === '/api/discover/status' && method === 'GET') {
          const selected = url.searchParams.get('file'); if (selected) parseVideoId(selected);
          result = await activeDiscovery.status(url.searchParams.get('source'), session.id, selected);
          rememberGuestVideos(result);
        } else throw new AppError('NOT_FOUND', 'This catalog action is not available.', 404);
        if (!sessions.read(sessionToken)) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
        return json(response, 200, result);
      }
      if (path === '/api/library' && method === 'GET') {
        if (session.guest) throw new AppError('GUEST_FORBIDDEN', 'This temporary link does not include access to the TorBox library.', 403);
        if (!operationRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please wait a minute before refreshing again.', 429);
        return json(response, 200, await activeProvider.list(url.searchParams.get('kind') || 'torrents', Number(url.searchParams.get('offset') || 0), url.searchParams.get('refresh') === '1'));
      }
      if (path === '/api/playback' && method === 'POST') {
        if (!operationRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please wait a minute before requesting another stream.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        parseVideoId(data.videoId);
        if (session.guest && !session.allowedVideos?.has(data.videoId)) throw new AppError('GUEST_FORBIDDEN', 'This file was not selected through the shared title.', 403);
        const progressViewer = session.id + '/' + data.viewer;
        const intent = progress.beginIntent(progressViewer);
        let stream;
        if (session.guest) {
          try {
            if (session.partyGuest && partyAccess(session).room.allowAccountKeyInPlayback) {
              // TorBox's normal CDN link can contain its master key. A host may
              // explicitly permit that account access for this trusted viewer.
              stream = await activeProvider.resolveForRelay(data.videoId);
              stream.upstreamUrl = validatedPlaybackUrl(stream.upstreamUrl, mediaHosts);
            } else {
              const direct = await activeProvider.resolveGuest(data.videoId);
              stream = { file: direct.file, mediaIdentity: direct.mediaIdentity, upstreamUrl: safePlaybackUrl(direct.url, activeProvider.key, mediaHosts) };
            }
          } catch (error) {
            if (['UNSAFE_PROVIDER_URL', 'GUEST_LINK_UNAVAILABLE'].includes(error?.code)) {
              throw new AppError('GUEST_DIRECT_UNAVAILABLE', session.partyGuest ? 'TorBox could not provide a private direct link for the host’s selected video. Ask the host to reopen the video and try a new party link.' : 'TorBox cannot provide a private direct link for this guest. Video relaying is disabled to avoid bandwidth charges. The guest can use their own TorBox connection.', 409);
            }
            throw error;
          }
        } else stream = await activeProvider.resolveForRelay(data.videoId);
        const container = browserContainerHints(stream.file);
        if (container.browserUnsupported) {
          console.log(JSON.stringify({ event: 'media_playback_rejected', code: 'BROWSER_CONTAINER_UNSUPPORTED', container: container.container }));
          throw new AppError('BROWSER_CONTAINER_UNSUPPORTED', `${container.container.toUpperCase()} files cannot play in Android Chrome. Choose an MP4 or WebM source.`, 415);
        }
        if (!progress.isCurrent(progressViewer, intent)) throw new AppError('PLAYBACK_SUPERSEDED', 'A newer playback request replaced this one.', 409);
        if (!sessions.read(sessionToken)) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
        if (session.partyGuest && !samePartyMedia(stream.mediaIdentity, partyAccess(session).room.media.identity)) throw new AppError('WATCH_PARTY_MEDIA_MISMATCH', 'The host’s selected file changed. Ask them to create a new watch party.', 409);
        const lease = progress.start(progressViewer, data.videoId, { reset: data.startOver === true, sessionId: session.id });
        const mediaToken = mediaTickets.create(session.id, data.videoId, stream.upstreamUrl, stream.file);
        const playbackProof = session.guest && !session.partyGuest ? null : watchParties.issuePlayback(session.id, stream.file, stream.mediaIdentity);
        const partyKeyConsent = session.partyGuest && partyAccess(session).room.allowAccountKeyInPlayback;
        return json(response, 200, { file: stream.file, mediaUrl: `/media/${mediaToken}`, mediaIdentity: stream.mediaIdentity || null, playbackProof, delivery: 'direct', conversion: false, exposesTorBoxToken: !session.guest || partyKeyConsent === true, guestSafeLink: session.guest === true && !partyKeyConsent, ...lease });
      }
      if (path === '/api/progress' && method === 'PUT') {
        if (!progressRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Progress is being saved too frequently.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        const progressViewer = session.id + '/' + data.viewer;
        return json(response, 200, { saved: progress.write(progressViewer, data, session.id) });
      }
      throw new AppError('NOT_FOUND', 'This action is not available in this player.', 404);
    } catch (error) {
      if (response.destroyed) return;
      if (response.headersSent) return response.end();
      if (error instanceof AppError || error instanceof SourceLookupError) return json(response, error.status, { error: error.code, message: error.message });
      console.error(JSON.stringify({ event: 'request_failed', code: 'INTERNAL_ERROR' }));
      json(response, 500, { error: 'INTERNAL_ERROR', message: 'The server could not complete this request. Please try again.' });
    }
  });
  server.requestTimeout = 25000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  return { server, sessions, progress, mediaTickets, discovery, sourceLookup, guestInvites, driveTransfers, torboxStatus, watchParties };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', version: '1.2.8' })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}

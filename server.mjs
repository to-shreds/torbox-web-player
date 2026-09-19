import { SourceLookup, MultiSourceLookup, SourceLookupError } from './lib/source-lookup.mjs';
import { Discovery, discoveryBody } from './lib/discovery.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Sessions, Limiter, verifyPassword, validHash } from './lib/auth.mjs';
import { ProgressStore, VIEWERS, validViewer } from './lib/progress.mjs';
import { TorBox, AppError, parseVideoId, TORBOX_MEDIA_HOSTS } from './lib/torbox.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/setup', ['setup.html', 'text/html; charset=utf-8']],
  ['/setup.html', ['setup.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/runtime.js', ['runtime.js', 'text/javascript; charset=utf-8']],
  ['/history.js', ['history.js', 'text/javascript; charset=utf-8']],
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
async function body(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new AppError('JSON_REQUIRED', 'Send a JSON request.', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new AppError('REQUEST_TOO_LARGE', 'This request is too large.', 413);
    chunks.push(chunk);
  }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
  catch { throw new AppError('INVALID_JSON', 'This request could not be read.', 400); }
}
export function createApp({ env = process.env, provider, providerFactory, discoveryFetch = fetch, discoveryService, sourceLookupService, now = Date.now } = {}) {
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
    response.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
    return true;
  };
  const sessions = new Sessions(now), progress = new ProgressStore();
  const loginRate = new Limiter(15, 15 * 60000, now), operationRate = new Limiter(30, 60000, now), progressRate = new Limiter(120, 60000, now);
  let activeLogins = 0;
  const mediaHosts = (env.MEDIA_HOST_SUFFIXES || TORBOX_MEDIA_HOSTS.join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const torbox = provider || new TorBox({ key: env.TORBOX_API_KEY || '', mediaHosts });
  const makeProvider = key => providerFactory ? providerFactory(key) : new TorBox({ key, mediaHosts });
  const discovery = discoveryService || new Discovery({ provider: torbox, fetchFn: discoveryFetch, now });
  const sourceMode = env.SOURCE_PROVIDER || 'zilean';
  const sourceLookup = sourceLookupService || (sourceMode === 'multi'
    ? new MultiSourceLookup({ fetchFn: discoveryFetch, now })
    : new SourceLookup({ fetchFn: discoveryFetch, now, provider: sourceMode }));
  const catalogRate = new Limiter(90, 60000, now), preparationRate = new Limiter(8, 60000, now);
  const configured = apiKeyMode || validHash(passwordHash);
  const setCookie = (response, value, maxAge = 30 * 86400) => response.setHeader('Set-Cookie', `tw_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://images.metahub.space https://image.tmdb.org https://m.media-amazon.com; media-src https://torbox.app https://*.torbox.app https://*.tb-cdn.cx https://*.tb-cdn.io https://*.tb-cdn.pw https://*.tb-cdn.sh https://*.tb-cdn.st https://*.tb-cdn.to https://*.tb-cdn.earth; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url || '/', origin), path = url.pathname, method = request.method;
      const corsAllowed = applyCors(request, response);
      if (method === 'OPTIONS') {
        if (!corsAllowed) throw new AppError('BAD_ORIGIN', 'This frontend is not allowed to use the private API.', 403);
        response.statusCode = 204; response.end(); return;
      }
      if (method === 'GET' && path === '/healthz') return json(response, 200, { ok: true, version: '0.8.0-key-clone', stage: 'catalog-first-preview' });
      if (method === 'GET' && path === '/robots.txt') { response.writeHead(200, { 'Content-Type': 'text/plain' }); return response.end('User-agent: *\nDisallow: /\n'); }
      if (method === 'GET' && publicFiles.has(path)) {
        const [filename, type] = publicFiles.get(path);
        response.setHeader('Content-Type', type); return response.end(await readFile(join(root, 'public', filename)));
      }

      const bearer = bearerId(request), cookie = cookieId(request), sessionToken = bearer || cookie;
      const session = configured ? sessions.read(sessionToken) : null;
      const bearerSession = !!bearer && !!session;
      if (!path.startsWith('/api/')) throw new AppError('NOT_FOUND', 'Page not found.', 404);
      if (!['GET', 'HEAD'].includes(method) && !trustedOrigin(request.headers.origin)) throw new AppError('BAD_ORIGIN', 'Reload the website before trying again.', 403);
      if (path === '/api/session' && method === 'GET') return json(response, 200, { authenticated: !!session, setupRequired: !configured, authMode: apiKeyMode ? 'api-key' : 'household', ...(session ? { csrf: session.csrf, viewers: VIEWERS, durable: false, keyConfigured: apiKeyMode ? !!session.provider : !!(env.TORBOX_API_KEY || provider) } : {}) });
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
            sessionDiscovery = new Discovery({ provider: sessionProvider, fetchFn: discoveryFetch, now });
          } else {
            const ok = await verifyPassword(data.password, passwordHash);
            if (!ok) throw new AppError('WRONG_PASSWORD', 'That household password did not match.', 401);
          }
        } finally { activeLogins--; }
        const created = sessions.create();
        if (!created) throw new AppError('SESSION_LIMIT', 'The session limit was reached. Restart the service to revoke old sessions.', 429);
        if (apiKeyMode) { created.row.provider = sessionProvider; created.row.discovery = sessionDiscovery; }
        if (session) { (session.discovery || discovery).revoke(session.id); sessions.revoke(session.id); }
        setCookie(response, created.id); return json(response, 200, { ok: true, csrf: created.row.csrf, sessionToken: created.id, authMode: apiKeyMode ? 'api-key' : 'household' });
      }
      if (!session) throw new AppError('LOGIN_REQUIRED', apiKeyMode ? 'Enter your TorBox API key to sign in.' : 'Sign in to your household first.', 401);
      const activeProvider = session.provider || torbox;
      const activeDiscovery = session.discovery || discovery;
      if (!['GET', 'HEAD'].includes(method) && !bearerSession && request.headers['x-csrf-token'] !== session.csrf) throw new AppError('BAD_CSRF', 'Reload the page and try again.', 403);
      if (path === '/api/logout' && method === 'POST') { activeDiscovery.revoke(session.id); if (session.provider) session.provider.key = ''; sessions.revoke(session.id); setCookie(response, '', 0); return json(response, 200, { ok: true }); }
      if (path === '/api/owner/unlock' && method === 'POST') {
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
        if (path === '/api/owner/revoke' && method === 'POST') { discovery.revokeAll(); for (const row of sessions.rows.values()) { row.discovery?.revokeAll(); if (row.provider) row.provider.key = ''; } sessions.revokeAll(); setCookie(response, '', 0); return json(response, 200, { ok: true }); }
        if (path === '/api/owner/diagnostics' && method === 'POST') {
          if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before checking again.', 429);
          const account = await activeProvider.account();
          return json(response, 200, { account, authMode: apiKeyMode ? 'api-key' : 'household', apiKeyPersistence: apiKeyMode ? 'Render process memory only' : 'Render environment', directMedia: true, proxyEnabled: false, mediaRelayEnabled: false, credentialProtection: apiKeyMode ? 'The API key is supplied by the browser and retained only in this process session.' : 'The signed-in browser intentionally receives the temporary TorBox media URL/token.', discoveryConfigured: true, catalogProvider: 'Cinemeta', sourceProvider: sourceMode === 'multi' ? 'Zilean → StremThru Torz → MediaFusion → Comet fallback chain' : 'Zilean (server-side)', sourceProviders: sourceLookup.diagnostics?.() || [], progressStorage: 'temporary server memory plus browser-local canonical resume history', automaticNextEnabled: true });
        }
      }
      if (path.startsWith('/api/discover/')) {
        if (!catalogRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Please pause before checking more titles.', 429);
        let result;
        if (path === '/api/discover/catalog' && method === 'GET') result = await activeDiscovery.catalog.search({ type: url.searchParams.get('type') || 'movie', q: url.searchParams.get('q') || '', skip: Number(url.searchParams.get('skip') || 0), genre: url.searchParams.get('genre') || '', feed: url.searchParams.get('feed') || 'popular' });
        else if (path === '/api/discover/meta' && method === 'GET') result = { meta: await activeDiscovery.catalog.meta(url.searchParams.get('type'), url.searchParams.get('id')) };
        else if (path === '/api/discover/lookup' && method === 'GET') {
          const type = url.searchParams.get('type');
          result = await sourceLookup.lookup({ type, id: url.searchParams.get('id'), ...(type === 'series' ? {
            season: url.searchParams.has('season') ? Number(url.searchParams.get('season')) : undefined,
            episode: url.searchParams.has('episode') ? Number(url.searchParams.get('episode')) : undefined
          } : {}) });
        }
        else if (path === '/api/discover/sources' && method === 'POST') result = await activeDiscovery.register(await discoveryBody(request), session.id);
        else if (path === '/api/discover/prepare' && method === 'POST') {
          if (!preparationRate.allow('household')) throw new AppError('SLOW_DOWN', 'Too many preparation requests. Check existing preparations before adding another.', 429);
          const data = await discoveryBody(request);
          result = await activeDiscovery.prepare(data.source, session.id, data.onlyCached === true);
        } else if (path === '/api/discover/status' && method === 'GET') {
          const selected = url.searchParams.get('file'); if (selected) parseVideoId(selected);
          result = await activeDiscovery.status(url.searchParams.get('source'), session.id, selected);
        } else throw new AppError('NOT_FOUND', 'This catalog action is not available.', 404);
        if (!sessions.read(sessionToken)) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
        return json(response, 200, result);
      }
      if (path === '/api/library' && method === 'GET') {
        if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before refreshing again.', 429);
        return json(response, 200, await activeProvider.list(url.searchParams.get('kind') || 'torrents', Number(url.searchParams.get('offset') || 0), url.searchParams.get('refresh') === '1'));
      }
      if (path === '/api/playback' && method === 'POST') {
        if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before requesting another stream.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        parseVideoId(data.videoId);
        const intent = progress.beginIntent(data.viewer);
        const stream = await activeProvider.resolveForRelay(data.videoId);
        if (!progress.isCurrent(data.viewer, intent)) throw new AppError('PLAYBACK_SUPERSEDED', 'A newer playback request replaced this one.', 409);
        if (!sessions.read(sessionToken)) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
        const lease = progress.start(data.viewer, data.videoId, { reset: data.startOver === true, sessionId: session.id });
        return json(response, 200, { file: stream.file, mediaUrl: stream.upstreamUrl, delivery: 'direct', conversion: false, exposesTorBoxToken: true, ...lease });
      }
      if (path === '/api/progress' && method === 'PUT') {
        if (!progressRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Progress is being saved too frequently.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        return json(response, 200, { saved: progress.write(data.viewer, data, session.id) });
      }
      throw new AppError('NOT_FOUND', 'This action is not available in this player.', 404);
    } catch (error) {
      if (response.headersSent) return response.end();
      if (error instanceof AppError || error instanceof SourceLookupError) return json(response, error.status, { error: error.code, message: error.message });
      console.error(JSON.stringify({ event: 'request_failed', code: 'INTERNAL_ERROR' }));
      json(response, 500, { error: 'INTERNAL_ERROR', message: 'The server could not complete this request. Please try again.' });
    }
  });
  server.requestTimeout = 25000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  return { server, sessions, progress, discovery, sourceLookup };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', version: '0.8.0-key-clone' })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}

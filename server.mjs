import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Sessions, Limiter, verifyPassword, validHash } from './lib/auth.mjs';
import { ProgressStore, VIEWERS, validViewer } from './lib/progress.mjs';
import { TorBox, AppError, parseVideoId } from './lib/torbox.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/setup', ['setup.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/password.js', ['password.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
function cookieId(request) {
  const item = (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('tw_session='));
  return item ? item.slice('tw_session='.length) : '';
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
export function createApp({ env = process.env, provider, now = Date.now } = {}) {
  const production = env.NODE_ENV === 'production';
  const origin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 10000}`;
  const passwordHash = env.HOUSEHOLD_PASSWORD_HASH || '';
  const sessions = new Sessions(now), progress = new ProgressStore();
  const loginRate = new Limiter(15, 15 * 60000, now), operationRate = new Limiter(30, 60000, now), progressRate = new Limiter(120, 60000, now);
  let activeLogins = 0;
  const torbox = provider || new TorBox({ key: env.TORBOX_API_KEY || '', mediaHosts: (env.MEDIA_HOST_SUFFIXES || 'torbox.app').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) });
  const configured = validHash(passwordHash);
  const setCookie = (response, value, maxAge = 30 * 86400) => response.setHeader('Set-Cookie', `tw_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${production ? '; Secure' : ''}`);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(request.url || '/', origin), path = url.pathname, method = request.method;
      if (method === 'GET' && path === '/healthz') return json(response, 200, { ok: true, version: '0.1.0', stage: 'integration-checkpoint' });
      if (method === 'GET' && path === '/robots.txt') { response.writeHead(200, { 'Content-Type': 'text/plain' }); return response.end('User-agent: *\nDisallow: /\n'); }
      if (method === 'GET' && publicFiles.has(path)) {
        const [filename, type] = publicFiles.get(path);
        response.setHeader('Content-Type', type); return response.end(await readFile(join(root, 'public', filename)));
      }
      if (!path.startsWith('/api/')) throw new AppError('NOT_FOUND', 'Page not found.', 404);
      // Exact-origin checks also protect login. No trusting a client-supplied Host header.
      if (!['GET', 'HEAD'].includes(method) && request.headers.origin !== origin) throw new AppError('BAD_ORIGIN', 'Reload the website before trying again.', 403);
      const session = configured ? sessions.read(cookieId(request)) : null;
      if (path === '/api/session' && method === 'GET') return json(response, 200, { authenticated: !!session, setupRequired: !configured, ...(session ? { csrf: session.csrf, viewers: VIEWERS, durable: false, keyConfigured: !!(env.TORBOX_API_KEY || provider) } : {}) });
      if (path === '/api/login' && method === 'POST') {
        if (!configured) throw new AppError('SETUP_REQUIRED', 'Complete the secure Render setup first.', 503);
        // Global household limit cannot be bypassed by forging proxy/IP headers.
        if (!loginRate.allow('household') || activeLogins >= 2) throw new AppError('LOGIN_RATE_LIMITED', 'Too many sign-in attempts. Try again in 15 minutes.', 429);
        const data = await body(request); activeLogins++;
        let ok; try { ok = await verifyPassword(data.password, passwordHash); } finally { activeLogins--; }
        if (!ok) throw new AppError('WRONG_PASSWORD', 'That household password did not match.', 401);
        const created = sessions.create();
        if (!created) throw new AppError('SESSION_LIMIT', 'The session limit was reached. Restart the service to revoke old sessions.', 429);
        // Revoke a previous cookie on sign-in to prevent unnoticed orphan sessions.
        if (session) sessions.revoke(session.id);
        setCookie(response, created.id); return json(response, 200, { ok: true, csrf: created.row.csrf });
      }
      if (!session) throw new AppError('LOGIN_REQUIRED', 'Sign in to your household first.', 401);
      if (!['GET', 'HEAD'].includes(method) && request.headers['x-csrf-token'] !== session.csrf) throw new AppError('BAD_CSRF', 'Reload the page and try again.', 403);
      if (path === '/api/logout' && method === 'POST') { sessions.revoke(session.id); setCookie(response, '', 0); return json(response, 200, { ok: true }); }
      if (path === '/api/owner/unlock' && method === 'POST') {
        if (!loginRate.allow('household') || activeLogins >= 2) throw new AppError('LOGIN_RATE_LIMITED', 'Too many password checks. Try again in 15 minutes.', 429);
        const data = await body(request); activeLogins++;
        let ok; try { ok = await verifyPassword(data.password, passwordHash); } finally { activeLogins--; }
        if (!ok) throw new AppError('WRONG_PASSWORD', 'That household password did not match.', 401);
        session.ownerUntil = now() + 5 * 60000; return json(response, 200, { ok: true });
      }
      if (path.startsWith('/api/owner/')) {
        if (session.ownerUntil <= now()) throw new AppError('OWNER_REAUTH_REQUIRED', 'Re-enter the household password to open owner tools.', 403);
        if (path === '/api/owner/revoke' && method === 'POST') { sessions.revokeAll(); setCookie(response, '', 0); return json(response, 200, { ok: true }); }
        if (path === '/api/owner/diagnostics' && method === 'POST') {
          if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before checking again.', 429);
          const account = await torbox.account();
          return json(response, 200, { account, directMedia: true, proxyEnabled: false, fallbackVerified: false, discoveryConfigured: false, progressStorage: 'temporary server memory', automaticNextEnabled: false });
        }
      }
      if (path === '/api/library' && method === 'GET') {
        if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before refreshing again.', 429);
        return json(response, 200, await torbox.list(url.searchParams.get('kind') || 'torrents', Number(url.searchParams.get('offset') || 0), url.searchParams.get('refresh') === '1'));
      }
      if (path === '/api/playback' && method === 'POST') {
        if (!operationRate.allow('provider')) throw new AppError('SLOW_DOWN', 'Please wait a minute before requesting another link.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        parseVideoId(data.videoId);
        const intent = progress.beginIntent(data.viewer);
        const stream = await torbox.resolve(data.videoId);
        if (!progress.isCurrent(data.viewer, intent)) throw new AppError('PLAYBACK_SUPERSEDED', 'A newer playback request replaced this one.', 409);
        if (!sessions.read(cookieId(request))) throw new AppError('LOGIN_REQUIRED', 'This session has been revoked.', 401);
        const lease = progress.start(data.viewer, data.videoId, { reset: data.startOver === true, sessionId: session.id });
        return json(response, 200, { ...stream, ...lease });
      }
      if (path === '/api/progress' && method === 'PUT') {
        if (!progressRate.allow(session.id)) throw new AppError('SLOW_DOWN', 'Progress is being saved too frequently.', 429);
        const data = await body(request);
        if (!validViewer(data.viewer)) throw new AppError('BAD_VIEWER', 'Choose a viewer first.', 400);
        return json(response, 200, { saved: progress.write(data.viewer, data, session.id) });
      }
      throw new AppError('NOT_FOUND', 'This action is not available in the integration checkpoint.', 404);
    } catch (error) {
      if (response.headersSent) return response.end();
      if (error instanceof AppError) return json(response, error.status, { error: error.code, message: error.message });
      // No raw exception, provider payload, secret, cookie, or private URL is logged.
      console.error(JSON.stringify({ event: 'request_failed', code: 'INTERNAL_ERROR' }));
      json(response, 500, { error: 'INTERNAL_ERROR', message: 'The server could not complete this request. Please try again.' });
    }
  });
  server.requestTimeout = 25000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  return { server, sessions, progress };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', version: '0.1.0' })));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
}

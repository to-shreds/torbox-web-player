import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';

const FRONTEND = 'https://to-shreds.github.io';
const ID = 'tt0133093';
const RELATED = 'tt0103064';
const rawMeta = { id: ID, type: 'movie', name: 'Fixture Movie', genres: ['Action', 'Sci-Fi'], imdbRating: '8.7', trailers: [{ source: 'FVI84Dfx2-I', type: 'Trailer' }] };
async function fixture(t) {
  const upstream = [], control = { revokeDuringSimilar: false };
  const provider = { key: 'synthetic-fixture-only', account: async () => ({ valid: true }) };
  const app = createApp({
    env: { AUTH_MODE: 'api-key', PUBLIC_ORIGIN: 'https://torbox-web-player-key.onrender.com', FRONTEND_ORIGINS: FRONTEND, NODE_ENV: 'production' },
    provider,
    discoveryFetch: async input => {
      const url = new URL(input); upstream.push(url.href);
      assert.equal(url.origin, 'https://v3-cinemeta.strem.io');
      if (url.pathname === `/meta/movie/${ID}.json`) return Response.json({ meta: rawMeta });
      if (url.pathname.startsWith('/catalog/movie/top/genre=')) {
        if (control.revokeDuringSimilar) app.sessions.revokeAll();
        return Response.json({ metas: [
          rawMeta,
          { id: RELATED, type: 'movie', name: 'Related Fixture', genres: ['Sci-Fi', 'Action'] },
          { id: 'tt1000001', type: 'movie', name: 'Unrelated Fixture', genres: ['Romance'] }
        ] });
      }
      throw new Error(`Unexpected fixture request: ${url.pathname}`);
    },
    mediaFetch: async () => { throw new Error('Title details must not fetch provider media'); }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const owner = app.sessions.create(); owner.row.provider = provider;
  const call = (path, { token, method = 'GET', data, origin = FRONTEND } = {}) => fetch(base + path, {
    method,
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  return { ...app, owner: owner.id, call, upstream, control };
}
const similarPath = `/api/discover/similar?type=movie&id=${ID}`;

test('similar title route requires a live login before making any catalog request', async t => {
  const { call, upstream } = await fixture(t);
  for (const token of [undefined, 'x'.repeat(43)]) {
    const response = await call(similarPath, { token });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'LOGIN_REQUIRED');
  }
  assert.deepEqual(upstream, []);
});

test('authenticated HTTP details and similar routes use exact title metadata and shared cache only', async t => {
  const { call, owner, upstream } = await fixture(t);
  const details = await call(`/api/discover/meta?type=movie&id=${ID}`, { token: owner });
  assert.equal(details.status, 200);
  const meta = (await details.json()).meta;
  assert.deepEqual(meta.trailers, [{ ytId: 'FVI84Dfx2-I', title: 'Trailer' }]);
  assert.equal(meta.imdbRating, 8.7);
  const similar = await call(similarPath, { token: owner });
  assert.equal(similar.status, 200);
  assert.equal(similar.headers.get('access-control-allow-origin'), FRONTEND);
  const data = await similar.json();
  assert.equal(data.provider, 'Cinemeta');
  assert.equal(data.basedOn, 'genres');
  assert.deepEqual(data.metas.map(row => [row.id, row.type]), [[RELATED, 'movie']]);
  assert.equal((await call(similarPath, { token: owner })).status, 200);
  assert.equal(upstream.length, 3);
  assert.equal(upstream.filter(url => url.includes('/meta/')).length, 1);
  assert.ok(upstream.every(url => !url.includes('synthetic-fixture-only')));
});

test('a real temporary guest session cannot expand its title scope through similar results', async t => {
  const { call, owner, upstream } = await fixture(t);
  const shared = await call('/api/share/create', { method: 'POST', token: owner, data: { type: 'movie', id: ID, hours: 2 } });
  assert.equal(shared.status, 200);
  const accepted = await call('/api/guest/accept', { method: 'POST', data: { token: (await shared.json()).token } });
  assert.equal(accepted.status, 200);
  const guest = await accepted.json();
  assert.equal(guest.guest, true);
  assert.equal((await call(`/api/discover/meta?type=movie&id=${ID}`, { token: guest.sessionToken })).status, 200);
  const before = upstream.length;
  const similar = await call(similarPath, { token: guest.sessionToken });
  assert.equal(similar.status, 403);
  assert.equal((await similar.json()).error, 'GUEST_FORBIDDEN');
  assert.equal(upstream.length, before);
});

test('similar HTTP requests reject invalid identity and discard results after session revocation', async t => {
  const { call, owner, upstream, control } = await fixture(t);
  for (const query of ['type=all&id=' + ID, 'type=movie&id=../escape', 'type=movie', 'id=' + ID]) {
    const response = await call('/api/discover/similar?' + query, { token: owner });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_TITLE');
  }
  assert.equal(upstream.length, 0);
  control.revokeDuringSimilar = true;
  const response = await call(similarPath, { token: owner });
  assert.equal(response.status, 401);
  const body = await response.text();
  assert.ok(body.includes('LOGIN_REQUIRED'));
  assert.ok(!body.includes('Related Fixture'));
});

test('all title enrichment modules are served as exact same-origin JavaScript assets', async t => {
  const { call } = await fixture(t);
  for (const name of ['title-details.js', 'title-ratings.js', 'wikidata-ratings.js']) {
    const response = await call('/' + name + '?v=release-1.2.16-details.1');
    assert.equal(response.status, 200, name);
    assert.match(response.headers.get('content-type'), /^text\/javascript(?:;|$)/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await response.text(), await readFile(new URL('../public/' + name, import.meta.url), 'utf8'));
  }
});

test('served HTML CSP permits the exact rating providers while scripts and API responses stay restricted', async t => {
  const { call } = await fixture(t);
  const response = await call('/'), html = await response.text();
  const headerPolicy = response.headers.get('content-security-policy');
  const metaPolicy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.equal(headerPolicy, metaPolicy + "; frame-ancestors 'none'");
  const directives = Object.fromEntries(headerPolicy.split(';').map(part => {
    const [key, ...values] = part.trim().split(/\s+/); return [key, values];
  }));
  assert.deepEqual(new Set(directives['connect-src']), new Set([
    "'self'", 'https://torbox-web-player-key.onrender.com', 'https://api-player.redbull.com',
    'https://sports-desk-links.onrender.com', 'https://api.trakt.tv',
    'https://www.omdbapi.com', 'https://query.wikidata.org'
  ]));
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['style-src'], ["'self'"]);
  assert.ok(!headerPolicy.includes("'unsafe-inline'") && !headerPolicy.includes("'unsafe-eval'"));
  assert.ok(!directives['frame-src'].some(origin => origin.includes('youtube')));
  const apiPolicy = (await call(similarPath)).headers.get('content-security-policy');
  assert.ok(apiPolicy.includes("connect-src 'self';"));
  assert.ok(!apiPolicy.includes('omdbapi.com') && !apiPolicy.includes('wikidata.org'));
});

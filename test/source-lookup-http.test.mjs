import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
const hash = await hashPassword('synthetic-only-source-test');
const target = { type: 'movie', id: 'tt1160419' };
async function fixture(t, fetchFn) {
  const requests = [];
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: hash, PUBLIC_ORIGIN: 'https://fixture.test' }, discoveryFetch: fetchFn || (async (url, opts) => {
    requests.push({ url, opts });
    return new Response(JSON.stringify([{ imdb_id: url.searchParams.get('ImdbId'), info_hash: 'a'.repeat(40), raw_title: 'Fixture.H264.AAC' }]));
  }) });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const created = app.sessions.create();
  const headers = { Cookie: `tw_session=${created.id}`, Origin: 'https://fixture.test', 'X-CSRF-Token': created.row.csrf };
  return { ...app, headers, requests, call: (query = '', opts = {}) => fetch(base + '/api/discover/lookup' + query, opts) };
}
test('source lookup cannot be used without household authentication', async t => {
  const f = await fixture(t); const r = await f.call('?type=movie&id=' + target.id);
  assert.equal(r.status, 401); assert.equal(f.requests.length, 0);
});
test('authenticated lookup returns source data through same-origin route without adding torrents', async t => {
  const f = await fixture(t); const r = await f.call('?type=movie&id=' + target.id, { headers: f.headers });
  assert.equal(r.status, 200); assert.equal((await r.json()).sources.length, 1);
  assert.equal(f.requests.length, 1); assert.ok(f.requests[0].url.hostname.endsWith('midnightignite.me'));
  assert.equal(f.discovery.operations.size, 0); assert.equal(f.discovery.tickets.size, 0);
});
test('missing series season is invalid rather than silently becoming specials', async t => {
  const f = await fixture(t); const r = await f.call('?type=series&id=tt0903747&episode=1', { headers: f.headers });
  assert.equal(r.status, 400); assert.equal(f.requests.length, 0);
});
test('same-origin lookup cannot fetch an arbitrary URL', async t => {
  const f = await fixture(t); const r = await f.call('?type=movie&id=https%3A%2F%2Fevil.test&url=https%3A%2F%2Fevil.test', { headers: f.headers });
  assert.equal(r.status, 400); assert.equal(f.requests.length, 0);
});
test('lookup method does not accept POST source additions', async t => {
  const f = await fixture(t); const r = await f.call('?type=movie&id=' + target.id, { method: 'POST', headers: f.headers });
  assert.equal(r.status, 404); assert.equal(f.requests.length, 0);
});
test('provider lookup failures retain sanitized specific status codes', async t => {
  const f = await fixture(t, async () => new Response('private details', { status: 429, headers: { 'retry-after': '120' } }));
  const r = await f.call('?type=movie&id=' + target.id, { headers: f.headers });
  assert.equal(r.status, 429); const body = await r.json(); assert.equal(body.error, 'SOURCE_RATE_LIMITED'); assert.ok(!JSON.stringify(body).includes('private details'));
});
test('logout revocation during source lookup prevents returning its result', async t => {
  const f = await fixture(t);
  f.sourceLookup.lookup = async () => { f.sessions.revokeAll(); return { private: true }; };
  const r = await f.call('?type=movie&id=' + target.id, { headers: f.headers });
  assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('private'));
});
test('source responses disable shared caching', async t => {
  const f = await fixture(t); const r = await f.call('?type=movie&id=' + target.id, { headers: f.headers });
  assert.equal(r.headers.get('cache-control'), 'no-store, private');
  assert.ok(r.headers.get('content-security-policy').includes("connect-src 'self';"));
});

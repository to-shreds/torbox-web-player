import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
const hash = await hashPassword('synthetic-only');
async function fixture(t) {
  const calls = [];
  const service = {
    catalog: { search: async data => { calls.push(['search', data]); return { metas: [], nextSkip: null }; }, meta: async (type, id) => { calls.push(['meta', id]); return { type, id, episodes: [] }; } },
    register: async (data, session) => { calls.push(['register', data, session]); return { sources: [] }; },
    prepare: async (id, session, cached) => { calls.push(['prepare', id, session, cached]); return { state: 'preparing' }; },
    status: async (id, session, file) => { calls.push(['status', id, session, file]); return { state: 'preparing' }; },
    revoke: id => calls.push(['revoke', id]), revokeAll: () => calls.push(['revokeAll'])
  };
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: hash, PUBLIC_ORIGIN: 'https://fixture.test', NODE_ENV: 'production' }, provider: { account: async () => ({ valid: true }) }, discoveryService: service });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const created = app.sessions.create();
  const auth = { Cookie: `tw_session=${created.id}`, Origin: 'https://fixture.test', 'X-CSRF-Token': created.row.csrf, 'Content-Type': 'application/json' };
  return { ...app, calls, auth, base, call: (path, opts = {}) => fetch(base + path, opts) };
}
test('all new catalog/source/preparation/status APIs require login', async t => {
  const { call, calls } = await fixture(t);
  for (const [path, method] of [['catalog', 'GET'], ['meta', 'GET'], ['sources', 'POST'], ['prepare', 'POST'], ['status', 'GET']]) {
    const r = await call('/api/discover/' + path, { method, headers: { Origin: 'https://fixture.test' } }); assert.equal(r.status, 401);
  }
  assert.equal(calls.length, 0);
});
test('source registration and preparation require exact origin and CSRF', async t => {
  const { call, auth, calls } = await fixture(t);
  for (const path of ['sources', 'prepare']) {
    for (const headers of [{ ...auth, Origin: 'https://bad.test' }, { ...auth, 'X-CSRF-Token': 'bad' }]) {
      const r = await call('/api/discover/' + path, { method: 'POST', headers, body: '{}' }); assert.equal(r.status, 403);
    }
  }
  assert.equal(calls.length, 0);
});
test('catalog and metadata route through the separate adapter without preparation', async t => {
  const { call, auth, calls } = await fixture(t);
  assert.equal((await call('/api/discover/catalog?type=series&q=Fixture&skip=100', { headers: auth })).status, 200);
  assert.equal((await call('/api/discover/meta?type=movie&id=tt1254207', { headers: auth })).status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['search', 'meta']); assert.equal(calls[0][1].skip, 100);
});
test('POST registration is read-only availability work; prepare is a separate explicit call', async t => {
  const { call, auth, calls } = await fixture(t);
  await call('/api/discover/sources', { method: 'POST', headers: auth, body: JSON.stringify({ target: {}, sources: [] }) });
  assert.deepEqual(calls.map(c => c[0]), ['register']);
  await call('/api/discover/prepare', { method: 'POST', headers: auth, body: JSON.stringify({ source: 'ticket', onlyCached: true }) });
  assert.deepEqual(calls.map(c => c[0]), ['register', 'prepare']); assert.equal(calls[1][3], true);
});
test('source request body size is bounded before any provider call', async t => {
  const { call, auth, calls } = await fixture(t);
  const r = await call('/api/discover/sources', { method: 'POST', headers: auth, body: JSON.stringify({ sources: ['x'.repeat(66000)] }) });
  assert.equal(r.status, 413); assert.equal(calls.length, 0);
});
test('logout revokes discovery tickets along with existing session access', async t => {
  const { call, auth, calls } = await fixture(t);
  assert.equal((await call('/api/logout', { method: 'POST', headers: auth, body: '{}' })).status, 200);
  assert.equal(calls[0][0], 'revoke'); assert.equal((await call('/api/discover/catalog', { headers: auth })).status, 401);
});
test('same-origin modules are served, API connections stay local, and media is limited to TorBox CDNs', async t => {
  const { call } = await fixture(t);
  for (const path of ['/discover.js', '/source-client.js', '/discover.css']) assert.equal((await call(path)).status, 200);
  const policy = (await call('/')).headers.get('content-security-policy');
  assert.ok(policy.includes('media-src https://torbox.app')); assert.ok(policy.includes('https://*.tb-cdn.io'));
  assert.ok(policy.includes("connect-src 'self';"));
  assert.ok(!policy.includes('api.torbox.app'));
});
test('revocation during an in-flight discovery request prevents returning its data', async t => {
  const { call, auth, discovery, sessions } = await fixture(t);
  discovery.catalog.search = async () => { sessions.revokeAll(); return { private: true }; };
  const r = await call('/api/discover/catalog', { headers: auth }); assert.equal(r.status, 401); assert.ok(!(await r.text()).includes('private'));
});

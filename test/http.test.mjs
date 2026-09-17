import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
const password = 'fixture-password-only';
const hash = await hashPassword(password);
async function fixture(t, extra = {}) {
  const provider = { list: async () => ({ files: [], stale: false }), account: async () => ({ valid: true }), resolve: async () => ({ url: 'https://cdn.torbox.app/fixture', file: { id: 'torrents:1:0' } }), ...extra };
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: hash, PUBLIC_ORIGIN: 'https://player.example.test', NODE_ENV: 'production' }, provider });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, { method = 'GET', data, cookie, csrf, origin = 'https://player.example.test' } = {}) => fetch(base + path, { method, headers: { Origin: origin, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const login = async () => { const result = await call('/api/login', { method: 'POST', data: { password } }); const cookie = result.headers.get('set-cookie').split(';')[0]; const data = await result.json(); return { cookie, csrf: data.csrf }; };
  return { ...app, call, login };
}
test('signed-out browsers cannot access protected routes', async t => {
  const { call } = await fixture(t);
  for (const [path, method] of [['/api/library', 'GET'], ['/api/playback', 'POST'], ['/api/progress', 'PUT'], ['/api/owner/diagnostics', 'POST']]) assert.equal((await call(path, { method, data: method === 'GET' ? undefined : {} })).status, 401);
});
test('invalid/missing configuration fails closed and exposes no secret', async t => {
  const app = createApp({ env: { TORBOX_API_KEY: 'fixture-secret', PUBLIC_ORIGIN: 'https://player.example.test' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = await (await fetch(base + '/api/session')).json(); assert.equal(session.setupRequired, true); assert.equal(session.authenticated, false); assert.ok(!JSON.stringify(session).includes('fixture-secret'));
  assert.equal((await fetch(base + '/api/library')).status, 401);
});
test('login rejects a forged origin and wrong password', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/login', { method: 'POST', data: { password }, origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('/api/login', { method: 'POST', data: { password: 'wrong' } })).status, 401);
});
test('login cookie is Secure, HttpOnly and SameSite; logout revokes it', async t => {
  const { call } = await fixture(t);
  const response = await call('/api/login', { method: 'POST', data: { password } }); const header = response.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(header.includes(attribute));
  const auth = { cookie: header.split(';')[0], csrf: (await response.json()).csrf };
  assert.equal((await call('/api/library', auth)).status, 200);
  assert.equal((await call('/api/logout', { ...auth, method: 'POST', data: {} })).status, 200);
  assert.equal((await call('/api/library', auth)).status, 401);
});
test('CSRF token is required on every authenticated mutation', async t => {
  const { call, login } = await fixture(t), auth = await login();
  assert.equal((await call('/api/playback', { cookie: auth.cookie, method: 'POST', data: { viewer: 'viewer-1', videoId: 'torrents:1:0' } })).status, 403);
});
test('owner tools require password re-entry; revoke-all invalidates both sessions', async t => {
  const { call, login } = await fixture(t), a = await login(), b = await login();
  assert.equal((await call('/api/owner/diagnostics', { ...a, method: 'POST', data: {} })).status, 403);
  assert.equal((await call('/api/owner/unlock', { ...a, method: 'POST', data: { password } })).status, 200);
  assert.equal((await call('/api/owner/diagnostics', { ...a, method: 'POST', data: {} })).status, 200);
  assert.equal((await call('/api/owner/revoke', { ...a, method: 'POST', data: {} })).status, 200);
  assert.equal((await call('/api/library', a)).status, 401); assert.equal((await call('/api/library', b)).status, 401);
});
test('arbitrary URL proxy and directory traversal are not exposed', async t => {
  const { call, login } = await fixture(t), auth = await login();
  assert.equal((await call('/api/proxy?url=http://127.0.0.1', auth)).status, 404);
  assert.equal((await call('/lib/auth.mjs')).status, 404);
  assert.equal((await call('/.env')).status, 404);
});
test('private responses disable caching and frames', async t => {
  const { call } = await fixture(t), response = await call('/api/session');
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(response.headers.get('x-frame-options'), 'DENY'); assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
});
test('HTTP playback and progress use viewer-bound leases and resume', async t => {
  const { call, login } = await fixture(t), auth = await login();
  const start = async () => (await call('/api/playback', { ...auth, method: 'POST', data: { viewer: 'viewer-1', videoId: 'torrents:1:0' } })).json();
  const one = await start();
  const save = await call('/api/progress', { ...auth, method: 'PUT', data: { viewer: 'viewer-1', videoId: 'torrents:1:0', leaseId: one.leaseId, seq: 1, position: 45, duration: 100 } });
  assert.equal((await save.json()).saved, true); assert.equal((await start()).progress.position, 45);
});

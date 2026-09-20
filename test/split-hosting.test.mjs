import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
const password = 'fixture-password-only';
const hash = await hashPassword(password);
const page = 'https://to-shreds.github.io';
async function fixture(t) {
  const provider = { list: async () => ({ files: [], stale: false }), account: async () => ({ valid: true }), resolveForRelay: async videoId => ({ upstreamUrl: 'https://store.tb-cdn.io/file?token=secret', file: { id: videoId } }) };
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: hash, PUBLIC_ORIGIN: 'https://torbox-web-player.onrender.com', FRONTEND_ORIGINS: page, NODE_ENV: 'production' }, provider });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, { method='GET', data, token, origin=page, headers={} }={}) => fetch(base+path, { method, headers: { Origin: origin, ...(data?{'Content-Type':'application/json'}:{}), ...(token?{Authorization:`Bearer ${token}`}:{}), ...headers }, body: data ? JSON.stringify(data) : undefined });
  return { ...app, call };
}
test('GitHub Pages origin receives narrowly scoped CORS preflight', async t => {
  const { call } = await fixture(t);
  const r = await call('/api/login', { method:'OPTIONS', headers:{ 'Access-Control-Request-Method':'POST', 'Access-Control-Request-Headers':'content-type,authorization' } });
  assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), page);
  assert.ok(r.headers.get('access-control-allow-headers').includes('Authorization'));
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
});
test('unapproved frontends do not get CORS access', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/login', { method:'OPTIONS', origin:'https://evil.test' })).status, 403);
  const r = await call('/api/session', { origin:'https://evil.test' });
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
test('cross-site login returns an opaque bearer and API works without Render cookies', async t => {
  const { call } = await fixture(t);
  const login = await call('/api/login', { method:'POST', data:{password} });
  assert.equal(login.status,200); assert.equal(login.headers.get('access-control-allow-origin'),page);
  const data=await login.json(); assert.match(data.sessionToken,/^[A-Za-z0-9_-]{43}$/);
  const library=await call('/api/library',{token:data.sessionToken}); assert.equal(library.status,200);
  assert.equal(library.headers.get('access-control-allow-origin'),page);
});
test('bearer mutations require the approved frontend but not a third-party cookie or CSRF token', async t => {
  const { call }=await fixture(t);
  const token=(await (await call('/api/login',{method:'POST',data:{password}})).json()).sessionToken;
  assert.equal((await call('/api/playback',{method:'POST',token,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).status,200);
  assert.equal((await call('/api/playback',{method:'POST',token,origin:'https://evil.test',data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).status,403);
});
test('published direct HTML uses project-relative assets and permits only the Render bridge, not the old API origin', async t => {
  const { call }=await fixture(t);
  const html=await (await call('/')).text();
  assert.ok(html.includes('name="runtime-mode" content="direct"'));
  assert.ok(!html.includes('name="api-origin"'));
  assert.ok(html.includes('https://torbox-web-player-key.onrender.com'));
  assert.ok(html.includes('https://torbox-web-player-relay.jonathanjablon.workers.dev'));
  assert.ok(html.includes('href="./style.css"')); assert.ok(html.includes('src="./app.js?v=2.0.6"'));
  assert.ok(!html.includes('src="/app.js"')); assert.ok(!html.includes('href="/style.css"'));
});
test('GitHub Pages bearer session receives a direct TorBox media URL, never a Render media ticket', async t => {
  const { call }=await fixture(t);
  const token=(await (await call('/api/login',{method:'POST',data:{password}})).json()).sessionToken;
  const play=await (await call('/api/playback',{method:'POST',token,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();
  assert.equal(play.delivery,'direct'); assert.equal(play.exposesTorBoxToken,true);
  assert.match(play.mediaUrl,/^https:\/\/store\.tb-cdn\.io\/file\?token=secret$/);
  assert.ok(!play.mediaUrl.includes('/media/'));
});
test('Render has no media relay route in split hosting', async t => {
  const { call }=await fixture(t);
  assert.equal((await call('/media/'+'a'.repeat(43),{headers:{Range:'bytes=0-0'}})).status,404);
});
test('bearer logout revokes API access but direct TorBox media is independent of Render', async t => {
  const { call }=await fixture(t);
  const token=(await (await call('/api/login',{method:'POST',data:{password}})).json()).sessionToken;
  assert.equal((await call('/api/logout',{method:'POST',token,data:{}})).status,200);
  assert.equal((await call('/api/library',{token})).status,401);
});

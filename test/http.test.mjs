import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
const password = 'fixture-password-only';
const hash = await hashPassword(password);
const defaultMediaFetch = async (_url, options = {}) => new Response(Buffer.from('A'), { status: options.headers?.Range ? 206 : 200, headers: { 'content-type': 'video/mp4', 'content-length': '1', 'accept-ranges': 'bytes', ...(options.headers?.Range ? { 'content-range': 'bytes 0-0/100' } : {}) } });
async function fixture(t, { providerExtra = {}, mediaFetch = defaultMediaFetch } = {}) {
  const provider = { list: async () => ({ files: [], stale: false }), account: async () => ({ valid: true }), resolveForRelay: async videoId => ({ upstreamUrl: 'https://store.tb-cdn.io/fixture?token=fixture-secret', file: { id: videoId } }), ...providerExtra };
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: hash, PUBLIC_ORIGIN: 'https://player.example.test', NODE_ENV: 'production' }, provider, mediaFetch });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = (path, { method = 'GET', data, cookie, csrf, origin = 'https://player.example.test', headers: extraHeaders = {} } = {}) => fetch(base + path, { method, headers: { Origin: origin, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...extraHeaders }, body: data ? JSON.stringify(data) : undefined });
  const login = async () => { const result = await call('/api/login', { method: 'POST', data: { password } }); const cookie = result.headers.get('set-cookie').split(';')[0]; const data = await result.json(); return { cookie, csrf: data.csrf }; };
  return { ...app, call, login };
}
test('signed-out browsers cannot access protected API routes', async t => {
  const { call } = await fixture(t);
  for (const [path, method] of [['/api/library', 'GET'], ['/api/playback', 'POST'], ['/api/progress', 'PUT'], ['/api/owner/diagnostics', 'POST']]) assert.equal((await call(path, { method, data: method === 'GET' ? undefined : {} })).status, 401);
});
test('invalid/missing configuration fails closed and exposes no secret', async t => {
  const app = createApp({ env: { TORBOX_API_KEY: 'fixture-secret', PUBLIC_ORIGIN: 'https://player.example.test' } }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => { app.server.closeAllConnections(); app.server.close(); }); const base = `http://127.0.0.1:${app.server.address().port}`; const session = await (await fetch(base + '/api/session')).json(); assert.equal(session.setupRequired, true); assert.equal(session.authenticated, false); assert.ok(!JSON.stringify(session).includes('fixture-secret')); assert.equal((await fetch(base + '/api/library')).status, 401);
});
test('login rejects a forged origin and wrong password', async t => {
  const { call } = await fixture(t); assert.equal((await call('/api/login', { method: 'POST', data: { password }, origin: 'https://evil.test' })).status, 403); assert.equal((await call('/api/login', { method: 'POST', data: { password: 'wrong' } })).status, 401);
});
test('login cookie is Secure, HttpOnly and SameSite; logout revokes it', async t => {
  const { call } = await fixture(t); const response = await call('/api/login', { method: 'POST', data: { password } }); const header = response.headers.get('set-cookie'); for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(header.includes(attribute)); const auth = { cookie: header.split(';')[0], csrf: (await response.json()).csrf }; assert.equal((await call('/api/library', auth)).status, 200); assert.equal((await call('/api/logout', { ...auth, method: 'POST', data: {} })).status, 200); assert.equal((await call('/api/library', auth)).status, 401);
});
test('CSRF token is required on every authenticated mutation', async t => {
  const { call, login } = await fixture(t), auth = await login(); assert.equal((await call('/api/playback', { cookie: auth.cookie, method: 'POST', data: { viewer: 'viewer-1', videoId: 'torrents:1:0' } })).status, 403);
});
test('owner tools require password re-entry; revoke-all invalidates both sessions', async t => {
  const { call, login } = await fixture(t), a = await login(), b = await login(); assert.equal((await call('/api/owner/diagnostics', { ...a, method: 'POST', data: {} })).status, 403); assert.equal((await call('/api/owner/unlock', { ...a, method: 'POST', data: { password } })).status, 200); assert.equal((await call('/api/owner/diagnostics', { ...a, method: 'POST', data: {} })).status, 200); assert.equal((await call('/api/owner/revoke', { ...a, method: 'POST', data: {} })).status, 200); assert.equal((await call('/api/library', a)).status, 401); assert.equal((await call('/api/library', b)).status, 401);
});
test('arbitrary URL proxy and directory traversal are not exposed', async t => {
  const { call, login } = await fixture(t), auth = await login(); assert.equal((await call('/api/proxy?url=http://127.0.0.1', auth)).status, 404); assert.equal((await call('/media?url=http://127.0.0.1', auth)).status, 404); assert.equal((await call('/lib/auth.mjs')).status, 404); assert.equal((await call('/.env')).status, 404);
});
test('private responses disable caching and frames', async t => {
  const { call } = await fixture(t), response = await call('/api/session'); const policy=response.headers.get('content-security-policy');assert.equal(response.headers.get('cache-control'), 'no-store, private'); assert.equal(response.headers.get('x-frame-options'), 'DENY'); assert.ok(policy.includes("frame-ancestors 'none'")); assert.ok(policy.includes("media-src 'self'"));assert.ok(!policy.includes('tb-cdn.io'));
});

test('playback returns only an opaque media ticket and progress resumes', async t => {
  const { call, login } = await fixture(t), auth = await login();
  const start = async () => (await call('/api/playback', { ...auth, method: 'POST', data: { viewer: 'viewer-1', videoId: 'torrents:1:0' } })).json();
  const one = await start();
  assert.equal(one.delivery, 'relay'); assert.equal(one.exposesTorBoxToken, false);
  assert.match(one.mediaUrl, /^\/media\/[A-Za-z0-9_-]{43}$/);assert.ok(!JSON.stringify(one).includes('fixture-secret'));assert.ok(!JSON.stringify(one).includes('tb-cdn'));
  const save = await call('/api/progress', { ...auth, method: 'PUT', data: { viewer: 'viewer-1', videoId: 'torrents:1:0', leaseId: one.leaseId, seq: 1, position: 45, duration: 100 } });
  assert.equal((await save.json()).saved, true); assert.equal((await start()).progress.position, 45);
});
test('playback refuses an actual AVI before creating a browser media ticket',async t=>{
  const providerExtra={resolveForRelay:async videoId=>({upstreamUrl:'https://store.tb-cdn.io/fixture?token=fixture-secret',file:{id:videoId,title:'Fixture.avi',mime:'video/x-msvideo'}})};
  const {call,login,mediaTickets}=await fixture(t,{providerExtra}),auth=await login();
  const response=await call('/api/playback',{...auth,method:'POST',data:{viewer:'viewer-1',videoId:'torrents:1:0'}}),body=await response.json();
  assert.equal(response.status,415);assert.equal(body.error,'BROWSER_CONTAINER_UNSUPPORTED');assert.equal(mediaTickets.rows.size,0);
});
test('media relay forwards one byte range without exposing the upstream URL', async t => {
  let seen;const mediaFetch=async(url,options)=>{seen={url:String(url),range:options.headers.Range};return new Response(Buffer.from('Z'),{status:206,headers:{'content-type':'video/mp4','content-length':'1','accept-ranges':'bytes','content-range':'bytes 0-0/100'}});};
  const {call,login}=await fixture(t,{mediaFetch}),auth=await login();const playback=await (await call('/api/playback',{...auth,method:'POST',data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();
  const media=await call(playback.mediaUrl,{headers:{Range:'bytes=0-0'}});assert.equal(media.status,206);assert.equal(await media.text(),'Z');assert.equal(media.headers.get('content-range'),'bytes 0-0/100');assert.equal(media.headers.get('cross-origin-resource-policy'),'cross-origin');assert.equal(seen.range,'bytes=0-0');assert.ok(seen.url.includes('fixture-secret'));assert.ok(!media.url.includes('tb-cdn'));
});
test('media tickets reject another signed-in session and malformed ranges',async t=>{
  let fetches=0;const {call,login}=await fixture(t,{mediaFetch:async()=>{fetches++;return defaultMediaFetch('',{headers:{Range:'bytes=0-0'}});}}),a=await login(),b=await login();
  const playback=await (await call('/api/playback',{...a,method:'POST',data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();
  assert.equal((await call(playback.mediaUrl,{cookie:b.cookie,headers:{Range:'bytes=0-0'}})).status,404);
  assert.equal((await call(playback.mediaUrl,{headers:{Range:'bytes=0-1,4-5'}})).status,416);assert.equal(fetches,0);
});
test('expired upstream link is renewed once with the ticket session provider',async t=>{
  let resolves=0,fetches=0;const providerExtra={resolveForRelay:async videoId=>({upstreamUrl:`https://store.tb-cdn.io/${++resolves===1?'expired':'fresh'}?token=fixture-secret`,file:{id:videoId,title:'Fixture.mp4'}})};
  const mediaFetch=async url=>{fetches++;if(String(url).includes('/expired'))return new Response('expired',{status:403});return new Response(Buffer.from('R'),{status:206,headers:{'content-type':'application/octet-stream','content-length':'1','accept-ranges':'bytes','content-range':'bytes 0-0/100'}});};
  const {call,login}=await fixture(t,{providerExtra,mediaFetch}),auth=await login();const playback=await (await call('/api/playback',{...auth,method:'POST',data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();const media=await call(playback.mediaUrl,{headers:{Range:'bytes=0-0'}});
  assert.equal(media.status,206);assert.equal(await media.text(),'R');assert.equal(media.headers.get('content-type'),'video/mp4');assert.equal(resolves,2);assert.equal(fetches,2);
});

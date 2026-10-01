import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const origin = 'https://player.example.test';
const file = id => ({ id, title: 'Fixture.mp4', state: 'Ready to watch' });
async function fixture(t, overrides = {}) {
  let mediaCalls = 0;
  const provider = { key: 'fixture-master-key', account: async () => ({ valid: true }),
    resolveForRelay: async id => ({ file: file(id), upstreamUrl: 'https://store.tb-cdn.io/file?token=fixture-master-key' }),
    resolveGuest: async id => ({ file: file(id), url: 'https://store.tb-cdn.io/file?token=temporary-token' }),
    ...overrides.provider };
  const app = createApp({ env: { AUTH_MODE: 'api-key', PUBLIC_ORIGIN: origin }, ...overrides,
    provider, mediaFetch: async () => { mediaCalls++; return new Response('forbidden-video-bytes'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = (guest = false) => { const s = app.sessions.create(); Object.assign(s.row, { provider, guest, allowedVideos: new Set(['torrents:1:0']) }); return s.id; };
  const call = (path, token, data, method = data ? 'POST' : 'GET', extra = {}) => fetch(base + path, {
    method, redirect: 'manual', headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: data ? JSON.stringify(data) : undefined
  });
  const play = (token, videoId = 'torrents:1:0') => call('/api/playback', token, { viewer: 'viewer-1', videoId });
  return { ...app, provider, session, call, play, mediaCalls: () => mediaCalls };
}

test('slow playback on one device is not superseded by another device using Viewer 1', async t => {
  let unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const f = await fixture(t, { provider: { resolveForRelay: async id => { if (id === 'torrents:1:0') await gate; return { file: file(id), upstreamUrl: 'https://store.tb-cdn.io/file' }; } } });
  const a = f.session(), b = f.session();
  const slow = f.play(a);
  while (!f.progress.intents.size) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.play(b, 'torrents:2:0')).status, 200);
  unblock();
  assert.equal((await slow).status, 200);
});

test('two devices retain independent progress leases and private resume positions', async t => {
  const f = await fixture(t), a = f.session(), b = f.session();
  const first = await (await f.play(a)).json();
  const second = await (await f.play(b)).json();
  const save = await f.call('/api/progress', a, { viewer: 'viewer-1', videoId: 'torrents:1:0', leaseId: first.leaseId, seq: 1, position: 85, duration: 120 }, 'PUT');
  assert.equal((await save.json()).saved, true);
  assert.equal((await (await f.play(b)).json()).progress.position, 0);
  assert.equal((await (await f.play(a)).json()).progress.position, 85);
  assert.notEqual(first.leaseId, second.leaseId);
});

test('one busy device cannot exhaust another device playback allowance', async t => {
  const f = await fixture(t), a = f.session(), b = f.session();
  for (let i = 0; i < 30; i++) assert.equal((await f.play(a)).status, 200);
  assert.equal((await f.play(a)).status, 429);
  assert.equal((await f.play(b)).status, 200);
});

test('guest media redirects without any server media fetch when TorBox supplies a safe link', async t => {
  const f = await fixture(t), guest = f.session(true);
  const response = await f.play(guest), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.delivery, 'direct');
  assert.equal(body.exposesTorBoxToken, false);
  const media = await f.call(body.mediaUrl, guest);
  assert.equal(media.status, 307);
  assert.equal(media.headers.get('location'), 'https://store.tb-cdn.io/file?token=temporary-token');
  assert.equal(await media.text(), '');
  assert.equal(f.mediaCalls(), 0);
});

test('guest key-bearing links fail closed with no ticket, redirect, or byte relay', async t => {
  const f = await fixture(t, { provider: { resolveGuest: async id => ({ file: file(id), url: 'https://store.tb-cdn.io/file?token=fixture-master-key' }) } });
  const response = await f.play(f.session(true)), text = await response.text();
  assert.equal(response.status, 409);
  assert.equal(JSON.parse(text).error, 'GUEST_DIRECT_UNAVAILABLE');
  assert.ok(!text.includes('fixture-master-key'));
  assert.equal(f.mediaTickets.rows.size, 0);
  assert.equal(f.mediaCalls(), 0);
});

test('every startup module is served on the backend mirror, including vault', async t => {
  const f = await fixture(t);
  const response = await f.call('/vault.js?v=release-1.2.0');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /loadRememberedApiKey/);
});

test('range validation rejects reversed, zero-suffix and unsafe-integer ranges before redirect', async t => {
  const f = await fixture(t), owner = f.session();
  const playback = await (await f.play(owner)).json();
  for (const Range of ['bytes=9-1', 'bytes=-0', 'bytes=9007199254740992-']) {
    const response = await f.call(playback.mediaUrl, owner, undefined, 'GET', { Range });
    assert.equal(response.status, 416, Range);
    assert.equal(response.headers.get('location'), null);
  }
  assert.equal(f.mediaCalls(), 0);
});

test('24 devices can start 12 episodes and seek repeatedly without relaying any media', async t => {
  const f = await fixture(t), devices = Array.from({length: 24}, () => f.session());
  let redirects = 0, bodyBytes = 0;
  const started = performance.now(), latencies = [];
  for(let episode=0; episode<12; episode++) {
    await Promise.all(devices.map(async token => {
      const start = performance.now();
      const playback = await f.play(token, `torrents:1:${episode}`);
      assert.equal(playback.status, 200);
      const data = await playback.json();
      for(const Range of ['bytes=0-1048575', 'bytes=1073741824-1074790399']) {
        const media = await f.call(data.mediaUrl, token, undefined, 'GET', {Range});
        assert.equal(media.status, 307);redirects++;bodyBytes+=(await media.arrayBuffer()).byteLength;
      }
      latencies.push(performance.now()-start);
    }));
  }
  assert.equal(redirects, 576);assert.equal(bodyBytes, 0);assert.equal(f.mediaCalls(), 0);
  assert.equal(f.mediaTickets.rows.size, 24*8);
  latencies.sort((a,b)=>a-b);
  t.diagnostic(JSON.stringify({devices:24,playbackStarts:288,seekRedirects:redirects,mediaBodyBytes:bodyBytes,upstreamMediaFetches:f.mediaCalls(),durationMs:Math.round(performance.now()-started),p50Ms:Math.round(latencies[144]),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)])}));
});

test('a burst of status checks shares one account check and one public status request', async t => {
  let accounts=0,publicChecks=0;
  const f=await fixture(t,{provider:{account:async()=>{accounts++;await new Promise(resolve=>setTimeout(resolve,50));return{valid:true};}},discoveryFetch:async()=>{publicChecks++;await new Promise(resolve=>setTimeout(resolve,50));return new Response('All systems operational');}});
  const tokens=Array.from({length:24},()=>f.session());
  const results=await Promise.all(tokens.map(token=>f.call('/api/torbox-status',token).then(response=>response.json())));
  assert.ok(results.every(row=>row.ok));assert.equal(accounts,1);assert.equal(publicChecks,1);
});

test('public catalog cache is shared between separately authenticated devices',async t=>{
  let catalogReads=0;
  const f=await fixture(t,{providerFactory:key=>({key,account:async()=>({valid:true})}),discoveryFetch:async()=>{catalogReads++;await new Promise(resolve=>setTimeout(resolve,20));return Response.json({metas:[{id:'tt1234567',type:'movie',name:'Fixture'}]});}});
  const tokens=[];
  for(let i=0;i<4;i++){const response=await f.call('/api/login',null,{apiKey:'fixture-key-'+i});assert.equal(response.status,200);tokens.push((await response.json()).sessionToken);}
  const results=await Promise.all(tokens.map(token=>f.call('/api/discover/catalog?type=movie',token).then(response=>response.json())));
  assert.ok(results.every(row=>row.metas[0].name==='Fixture'));assert.equal(catalogReads,1);
});

test('quota-limited Drive exports cannot start in this release',async t=>{
  const f=await fixture(t),owner=f.session();
  for(const path of ['/api/drive/connect','/api/drive/test/start']){
    const response=await f.call(path,owner,{videoId:'torrents:1:0'});
    assert.equal(response.status,410);assert.equal((await response.json()).error,'DRIVE_SHARING_DISABLED');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { TorBox } from '../lib/torbox.mjs';
import { normalizePartySnapshot } from '../public/watch-party-core.js';

const origin = 'https://party.fixture.test', hash = 'a'.repeat(40), target = { type: 'series', id: 'tt1234567', season: 1, episode: 2 };
const identity = { kind: 'torrent', hash, path: 'Season 1/Fixture.S01E02.mp4', size: 123456 };
const item = id => ({ id, hash, name: 'Fixture source', download_finished: true, download_present: true,
  files: [{ id: 7, name: identity.path, short_name: 'Fixture.S01E02.mp4', size: identity.size, mimetype: 'video/mp4' }] });
const reply = data => new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t) {
  let clock = Date.now(), guestLink = null, ownerLink = null, requestGate = null, requests = 0;
  const calls = [], items = new Map([['host-secret-key', item(11)], ['guest-secret-key', item(22)], ['third-secret-key', item(33)]]);
  const app = createApp({ now: () => clock, env: { AUTH_MODE: 'api-key', PUBLIC_ORIGIN: origin },
    providerFactory: key => new TorBox({ key, fetchFn: async (url, options = {}) => {
      const u = new URL(url); calls.push({ key, path: u.pathname, query: u.search, method: options.method || 'GET' });
      if (requestGate?.path === u.pathname) { requestGate.entered.resolve(); await requestGate.release.promise; }
      if (u.pathname.endsWith('/user/me')) return reply({ plan: 1 });
      if (u.pathname.endsWith('/torrents/mylist')) return reply(items.has(key) ? [items.get(key)] : []);
      if (u.pathname.endsWith('/torrents/requestdl')) {
        if (u.searchParams.get('redirect') === 'true') return new Response(null, { status: 302, headers: { Location: guestLink || `https://store.tb-cdn.io/guest-ticket-${++requests}` } });
        return reply(ownerLink || `https://store.tb-cdn.io/file?token=${key}&link=${++requests}`);
      }
      throw new Error('Unexpected provider call');
    } }), mediaFetch: async () => { throw new Error('Media bytes must never pass through this server'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, data = {}, session = null, headers = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.sessionToken}` } : {}), ...headers }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json(), response };
  };
  const get = async (path, session = null, headers = {}) => {
    const response = await fetch(base + path, { redirect: 'manual', headers: { ...(session ? { Authorization: `Bearer ${session.sessionToken}` } : {}), ...headers } });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null, response };
  };
  const login = async key => { const result = await call('/api/login', { apiKey: key }); assert.equal(result.status, 200); return result.data; };
  const playback = (session, id = 11) => call('/api/playback', { viewer: 'viewer-1', videoId: `torrents:${id}:7` }, session);
  const create = async (host, position = 10, options = {}) => {
    const hp = await playback(host); assert.equal(hp.status, 200);
    const result = await call('/api/watch-party/create', { playbackProof: hp.data.playbackProof, target, title: 'Fixture show', duration: 120, position, ...options }, host);
    assert.equal(result.status, 200); return { ...result.data, hostPlayback: hp.data };
  };
  const gate = path => { requestGate = { path: '/v1/api/' + path, entered: deferred(), release: deferred() }; return requestGate; };
  return { ...app, base, call, get, login, playback, create, calls, items, gate, advance: ms => { clock += ms; }, link: value => { guestLink = value; }, ownerLink: value => { ownerLink = value; } };
}
const status = (roomId, playbackProof, command) => ({ roomId, playbackProof, ready: true, buffering: false, blocked: false, duration: 120, position: 10, ...(command ? { command } : {}) });

async function joinedFixture(t, { ownerGuest = false, consent = false } = {}) {
  const f = await fixture(t), host = await f.login('host-secret-key'), previous = ownerGuest ? await f.login('guest-secret-key') : null;
  const created = await f.create(host, 10, { allowAccountKeyInPlayback: consent }), joined = await f.call('/api/watch-party/join', { token: created.joinToken }, previous);
  assert.equal(joined.status, 200); return { ...f, host, previous, created, guest: joined.data, joinResponse: joined.response, roomId: created.room.id };
}

test('join works before login but preserves trusted origin, bounded request bodies, and redemption rate limits', async t => {
  const f = await fixture(t);
  for (const action of ['create', 'prepare', 'sync', 'leave']) assert.equal((await f.call('/api/watch-party/' + action)).status, 401);
  assert.equal((await f.call('/api/watch-party/join', { token: 'x'.repeat(43) })).status, 404);
  assert.equal((await f.call('/api/watch-party/join', {}, null, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.call('/api/watch-party/join', { token: 'x'.repeat(8300) })).status, 413);
  for (let i = 0; i < 13; i++) assert.equal((await f.call('/api/watch-party/join', { token: 'x'.repeat(43) })).status, 404);
  assert.equal((await f.call('/api/watch-party/join', { token: 'x'.repeat(43) })).status, 429);
  const owner = await f.login('host-secret-key');
  const csrf = await f.call('/api/watch-party/create', {}, null, { Cookie: `tw_session=${owner.sessionToken}` }); assert.equal(csrf.status, 403);
});

test('keyless guest loads the host exact file with its own key-free link and playback proof', async t => {
  const f = await joinedFixture(t), { guest, host, roomId, created } = f;
  assert.equal(guest.guest, true); assert.equal(guest.partyGuest, true); assert.equal(guest.room.role, 'guest');
  assert.match(guest.sessionToken, /^[A-Za-z0-9_-]{43}$/); normalizePartySnapshot(guest);
  assert.equal((await f.playback(guest)).status, 403);
  const prepared = await f.call('/api/watch-party/prepare', { roomId }, guest);
  assert.equal(prepared.status, 200); assert.equal(prepared.data.file.id, 'torrents:11:7'); assert.deepEqual(prepared.data.playbackContext.current, target);
  const gp = await f.playback(guest); assert.equal(gp.status, 200); assert.deepEqual(gp.data.mediaIdentity, identity);
  assert.match(gp.data.playbackProof, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(gp.data.playbackProof, created.hostPlayback.playbackProof);
  assert.equal(gp.data.guestSafeLink, true); assert.equal(gp.data.exposesTorBoxToken, false);
  assert.equal((await f.call('/api/watch-party/sync', status(roomId, created.hostPlayback.playbackProof), host)).status, 200);
  assert.equal((await f.call('/api/watch-party/sync', status(roomId, gp.data.playbackProof), guest)).status, 200);
  const play = await f.call('/api/watch-party/sync', status(roomId, gp.data.playbackProof, { seq: 1, type: 'play', position: 10 }), guest);
  assert.equal(play.status, 200); assert.equal(play.data.room.state.phase, 'scheduled'); normalizePartySnapshot(play.data);
  const media = await f.get(gp.data.mediaUrl); assert.equal(media.status, 307); assert.match(media.response.headers.get('location'), /^https:\/\/store\.tb-cdn\.io\/guest-ticket-/);
  assert.equal(await media.response.text(), '');
  assert.ok(f.calls.every(call => call.key === 'host-secret-key'));
  assert.equal(f.calls.filter(call => call.path.endsWith('/requestdl')).length, 2);
  assert.ok(!f.calls.some(call => /createtorrent|checkcached/.test(call.path)));
  const snapshot = JSON.stringify([created.room, guest.room, prepared.data, play.data]);
  for (const secret of ['host-secret-key', gp.data.mediaUrl, gp.data.playbackProof, 'https://store', 'ownerId', 'sessionId']) assert.ok(!snapshot.includes(secret), secret);
});

test('signed-in viewers join through a separate limited session while their account and cookie remain intact', async t => {
  const f = await joinedFixture(t, { ownerGuest: true });
  assert.notEqual(f.guest.sessionToken, f.previous.sessionToken); assert.equal(f.joinResponse.headers.has('set-cookie'), false);
  const ownerSession = await f.get('/api/session', f.previous); assert.equal(ownerSession.data.authenticated, true); assert.equal(ownerSession.data.guest, false);
  const prepared = await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest); assert.equal(prepared.data.file.id, 'torrents:11:7');
  const gp = await f.playback(f.guest); assert.equal(gp.status, 200);
  // The browser still sends its original owner cookie for the native video request.
  assert.equal((await f.get(gp.data.mediaUrl, null, { Cookie: `tw_session=${f.previous.sessionToken}` })).status, 307);
  assert.equal((await f.playback(f.previous, 22)).status, 200);
  const leave = await f.call('/api/watch-party/leave', { roomId: f.roomId }, f.guest); assert.equal(leave.status, 200); assert.equal(leave.response.headers.has('set-cookie'), false);
  assert.equal((await f.get('/api/session', f.previous)).data.authenticated, true);
  assert.equal((await f.playback(f.previous, 22)).status, 200);
});

test('party session restores its scoped snapshot on reload and retries join without minting another membership', async t => {
  const f = await joinedFixture(t), restored = await f.get('/api/session', f.guest);
  assert.equal(restored.status, 200); assert.equal(restored.data.partyGuest, true); assert.equal(restored.data.partyRoomId, f.roomId);
  assert.equal(restored.data.partySnapshot.room.role, 'guest'); normalizePartySnapshot(restored.data.partySnapshot);
  assert.deepEqual(restored.data.scope, { ...target, name: 'Fixture show' });
  const retry = await f.call('/api/watch-party/join', { token: f.created.joinToken }, f.guest);
  assert.equal(retry.status, 200); assert.equal(retry.data.sessionToken, f.guest.sessionToken); assert.equal(f.sessions.rows.size, 2);
});

test('party guests cannot access library, account, discovery, setup, sharing, another room, or another file', async t => {
  const f = await joinedFixture(t);
  for (const path of ['/api/library', '/api/torbox-status', '/api/discover/catalog?type=movie', '/api/discover/meta?type=series&id=tt1234567', '/api/discover/lookup?type=series&id=tt1234567&season=1&episode=3', '/api/drive/config']) assert.equal((await f.get(path, f.guest)).status, 403, path);
  for (const path of ['/api/watch-party/create', '/api/setup-transfer', '/api/share/create', '/api/owner/unlock', '/api/owner/diagnostics', '/api/discover/sources', '/api/discover/prepare']) assert.equal((await f.call(path, {}, f.guest)).status, 403, path);
  for (const action of ['prepare', 'sync', 'leave']) assert.equal((await f.call('/api/watch-party/' + action, { ...status('x'.repeat(16)), roomId: 'x'.repeat(16) }, f.guest)).status, 404);
  await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  assert.equal((await f.playback(f.guest, 22)).status, 403);
  const outsider = await f.login('third-secret-key');
  assert.equal((await f.call('/api/watch-party/join', { token: f.created.joinToken }, outsider)).status, 409);
  assert.equal((await f.call('/api/watch-party/prepare', { roomId: f.roomId }, outsider)).status, 404);
});

test('guest playback rejects host master key in direct or percent-encoded URLs without issuing a media ticket', async t => {
  for (const leak of ['host-secret-key', '%68ost-secret-key']) {
    const f = await joinedFixture(t); await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
    f.link('https://store.tb-cdn.io/file?token=' + leak);
    const result = await f.playback(f.guest); assert.equal(result.status, 409); assert.equal(result.data.error, 'GUEST_DIRECT_UNAVAILABLE');
    assert.ok(!JSON.stringify(result.data).includes('host-secret-key'));
    assert.equal([...f.mediaTickets.rows.values()].filter(row => row.sessionId === f.sessions.read(f.guest.sessionToken).id).length, 0);
  }
});

test('only explicit host creation consent permits a freshly generated key-bearing TorBox CDN link', async t => {
  const f = await joinedFixture(t, { consent: true });
  assert.equal(f.watchParties.rooms.get(f.roomId).allowAccountKeyInPlayback, true);
  await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  const gp = await f.playback(f.guest); assert.equal(gp.status, 200); assert.equal(gp.data.exposesTorBoxToken, true); assert.equal(gp.data.guestSafeLink, false);
  const hostMedia = await f.get(f.created.hostPlayback.mediaUrl), guestMedia = await f.get(gp.data.mediaUrl);
  assert.equal(guestMedia.status, 307); assert.match(guestMedia.response.headers.get('location'), /token=host-secret-key/);
  assert.notEqual(guestMedia.response.headers.get('location'), hostMedia.response.headers.get('location'));
  assert.equal(f.calls.filter(call => call.path.endsWith('/requestdl') && new URLSearchParams(call.query).get('redirect') === 'false').length, 2);
  assert.ok(!JSON.stringify([f.created, f.guest, gp.data]).includes('host-secret-key'));
  assert.equal('allowAccountKeyInPlayback' in f.guest.room, false);
  // Handoffs must recheck current room consent, not rely on the ticket's origin.
  f.watchParties.rooms.get(f.roomId).allowAccountKeyInPlayback = false;
  const revokedConsent = await f.get(gp.data.mediaUrl); assert.notEqual(revokedConsent.status, 307); assert.equal(revokedConsent.response.headers.get('location'), null);
});

test('guest request fields cannot opt into key exposure and truthy host flags do not grant consent', async t => {
  for (const consent of [false, 'true', 1]) {
    const f = await joinedFixture(t, { consent });
    assert.equal(f.watchParties.rooms.get(f.roomId).allowAccountKeyInPlayback, false);
    await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest); f.link('https://store.tb-cdn.io/file?token=host-secret-key');
    const result = await f.call('/api/playback', { viewer: 'viewer-1', videoId: 'torrents:11:7', allowAccountKeyInPlayback: true }, f.guest);
    assert.equal(result.status, 409); assert.equal(result.data.error, 'GUEST_DIRECT_UNAVAILABLE');
  }
});

test('host key consent never permits an untrusted media host or bypasses ended-room authorization', async t => {
  const f = await joinedFixture(t, { consent: true });
  await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  f.ownerLink('https://evil.test/file?token=host-secret-key');
  const rejected = await f.playback(f.guest); assert.equal(rejected.data.error, 'MEDIA_HOST_NOT_VERIFIED'); assert.equal(rejected.data.mediaUrl, undefined);
  f.ownerLink(null);
  const gp = await f.playback(f.guest); assert.equal(gp.status, 200);
  await f.call('/api/watch-party/leave', { roomId: f.roomId }, f.host);
  const ended = await f.get(gp.data.mediaUrl); assert.equal(ended.status, 401); assert.equal(ended.response.headers.get('location'), null);
});

test('exact host file removal or changed fingerprint cannot add torrents or issue guest playback', async t => {
  const f = await joinedFixture(t);
  f.items.delete('host-secret-key');
  assert.equal((await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest)).data.error, 'FILE_REMOVED');
  assert.ok(!f.calls.some(call => /createtorrent|checkcached/.test(call.path)));
  f.items.set('host-secret-key', { ...item(11), hash: 'b'.repeat(40) });
  assert.equal((await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest)).data.error, 'WATCH_PARTY_MEDIA_MISMATCH');
  f.items.set('host-secret-key', item(11));
  await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  f.items.set('host-secret-key', { ...item(11), hash: 'b'.repeat(40) });
  const wrong = await f.playback(f.guest); assert.equal(wrong.status, 409); assert.equal(wrong.data.error, 'WATCH_PARTY_MEDIA_MISMATCH');
});

for (const ending of ['leave', 'logout', 'replace-playback', 'replace-login', 'host-expiry', 'room-expiry', 'guest-replaced']) test(ending + ' ends guest API and already-issued app ticket access', async t => {
  const f = await joinedFixture(t); await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  const playback = await f.playback(f.guest); assert.equal(playback.status, 200);
  if (ending === 'leave') await f.call('/api/watch-party/leave', { roomId: f.roomId }, f.host);
  if (ending === 'logout') await f.call('/api/logout', {}, f.host);
  if (ending === 'replace-playback') await f.playback(f.host);
  if (ending === 'replace-login') await f.call('/api/login', { apiKey: 'host-secret-key' }, f.host);
  if (ending === 'host-expiry') f.sessions.read(f.host.sessionToken).expires = 0;
  if (ending === 'room-expiry') f.advance(6 * 3600000 + 1);
  if (ending === 'guest-replaced') { f.advance(10001); assert.equal((await f.call('/api/watch-party/join', { token: f.created.joinToken })).status, 200); }
  const media = await f.get(playback.data.mediaUrl); assert.ok([401, 404].includes(media.status)); assert.equal(media.response.headers.get('location'), null);
  const next = await f.playback(f.guest); assert.equal(next.status, 401);
  const restored = await f.get('/api/session', f.guest); assert.ok(restored.status === 401 || restored.data.authenticated === false);
});

test('host ending the room while guest preparation is awaiting TorBox cannot publish a prepared file', async t => {
  const f = await joinedFixture(t), gate = f.gate('torrents/mylist');
  const pending = f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  await gate.entered.promise; await f.call('/api/watch-party/leave', { roomId: f.roomId }, f.host); gate.release.resolve();
  const result = await pending; assert.ok([401, 404].includes(result.status)); assert.equal(result.data.file, undefined);
});

test('host ending the room while the guest link is awaiting TorBox cannot mint a playback ticket', async t => {
  const f = await joinedFixture(t); await f.call('/api/watch-party/prepare', { roomId: f.roomId }, f.guest);
  const guestId = f.sessions.read(f.guest.sessionToken).id, gate = f.gate('torrents/requestdl');
  const pending = f.playback(f.guest);
  await gate.entered.promise; await f.call('/api/watch-party/leave', { roomId: f.roomId }, f.host); gate.release.resolve();
  const result = await pending; assert.equal(result.status, 401); assert.equal(result.data.mediaUrl, undefined);
  assert.equal([...f.mediaTickets.rows.values()].some(row => row.sessionId === guestId), false);
});

test('party guest logout revokes membership without clearing the preserved owner cookie or host key', async t => {
  const f = await joinedFixture(t, { ownerGuest: true }), loggedOut = await f.call('/api/logout', {}, f.guest);
  assert.equal(loggedOut.status, 200); assert.equal(loggedOut.response.headers.has('set-cookie'), false);
  assert.equal(f.watchParties.get(f.roomId, f.sessions.read(f.host.sessionToken).id).room.guest, null);
  assert.equal((await f.get('/api/session', f.previous)).data.authenticated, true);
  assert.equal(f.sessions.read(f.host.sessionToken).provider.key, 'host-secret-key');
});

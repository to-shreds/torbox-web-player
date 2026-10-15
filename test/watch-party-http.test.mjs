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
async function fixture(t) {
  const calls = [], items = new Map([['host-secret-key', item(11)], ['guest-secret-key', item(22)], ['third-secret-key', item(33)]]);
  const app = createApp({ env: { AUTH_MODE: 'api-key', PUBLIC_ORIGIN: origin },
    providerFactory: key => new TorBox({ key, fetchFn: async (url, options = {}) => {
      const u = new URL(url); calls.push({ key, path: u.pathname, query: u.search, method: options.method || 'GET' });
      if (u.pathname.endsWith('/user/me')) return reply({ plan: 1 });
      if (u.pathname.endsWith('/torrents/mylist')) return reply(u.searchParams.has('id') ? [items.get(key)] : [items.get(key)]);
      if (u.pathname.endsWith('/torrents/requestdl')) return reply(`https://store.tb-cdn.io/file?token=${key}`);
      throw new Error('Unexpected provider call');
    } }), mediaFetch: async () => { throw new Error('Media bytes must never pass through this server'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, data = {}, session = null, headers = {}) => {
    const response = await fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.sessionToken}` } : {}), ...headers }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json(), response };
  };
  const login = async key => { const result = await call('/api/login', { apiKey: key }); assert.equal(result.status, 200); return result.data; };
  const playback = (session, id) => call('/api/playback', { viewer: 'viewer-1', videoId: `torrents:${id}:7` }, session);
  return { ...app, base, call, login, playback, calls, items };
}

test('watch party routes enforce login, trusted origin, CSRF, restricted guest scope and bounded bodies', async t => {
  const f = await fixture(t);
  for (const action of ['create', 'join', 'prepare', 'sync', 'leave']) assert.equal((await f.call('/api/watch-party/' + action)).status, 401);
  const owner = await f.login('host-secret-key');
  assert.equal((await f.call('/api/watch-party/create', {}, owner, { Origin: 'https://evil.test' })).status, 403);
  const created = f.sessions.create();
  const csrf = await f.call('/api/watch-party/create', {}, null, { Cookie: `tw_session=${created.id}` }); assert.equal(csrf.status, 403);
  created.row.guest = true;
  const restricted = { sessionToken: created.id };
  assert.equal((await f.call('/api/watch-party/join', { token: 'x'.repeat(43) }, restricted)).status, 403);
  assert.equal((await f.call('/api/watch-party/create', { text: 'x'.repeat(8300) }, owner)).status, 413);
});

test('independent accounts auto-load the exact file while party JSON never contains keys, media tickets or URLs', async t => {
  const f = await fixture(t), host = await f.login('host-secret-key'), guest = await f.login('guest-secret-key');
  const hp = await f.playback(host, 11); assert.equal(hp.status, 200); assert.deepEqual(hp.data.mediaIdentity, identity); assert.match(hp.data.playbackProof, /^[A-Za-z0-9_-]{43}$/);
  const created = await f.call('/api/watch-party/create', { playbackProof: hp.data.playbackProof, target, title: 'Fixture show', duration: 120, position: 10 }, host);
  assert.equal(created.status, 200); normalizePartySnapshot(created.data);
  const joined = await f.call('/api/watch-party/join', { token: created.data.joinToken }, guest); assert.equal(joined.status, 200); assert.equal(joined.data.room.role, 'guest');
  const prepared = await f.call('/api/watch-party/prepare', { roomId: created.data.room.id }, guest);
  assert.equal(prepared.status, 200); assert.equal(prepared.data.file.id, 'torrents:22:7'); assert.deepEqual(prepared.data.playbackContext.current, target);
  assert.equal(prepared.data.playbackContext.sourceInfo.filename, identity.path);
  const gp = await f.playback(guest, 22); assert.equal(gp.status, 200); assert.notEqual(gp.data.playbackProof, hp.data.playbackProof);
  const roomId = created.data.room.id;
  const status = (proof, command) => ({ roomId, playbackProof: proof, ready: true, buffering: false, blocked: false, duration: 120, position: 10, ...(command ? { command } : {}) });
  assert.equal((await f.call('/api/watch-party/sync', status(hp.data.playbackProof), host)).status, 200);
  assert.equal((await f.call('/api/watch-party/sync', status(gp.data.playbackProof), guest)).status, 200);
  const play = await f.call('/api/watch-party/sync', status(gp.data.playbackProof, { seq: 1, type: 'play', position: 10 }), guest);
  assert.equal(play.status, 200); assert.equal(play.data.room.state.phase, 'scheduled'); assert.equal(play.data.room.state.playing, true);
  assert.ok(play.data.room.state.at - play.data.serverTime >= 1990); normalizePartySnapshot(play.data);
  const json = JSON.stringify([created.data, joined.data, prepared.data, play.data]);
  for (const secret of ['host-secret-key', 'guest-secret-key', hp.data.mediaUrl, gp.data.mediaUrl, hp.data.playbackProof, gp.data.playbackProof, 'https://store', 'ownerId', 'sessionId']) assert.ok(!json.includes(secret), secret);
  assert.ok(!f.calls.some(call => call.path.includes('/createtorrent')));
});

test('foreign proof, third member, wrong fingerprint and changed playback cannot join synchronization', async t => {
  const f = await fixture(t), host = await f.login('host-secret-key'), guest = await f.login('guest-secret-key'), third = await f.login('third-secret-key');
  const hp = (await f.playback(host, 11)).data;
  assert.equal((await f.call('/api/watch-party/create', { playbackProof: hp.playbackProof, target, title: 'Fixture', duration: 120, position: 0 }, guest)).status, 409);
  const created = (await f.call('/api/watch-party/create', { playbackProof: hp.playbackProof, target, title: 'Fixture', duration: 120, position: 0 }, host)).data;
  const roomId = created.room.id;
  assert.equal((await f.call('/api/watch-party/join', { token: created.joinToken }, guest)).status, 200);
  assert.equal((await f.call('/api/watch-party/join', { token: created.joinToken }, third)).status, 409);
  assert.equal((await f.call('/api/watch-party/prepare', { roomId }, third)).status, 404);
  f.items.set('guest-secret-key', { ...item(22), hash: 'b'.repeat(40) });
  const wrong = (await f.playback(guest, 22)).data;
  const ready = await f.call('/api/watch-party/sync', { roomId, playbackProof: wrong.playbackProof, ready: true, buffering: false, blocked: false, duration: 120, position: 0 }, guest);
  assert.equal(ready.status, 409); assert.equal(ready.data.error, 'WATCH_PARTY_MEDIA_MISMATCH');
  const replacement = (await f.playback(host, 11)).data;
  const old = await f.call('/api/watch-party/sync', { roomId, playbackProof: hp.playbackProof, ready: true, buffering: false, blocked: false, duration: 120, position: 0 }, host);
  assert.equal(old.status, 409);
  assert.notEqual(replacement.playbackProof, hp.playbackProof);
});

test('host logout immediately ends the room and revokes its playback authority', async t => {
  const f = await fixture(t), host = await f.login('host-secret-key'), guest = await f.login('guest-secret-key');
  const hp = (await f.playback(host, 11)).data;
  const created = (await f.call('/api/watch-party/create', { playbackProof: hp.playbackProof, target, title: 'Fixture', duration: 120, position: 0 }, host)).data;
  await f.call('/api/watch-party/join', { token: created.joinToken }, guest);
  assert.equal((await f.call('/api/logout', {}, host)).status, 200);
  assert.equal(f.watchParties.rooms.size, 0); assert.equal(f.watchParties.proofs.size, 0);
  assert.equal((await f.call('/api/watch-party/sync', { roomId: created.room.id }, guest)).status, 404);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { WatchParties, prepareExactPartyFile, samePartyMedia } from '../lib/watch-party.mjs';

const identity = { kind: 'torrent', hash: '0123456789abcdef0123456789abcdef01234567', path: 'Show/Season 01/Episode.mp4', size: 2_400_000 };
const target = { type: 'series', id: 'tt1234567', season: 1, episode: 2 };
const file = { id: 'torrents:7:3', title: 'Episode.mp4' };
const errorCode = code => error => error?.code === code;
function fixture(options = {}) {
  let now = 1_800_000_000_000;
  const parties = new WatchParties(() => now, options);
  const hostProof = parties.issuePlayback('host-session-private', file, identity);
  const created = parties.create('host-session-private', { playbackProof: hostProof, target, title: 'Fixture Show', duration: 7200, position: 100 });
  return { parties, hostProof, created, id: created.room.id, advance: ms => { now += ms; }, now: () => now };
}
function status(id, overrides = {}) { return { roomId: id, ready: true, buffering: false, blocked: false, duration: 7200, position: 100, ...overrides }; }
function withGuest(options = {}) {
  const f = fixture(options);
  f.parties.join('guest-session-private', f.created.joinToken);
  f.guestProof = f.parties.issuePlayback('guest-session-private', { ...file, id: 'torrents:20:9' }, identity);
  f.parties.sync('host-session-private', status(f.id, { playbackProof: f.hostProof }));
  f.parties.sync('guest-session-private', status(f.id, { playbackProof: f.guestProof }));
  return f;
}
function start(f) { return f.parties.sync('host-session-private', status(f.id, { command: { seq: 1, type: 'play', position: 100 } })); }
function rawItem(overrides = {}) {
  return { id: 7, hash: identity.hash, name: 'Fixture Show', download_finished: true, download_present: true,
    files: [{ id: 3, name: identity.path, short_name: 'Episode.mp4', size: identity.size, mimetype: 'video/mp4' }], ...overrides };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('party creation and joining bind two sessions and keep private credentials and authority out of snapshots', () => {
  const f = fixture();
  assert.match(f.id, /^[A-Za-z0-9_-]{16}$/);
  assert.match(f.created.joinToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.created.room.role, 'host');
  assert.equal(f.created.room.state.phase, 'waiting');
  const joined = f.parties.join('guest-session-private', f.created.joinToken);
  assert.equal(joined.room.role, 'guest');
  assert.equal(joined.room.state.playing, false);
  assert.deepEqual(joined.room.media.identity, identity);
  const snapshot = JSON.stringify(joined);
  for (const secret of [f.hostProof, f.created.joinToken, 'host-session-private', 'guest-session-private']) assert.ok(!snapshot.includes(secret));
  const stored = JSON.stringify([...f.parties.rooms.values()]);
  assert.ok(!stored.includes(f.hostProof));
  assert.ok(!stored.includes(f.created.joinToken));
  assert.throws(() => f.parties.get(f.id, 'unrelated-session'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.throws(() => f.parties.join('third-session', f.created.joinToken), errorCode('WATCH_PARTY_FULL'));
  assert.equal(f.parties.join('host-session-private', f.created.joinToken).room.role, 'host');
  assert.equal(f.parties.join('guest-session-private', f.created.joinToken).room.role, 'guest');
});

test('each participant must use its own playback proof and the exact torrent hash, full path and size', () => {
  const f = fixture();
  f.parties.join('guest-session-private', f.created.joinToken);
  assert.throws(() => f.parties.sync('guest-session-private', status(f.id, { playbackProof: f.hostProof })), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
  for (const patch of [{ hash: 'f'.repeat(40) }, { path: 'Show/Season 02/Episode.mp4' }, { size: identity.size + 1 }]) {
    const proof = f.parties.issuePlayback('guest-session-private', file, { ...identity, ...patch });
    assert.throws(() => f.parties.sync('guest-session-private', status(f.id, { playbackProof: proof })), errorCode('WATCH_PARTY_MEDIA_MISMATCH'));
  }
  assert.throws(() => f.parties.sync('guest-session-private', status(f.id)), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
});

test('a lost join response only reserves the guest seat through the presence timeout', () => {
  const f = fixture();
  f.parties.join('aborted-join-session', f.created.joinToken);
  f.advance(10000);
  assert.throws(() => f.parties.join('replacement-session', f.created.joinToken), errorCode('WATCH_PARTY_FULL'));
  f.advance(1);
  const replacement = f.parties.join('replacement-session', f.created.joinToken);
  assert.equal(replacement.room.id, f.id);
  assert.equal(replacement.room.role, 'guest');
  assert.equal(replacement.room.members.guest.present, true);
  assert.equal(replacement.room.members.guest.ready, false);
  assert.equal(replacement.room.state.playing, false);
  assert.equal(replacement.room.state.wantsPlay, false);
  assert.equal(f.parties.get(f.id, 'host-session-private').room.host.sessionId, 'host-session-private');
  assert.throws(() => f.parties.get(f.id, 'aborted-join-session'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.throws(() => f.parties.sync('aborted-join-session', status(f.id, { ready: false, blocked: true })), errorCode('WATCH_PARTY_NOT_FOUND'));
});

test('replacing a disconnected ready guest holds playback until a new shared play command', () => {
  const f = withGuest();
  start(f);
  f.advance(11000);
  const disconnected = f.parties.sync('host-session-private', status(f.id, { position: 109 }));
  assert.equal(disconnected.room.state.phase, 'disconnected');
  assert.equal(disconnected.room.state.wantsPlay, true);
  const replacement = f.parties.join('replacement-session', f.created.joinToken);
  assert.equal(replacement.room.state.playing, false);
  assert.equal(replacement.room.state.wantsPlay, false);
  assert.equal(replacement.room.state.position, disconnected.room.state.position);
  assert.throws(() => f.parties.get(f.id, 'guest-session-private'), errorCode('WATCH_PARTY_NOT_FOUND'));
  const proof = f.parties.issuePlayback('replacement-session', file, identity);
  const ready = f.parties.sync('replacement-session', status(f.id, { playbackProof: proof, position: replacement.room.state.position }));
  assert.equal(ready.room.state.playing, false);
  assert.equal(ready.room.state.wantsPlay, false);
});

test('unbound playback proofs expire after 30 minutes and new playback invalidates an earlier proof', () => {
  let now = 1000;
  const parties = new WatchParties(() => now);
  const first = parties.issuePlayback('viewer', file, identity);
  const second = parties.issuePlayback('viewer', file, identity);
  assert.throws(() => parties.proof('viewer', first), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
  now += 30 * 60000;
  assert.throws(() => parties.proof('viewer', second), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
  assert.equal(parties.issuePlayback('viewer', file, null), null);
  assert.equal(parties.proofs.has('viewer'), false);
});

test('bound proofs remain valid beyond 30 minutes during a long movie until playback changes', () => {
  const f = withGuest();
  f.advance(31 * 60000);
  assert.doesNotThrow(() => f.parties.sync('host-session-private', status(f.id, { playbackProof: f.hostProof })));
  assert.doesNotThrow(() => f.parties.sync('guest-session-private', status(f.id, { playbackProof: f.guestProof })));
  const replacement = f.parties.issuePlayback('guest-session-private', file, identity);
  assert.notEqual(replacement, f.guestProof);
  assert.throws(() => f.parties.sync('guest-session-private', status(f.id, { playbackProof: f.guestProof })), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
  const { room } = f.parties.get(f.id, 'host-session-private');
  assert.equal(room.guest.ready, false);
  assert.equal(room.guest.blocked, true);
});

test('play begins at a shared server anchor two seconds ahead after both players are within 0.75 seconds', () => {
  const f = withGuest();
  f.parties.sync('guest-session-private', status(f.id, { position: 100.76 }));
  const waiting = start(f);
  assert.equal(waiting.room.state.playing, false);
  assert.equal(waiting.room.state.wantsPlay, true);
  const scheduled = f.parties.sync('guest-session-private', status(f.id, { position: 100.75 }));
  assert.equal(scheduled.room.state.phase, 'scheduled');
  assert.equal(scheduled.room.state.at, f.now() + 2000);
  const { room } = f.parties.get(f.id, 'host-session-private');
  assert.equal(f.parties.target(room), 100);
  f.advance(1999);
  assert.equal(f.parties.target(room), 100);
  f.advance(1001);
  assert.equal(f.parties.target(room), 101);
  assert.equal(f.parties.snapshot(room, 'host-session-private').room.state.phase, 'playing');
});

test('both viewers can pause and seek, and replayed or older per-viewer command sequences cannot change the anchor', () => {
  const f = withGuest();
  start(f);
  f.advance(3000);
  const paused = f.parties.sync('guest-session-private', status(f.id, { position: 101, command: { seq: 1, type: 'pause', position: 101 } }));
  assert.equal(paused.room.state.playing, false);
  assert.equal(paused.room.state.position, 101);
  assert.equal(paused.room.state.wantsPlay, false);
  const sought = f.parties.sync('guest-session-private', status(f.id, { position: 300, command: { seq: 2, type: 'seek', position: 300 } }));
  assert.equal(sought.room.state.position, 300);
  assert.equal(sought.room.state.wantsPlay, false);
  for (const seq of [1, 2]) {
    const duplicate = f.parties.sync('guest-session-private', status(f.id, { position: 500, command: { seq, type: 'play', position: 500 } }));
    assert.equal(duplicate.room.state.position, 300);
    assert.equal(duplicate.room.state.wantsPlay, false);
  }
  const playing = f.parties.sync('host-session-private', status(f.id, { position: 300, command: { seq: 2, type: 'play', position: 300 } }));
  assert.equal(playing.room.state.playing, false);
  const resumed = f.parties.sync('guest-session-private', status(f.id, { position: 300 }));
  assert.equal(resumed.room.state.phase, 'scheduled');
  const seekWhilePlaying = f.parties.sync('guest-session-private', status(f.id, { position: 600, command: { seq: 3, type: 'seek', position: 600 } }));
  assert.equal(seekWhilePlaying.room.state.wantsPlay, true);
  assert.equal(seekWhilePlaying.room.state.playing, false);
  assert.equal(f.parties.sync('host-session-private', status(f.id, { position: 600 })).room.state.phase, 'scheduled');
});

test('buffering pauses both viewers at the clock position and resumes only after both return to that anchor', () => {
  const f = withGuest();
  start(f); f.advance(4000);
  const buffering = f.parties.sync('guest-session-private', status(f.id, { position: 102, buffering: true }));
  assert.equal(buffering.room.state.phase, 'buffering');
  assert.equal(buffering.room.state.position, 102);
  assert.equal(buffering.room.state.playing, false);
  assert.equal(buffering.room.state.wantsPlay, true);
  const notYetAligned = f.parties.sync('guest-session-private', status(f.id, { position: 102 }));
  assert.equal(notYetAligned.room.state.playing, false);
  const scheduled = f.parties.sync('host-session-private', status(f.id, { position: 102 }));
  assert.equal(scheduled.room.state.phase, 'scheduled');
});

test('autoplay blocking or not-ready status holds both players and restarts a fresh countdown after recovery', () => {
  const f = withGuest();
  start(f); f.advance(1000);
  const blocked = f.parties.sync('guest-session-private', status(f.id, { blocked: true }));
  assert.equal(blocked.room.state.playing, false);
  assert.equal(blocked.room.state.wantsPlay, true);
  assert.equal(blocked.room.state.position, 100);
  const notReady = f.parties.sync('guest-session-private', status(f.id, { ready: false }));
  assert.equal(notReady.room.state.playing, false);
  f.advance(1000);
  const resumed = f.parties.sync('guest-session-private', status(f.id));
  assert.equal(resumed.room.state.phase, 'scheduled');
  assert.equal(resumed.room.state.at, f.now() + 2000);
});

test('identical paused heartbeats preserve their revision and anchor for clients that ignore equal revisions', () => {
  const f = withGuest();
  const before = f.parties.sync('host-session-private', status(f.id));
  f.advance(1000);
  const after = f.parties.sync('host-session-private', status(f.id));
  assert.equal(after.room.revision, before.room.revision);
  assert.deepEqual(after.room.state, before.room.state);
  assert.notEqual(after.serverTime, before.serverTime);
});

test('the shared playback clock stops at the video duration when both remain present', () => {
  const f = withGuest();
  f.parties.sync('host-session-private', status(f.id, { position: 7199, command: { seq: 1, type: 'seek', position: 7199 } }));
  f.parties.sync('guest-session-private', status(f.id, { position: 7199 }));
  f.parties.sync('host-session-private', status(f.id, { position: 7199, command: { seq: 2, type: 'play', position: 7199 } }));
  f.advance(4000);
  const ended = f.parties.sync('guest-session-private', status(f.id, { position: 7200 }));
  assert.equal(ended.room.state.phase, 'ended');
  assert.equal(ended.room.state.playing, false);
  assert.equal(ended.room.state.wantsPlay, false);
  assert.equal(ended.room.state.position, 7200);
});

test('a viewer absent for over ten seconds pauses playback until both are present and aligned again', () => {
  const f = withGuest();
  start(f); f.advance(10001);
  const disconnected = f.parties.sync('host-session-private', status(f.id, { position: 108.001 }));
  assert.equal(disconnected.room.state.phase, 'disconnected');
  assert.equal(disconnected.room.state.playing, false);
  assert.equal(disconnected.room.members.guest.present, false);
  assert.equal(disconnected.room.state.position, 108.001);
  const resumed = f.parties.sync('guest-session-private', status(f.id, { position: 108.001 }));
  assert.equal(resumed.room.state.phase, 'scheduled');
});

test('host leave ends the room and invite while guest leave pauses it for a new second viewer', () => {
  const f = withGuest(); start(f);
  f.parties.leave('guest-session-private', f.id);
  const waiting = f.parties.snapshot(f.parties.get(f.id, 'host-session-private').room, 'host-session-private');
  assert.equal(waiting.room.state.phase, 'waiting');
  assert.equal(waiting.room.state.wantsPlay, false);
  assert.equal(waiting.room.members.guest, null);
  assert.throws(() => f.parties.get(f.id, 'guest-session-private'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.equal(f.parties.join('replacement-session', f.created.joinToken).room.role, 'guest');
  f.parties.leave('host-session-private', f.id);
  assert.throws(() => f.parties.get(f.id, 'replacement-session'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.throws(() => f.parties.join('replacement-session', f.created.joinToken), errorCode('WATCH_PARTY_NOT_FOUND'));
});

test('rooms expire after six hours and revoked sessions lose membership and playback authority', () => {
  const f = withGuest();
  f.parties.revokeSession('guest-session-private');
  assert.throws(() => f.parties.get(f.id, 'guest-session-private'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.throws(() => f.parties.proof('guest-session-private', f.guestProof), errorCode('WATCH_PARTY_PLAYBACK_REQUIRED'));
  f.advance(6 * 3600000);
  assert.throws(() => f.parties.get(f.id, 'host-session-private'), errorCode('WATCH_PARTY_NOT_FOUND'));
  assert.equal(f.parties.rooms.size, 0);
  assert.equal(f.parties.invites.size, 0);
  f.parties.clear();
  assert.equal(f.parties.proofs.size, 0);
});

test('room and playback proof limits reject excess sessions without growing the stores', () => {
  const f = fixture({ maxRooms: 1 });
  const second = f.parties.issuePlayback('second-host', file, identity);
  assert.throws(() => f.parties.create('second-host', { playbackProof: second, target, duration: 7200, position: 0 }), errorCode('WATCH_PARTY_CAPACITY'));
  assert.equal(f.parties.rooms.size, 1);
  const limited = new WatchParties(Date.now, { maxProofs: 2 });
  limited.issuePlayback('one', file, identity); limited.issuePlayback('two', file, identity);
  assert.throws(() => limited.issuePlayback('three', file, identity), errorCode('WATCH_PARTY_CAPACITY'));
  assert.equal(limited.proofs.size, 2);
  assert.doesNotThrow(() => limited.issuePlayback('two', file, identity));
  limited.revokeSession('one');
  assert.doesNotThrow(() => limited.issuePlayback('three', file, identity));
});

test('invalid status, duration mismatch and malformed commands cannot start playback', () => {
  const f = withGuest();
  for (const patch of [{ ready: 'yes' }, { buffering: null }, { blocked: 0 }, { position: NaN }, { position: -1 }, { position: 7201 }, { duration: 0 }]) {
    assert.throws(() => f.parties.sync('host-session-private', status(f.id, patch)), errorCode('WATCH_PARTY_BAD_STATUS'));
  }
  assert.throws(() => f.parties.sync('guest-session-private', status(f.id, { duration: 7202 })), errorCode('WATCH_PARTY_DURATION_MISMATCH'));
  for (const command of [null, { seq: 0, type: 'play', position: 100 }, { seq: 1, type: 'delete', position: 100 }, { seq: 1.5, type: 'seek', position: 100 }, { seq: 1, type: 'seek', position: Infinity }]) {
    assert.throws(() => f.parties.sync('host-session-private', status(f.id, { command })), errorCode('WATCH_PARTY_BAD_COMMAND'));
  }
  assert.equal(f.parties.get(f.id, 'host-session-private').room.state.playing, false);
});

test('party preparation coalesces concurrent requests and never publishes a result after that member leaves and rejoins', async () => {
  const f = withGuest(), gate = deferred(); let calls = 0;
  const load = async value => { calls++; assert.deepEqual(value, identity); await gate.promise; return file; };
  const one = f.parties.prepare('guest-session-private', f.id, load);
  const two = f.parties.prepare('guest-session-private', f.id, load);
  await Promise.resolve();
  assert.equal(calls, 1);
  f.parties.leave('guest-session-private', f.id);
  f.parties.join('guest-session-private', f.created.joinToken);
  gate.resolve();
  const results = await Promise.allSettled([one, two]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'WATCH_PARTY_NOT_FOUND'));
  assert.equal(calls, 1);
});

test('prepared playback context carries the exact source and party position without unrelated queue entries', async () => {
  const f = withGuest();
  const result = await f.parties.prepare('guest-session-private', f.id, async () => file);
  assert.deepEqual(result.file, file);
  assert.deepEqual(result.playbackContext.current, target);
  assert.deepEqual(result.playbackContext.sourceInfo, { hash: identity.hash, filename: identity.path });
  assert.deepEqual(result.playbackContext.queue, []);
  assert.equal(result.playbackContext.partyPosition, 100);
  assert.equal(result.playbackContext.forceStartOver, true);
});

test('exact preparation reuses an existing item and matches the full relative path instead of a duplicate basename', async () => {
  const value = rawItem({ files: [{ id: 2, name: 'Show/Season 02/Episode.mp4', short_name: 'Episode.mp4', size: identity.size }, ...rawItem().files] });
  const selected = await prepareExactPartyFile(identity, { find: async hash => { assert.equal(hash, identity.hash); return value; }, cached: () => assert.fail('existing item does not need a cache lookup'), create: () => assert.fail('existing item must not be recreated') });
  assert.equal(selected.id, 'torrents:7:3');
  assert.equal(selected.title, 'Episode.mp4');
});

test('exact preparation creates only an already cached hash and requests cached-only provider creation', async () => {
  const calls = [];
  const selected = await prepareExactPartyFile(identity, {
    find: async hash => { calls.push(['find', hash]); return null; },
    cached: async hashes => { calls.push(['cached', hashes]); return { [identity.hash]: true }; },
    create: async (hash, cachedOnly) => { calls.push(['create', hash, cachedOnly]); return 7; },
    item: async id => { calls.push(['item', id]); return rawItem(); }
  });
  assert.equal(selected.id, file.id);
  assert.deepEqual(calls, [['find', identity.hash], ['cached', [identity.hash]], ['create', identity.hash, true], ['item', 7]]);
  let created = false;
  await assert.rejects(prepareExactPartyFile(identity, { find: async () => null, cached: async () => ({}), create: async () => { created = true; } }), errorCode('WATCH_PARTY_NOT_CACHED'));
  assert.equal(created, false);
});

test('exact preparation rejects wrong hash, path, byte size, duplicate matches and unavailable items without selecting an alternate', async () => {
  const raw = rawItem();
  for (const value of [
    rawItem({ hash: 'f'.repeat(40) }),
    rawItem({ files: [{ ...raw.files[0], name: 'Show/Season 02/Episode.mp4' }] }),
    rawItem({ files: [{ ...raw.files[0], size: identity.size + 1 }] }),
    rawItem({ files: [raw.files[0], { ...raw.files[0], id: 4 }] }),
    rawItem({ files: [{ ...raw.files[0], short_name: 'readme.txt', name: identity.path.replace('.mp4', '.txt'), mimetype: '' }] })
  ]) await assert.rejects(prepareExactPartyFile(identity, { find: async () => value }), errorCode('WATCH_PARTY_MEDIA_MISMATCH'));
  for (const patch of [{ download_finished: false }, { download_present: false }]) await assert.rejects(prepareExactPartyFile(identity, { find: async () => rawItem(patch) }), errorCode('WATCH_PARTY_PREPARING'));
  assert.equal(samePartyMedia(identity, { ...identity, kind: 'webdl' }), false);
});

test('uncertain provider creation is checked again without another create request and can recover when the item appears', async () => {
  const state = {}, uncertain = Object.assign(new Error('Provider response was lost.'), { code: 'CREATE_UNCERTAIN' });
  let creates = 0, checks = 0, found = null;
  const gateway = {
    find: async () => found,
    cached: async () => { checks++; return { [identity.hash]: true }; },
    create: async () => { creates++; throw uncertain; }
  };
  await assert.rejects(prepareExactPartyFile(identity, gateway, state), errorCode('CREATE_UNCERTAIN'));
  assert.equal(state.uncertain, true);
  await assert.rejects(prepareExactPartyFile(identity, gateway, state), errorCode('WATCH_PARTY_PREPARE_UNCERTAIN'));
  assert.equal(creates, 1); assert.equal(checks, 1);
  found = rawItem();
  assert.equal((await prepareExactPartyFile(identity, gateway, state)).id, file.id);
  assert.equal(creates, 1);
});

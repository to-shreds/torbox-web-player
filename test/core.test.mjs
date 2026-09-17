import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validHash, Sessions, Limiter } from '../lib/auth.mjs';
import { ProgressStore } from '../lib/progress.mjs';
import { MediaTickets, validatedRange } from '../lib/media.mjs';
import { TorBox, AppError, normalizeItem, availability, parseVideoId, safePlaybackUrl, validatedPlaybackUrl } from '../lib/torbox.mjs';
const ready = { id: 1, name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: 'Fixture.Show.S01E02.mp4', name: 'Fixture.Show.S01E02.mp4', size: 1000, mimetype: 'video/mp4' }] };
const reply = data => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
test('password hashes round trip and wrong passwords fail', async () => {
  const hash = await hashPassword('fixture-password-only');
  assert.ok(validHash(hash)); assert.ok(await verifyPassword('fixture-password-only', hash));
  assert.equal(await verifyPassword('wrong', hash), false); assert.equal(await verifyPassword('x', 'invalid'), false);
});
test('sessions expire and are individually revocable', () => {
  let now = 0; const sessions = new Sessions(() => now), one = sessions.create(), two = sessions.create();
  assert.equal(sessions.read(one.id).id, one.row.id); sessions.revoke(one.row.id);
  assert.equal(sessions.read(one.id), null); assert.ok(sessions.read(two.id));
  now += 31 * 86400000; assert.equal(sessions.read(two.id), null);
});
test('session revocation does not accept arbitrary tokens', () => {
  const sessions = new Sessions(); const created = sessions.create();
  assert.equal(sessions.read('attacker'), null); sessions.revokeAll(); assert.equal(sessions.read(created.id), null);
});
test('limiter expires its window', () => {
  let now = 0; const limiter = new Limiter(2, 10, () => now);
  assert.equal(limiter.allow('x'), true); assert.equal(limiter.allow('x'), true); assert.equal(limiter.allow('x'), false); now = 11; assert.equal(limiter.allow('x'), true);
});
test('ready means both finished and present, not the textual state', () => {
  assert.equal(availability(ready), 'Ready to watch'); assert.equal(availability({ download_state: 'completed' }), 'Unable to check'); assert.equal(availability({ download_finished: true, download_present: false }), 'Unavailable'); assert.equal(availability({ download_finished: false }), 'Preparing');
});
test('files preserve zero IDs and do not return private provider fields', () => {
  const rows = normalizeItem('torrents', { ...ready, auth_id: 'secret', magnet: 'private', api_key: 'secret' });
  assert.equal(rows[0].id, 'torrents:1:0'); assert.equal(rows.length, 1); assert.ok(!JSON.stringify(rows).includes('secret')); assert.ok(!JSON.stringify(rows).includes('magnet'));
});
test('unknown non-video files are not offered for playback', () => { assert.deepEqual(normalizeItem('torrents', { ...ready, files: [{ id: 2, name: 'readme.txt' }] }), []); });
test('reject malformed IDs without permitting provider path injection', () => {
  assert.deepEqual(parseVideoId('usenet:123:0'), { kind: 'usenet', itemId: 123, fileId: 0 });
  for (const id of ['https://evil.test', 'torrents:1:0/../me', 'other:1:2', 'torrents:-1:2']) assert.throws(() => parseVideoId(id));
});
test('URL checks block master-key leaks and unverified destinations', () => {
  assert.equal(safePlaybackUrl('https://cdn.torbox.app/video?token=temporary', 'master-key'), 'https://cdn.torbox.app/video?token=temporary');
  for (const url of ['http://cdn.torbox.app/file', 'https://evil.test/file', 'https://torbox.app.evil.test/file', 'https://user:pass@cdn.torbox.app/file', 'https://cdn.torbox.app:8443/file', 'https://api.torbox.app/v1?token=master-key', 'https://cdn.torbox.app/file?x=master-key', 'https://cdn.torbox.app/file?x=master%2Dkey']) assert.throws(() => safePlaybackUrl(url, 'master-key'));
});
test('server relay validation accepts TorBox CDN key-bearing URLs but not unrelated hosts', () => {
  assert.equal(validatedPlaybackUrl('https://store-034.wnam.tb-cdn.io/file?token=master-key'), 'https://store-034.wnam.tb-cdn.io/file?token=master-key');
  assert.throws(() => validatedPlaybackUrl('https://example.test/file?token=master-key'));
});
test('media tickets are session-bound, expiring and revocable', () => {
  let now = 0; const tickets = new MediaTickets(() => now, { ttlMs: 10 }); const token = tickets.create('session-a', 'torrents:1:0', 'https://store.tb-cdn.io/file?token=secret');
  assert.ok(tickets.read(token, 'session-a')); assert.equal(tickets.read(token, 'session-b'), null); assert.equal(tickets.read('bad', 'session-a'), null); now = 11; assert.equal(tickets.read(token, 'session-a'), null);
});
test('media range parser accepts one byte range and rejects multipart or malformed ranges', () => {
  assert.equal(validatedRange(undefined), null); assert.equal(validatedRange('bytes=0-99'), 'bytes=0-99'); assert.equal(validatedRange('bytes=-500'), 'bytes=-500');
  for (const value of ['bytes=0-1,4-5', 'items=0-1', 'bytes=a-b']) assert.throws(() => validatedRange(value), error => error.code === 'BAD_RANGE');
});
test('TorBox account output is whitelist-only', async () => {
  const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => reply({ plan: 2, api_token: 'fixture-secret', email: 'private@example.test' }) });
  const data = await api.account(); assert.equal(data.planCode, '2'); assert.equal(data.planEntitlementsVerified, false); assert.ok(!JSON.stringify(data).includes('fixture-secret')); assert.ok(!JSON.stringify(data).includes('email'));
});
test('library caches and coalesces concurrent calls', async () => {
  let calls = 0; const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return reply([ready]); } });
  await Promise.all([api.list('torrents'), api.list('torrents')]); await api.list('torrents'); assert.equal(calls, 1);
});
test('failed refresh preserves cached files with an explicit stale warning', async () => {
  let fails = false; const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => { if (fails) throw new Error('private URL'); return reply([ready]); } });
  await api.list('torrents'); fails = true; const result = await api.list('torrents', 0, true); assert.equal(result.stale, true); assert.equal(result.files.length, 1); assert.ok(result.warning); assert.ok(!result.warning.includes('private URL'));
});
test('uncached failure is an error, not an empty successful library', async () => {
  const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => new Response('bad', { status: 500 }) }); await assert.rejects(api.list('torrents'), error => error.code === 'TORBOX_HTTP_ERROR');
});
test('HTTP 429 establishes a bounded provider cooldown', async () => {
  let now = 0, count = 0; const api = new TorBox({ key: 'fixture-secret', now: () => now, fetchFn: async () => { count++; return new Response('', { status: 429, headers: { 'retry-after': '999999' } }); } });
  await assert.rejects(api.account()); await assert.rejects(api.account()); assert.equal(count, 1); now = 300001; await assert.rejects(api.account()); assert.equal(count, 2);
});
test('provider timeout is distinct and redacted', async () => {
  const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => { throw new DOMException('secret URL', 'TimeoutError'); } }); await assert.rejects(api.account(), error => error.code === 'TORBOX_TIMEOUT' && !error.message.includes('secret URL'));
});
test('malformed JSON and false success do not become empty results', async () => {
  for (const data of ['not-json', JSON.stringify({ success: false, detail: 'fixture-secret' })]) { const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => new Response(data) }); await assert.rejects(api.list('torrents'), error => error instanceof AppError && !error.message.includes('fixture-secret')); }
});
test('resolve revalidates the account and requests a server-only fresh link', async () => {
  const calls = []; const api = new TorBox({ key: 'fixture-secret', fetchFn: async (url, options) => { calls.push({ url, options }); return reply(url.pathname.endsWith('mylist') ? ready : 'https://cdn.torbox.app/file?token=temporary'); } });
  const result = await api.resolve('torrents:1:0'); assert.equal(calls.length, 2); assert.equal(calls[0].url.searchParams.get('bypass_cache'), 'true'); assert.equal(calls[1].url.searchParams.get('file_id'), '0'); assert.equal(calls[1].url.searchParams.get('token'), 'fixture-secret'); assert.equal(calls[1].options.redirect, 'error'); assert.equal(result.delivery, 'direct'); assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});
test('relay resolver may retain the master token only in its server-only upstream URL', async () => {
  const api = new TorBox({ key: 'fixture-secret', fetchFn: async url => reply(url.pathname.endsWith('mylist') ? ready : 'https://store.tb-cdn.io/file?token=fixture-secret') });
  const result = await api.resolveForRelay('torrents:1:0'); assert.equal(result.file.id, 'torrents:1:0'); assert.ok(result.upstreamUrl.includes('fixture-secret'));
});
test('removed or unready files never receive a link', async () => {
  for (const raw of [null, { ...ready, files: [] }, { ...ready, download_present: false }]) { let count = 0; const api = new TorBox({ key: 'fixture-secret', fetchFn: async () => { count++; return reply(raw); } }); await assert.rejects(api.resolve('torrents:1:0')); assert.equal(count, 1); }
});
test('correct namespace parameters for web downloads and Usenet', async () => {
  for (const [kind, parameter] of [['webdl', 'web_id'], ['usenet', 'usenet_id']]) { let called; const api = new TorBox({ key: 'fixture-secret', fetchFn: async url => { called = url; return reply(url.pathname.endsWith('mylist') ? ready : 'https://cdn.torbox.app/file'); } }); await api.resolve(`${kind}:1:0`); assert.equal(called.searchParams.get(parameter), '1'); }
});
test('progress is independent across viewers and survives a new lease', () => {
  const store = new ProgressStore(), a = store.start('viewer-1', 'torrents:1:0', { sessionId: 'a' }), b = store.start('viewer-2', 'torrents:1:0', { sessionId: 'b' }); assert.ok(store.write('viewer-1', { videoId: 'torrents:1:0', leaseId: a.leaseId, seq: 1, position: 50, duration: 100 }, 'a')); assert.ok(store.write('viewer-2', { videoId: 'torrents:1:0', leaseId: b.leaseId, seq: 1, position: 20, duration: 100 }, 'b')); assert.equal(store.start('viewer-1', 'torrents:1:0', { sessionId: 'a' }).progress.position, 50); assert.equal(store.read('viewer-2', 'torrents:1:0').position, 20);
});
test('stale sessions, sequence numbers and zero loading events cannot reset progress', () => {
  const store = new ProgressStore(), a = store.start('viewer-1', 'torrents:1:0', { sessionId: 'a' }); const update = { videoId: 'torrents:1:0', leaseId: a.leaseId, seq: 2, position: 50, duration: 100 }; assert.ok(store.write('viewer-1', update, 'a')); assert.equal(store.write('viewer-1', { ...update, seq: 1, position: 20 }, 'a'), false); assert.equal(store.write('viewer-1', { ...update, seq: 3, position: 0 }, 'a'), false); assert.equal(store.write('viewer-1', { ...update, seq: 3 }, 'other-session'), false); store.start('viewer-1', 'torrents:2:0', { sessionId: 'a' }); assert.equal(store.write('viewer-1', { ...update, seq: 4 }, 'a'), false); assert.equal(store.read('viewer-1', 'torrents:1:0').position, 50);
});
test('only an explicit start-over resets a resume point', () => {
  const store = new ProgressStore(), a = store.start('viewer-1', 'torrents:1:0', { sessionId: 'a' }); store.write('viewer-1', { videoId: 'torrents:1:0', leaseId: a.leaseId, seq: 1, position: 50, duration: 100 }, 'a'); assert.equal(store.start('viewer-1', 'torrents:1:0', { reset: true, sessionId: 'a' }).progress.position, 0);
});
test('progress validation rejects NaN, negative times, unknown duration and overruns', () => {
  const store = new ProgressStore(), a = store.start('viewer-1', 'torrents:1:0', { sessionId: 'a' }); for (const values of [{ position: NaN, duration: 100 }, { position: -1, duration: 100 }, { position: 1, duration: 0 }, { position: 200, duration: 100 }]) assert.equal(store.write('viewer-1', { videoId: 'torrents:1:0', leaseId: a.leaseId, seq: 1, ...values }, 'a'), false);
});
test('new playback intents invalidate older async requests only for that viewer', () => {
  const store = new ProgressStore(), a = store.beginIntent('viewer-1'), b = store.beginIntent('viewer-2'); assert.ok(store.isCurrent('viewer-1', a)); store.beginIntent('viewer-1'); assert.equal(store.isCurrent('viewer-1', a), false); assert.ok(store.isCurrent('viewer-2', b));
});

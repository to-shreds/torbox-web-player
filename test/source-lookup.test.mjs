import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceLookup, SourceLookupError, normalizeIndexRows, INDEX_ORIGIN } from '../lib/source-lookup.mjs';
import { loadPublicSources } from '../public/source-client.js';
const movie = { type: 'movie', id: 'tt1160419' };
const episode = { type: 'series', id: 'tt0903747', season: 1, episode: 2 };
const hash = 'a'.repeat(40);
const row = { info_hash: hash, imdb_id: movie.id, raw_title: 'Fixture.H264.AAC.1080p', resolution: '1080p', codec: 'H264', audio: ['AAC'], size: 1000 };
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const errorCode = code => e => e instanceof SourceLookupError && e.code === code;

test('source index enforces exact IMDb identity and valid torrent hash', () => {
  const result = normalizeIndexRows([row, { ...row, imdb_id: 'tt9999999' }, { ...row, info_hash: 'bad' }], movie);
  assert.equal(result.length, 1); assert.equal(result[0].hash, hash);
});
test('source index does not treat release titles or add-on indexes as filenames', () => {
  const [source] = normalizeIndexRows([{ ...row, filename: 'wrong.mp4', fileIdx: 0, url: 'https://untrusted.test', secret: 'sentinel' }], movie);
  assert.equal(source.filename, ''); assert.equal(source.fileIdx, null);
  assert.ok(!JSON.stringify(source).includes('untrusted')); assert.ok(!JSON.stringify(source).includes('sentinel'));
});
test('episode filters reject other seasons and episodes', () => {
  const valid = { ...row, imdb_id: episode.id, seasons: [1], episodes: [2] };
  const result = normalizeIndexRows([valid, { ...valid, seasons: [2] }, { ...valid, episodes: [3] }], episode);
  assert.equal(result.length, 1);
});
test('series packs retain identity and defer individual file choice to existing selector', () => {
  assert.equal(normalizeIndexRows([{ ...row, imdb_id: episode.id, seasons: [1], episodes: [] }], episode).length, 1);
});
test('known size strings are parsed while unknown sizes stay unknown', () => {
  assert.equal(normalizeIndexRows([{ ...row, size: '1.5 GB' }], movie)[0].size, 1500000000);
  for (const size of [null, -1, 'not-a-size']) assert.equal(normalizeIndexRows([{ ...row, size }], movie)[0].size, null);
});
test('real empty result remains distinct from a malformed or mismatched result', () => {
  assert.deepEqual(normalizeIndexRows([], movie), []);
  assert.throws(() => normalizeIndexRows({}, movie), errorCode('SOURCE_RESPONSE_INVALID'));
  assert.throws(() => normalizeIndexRows([{ ...row, imdb_id: 'tt9999999' }], movie), errorCode('SOURCE_IDENTITY_MISMATCH'));
});
test('normalized results are bounded to forty distinct source hashes', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...row, info_hash: i.toString(16).padStart(40, '0') }));
  assert.equal(normalizeIndexRows([...many, ...many], movie).length, 40);
});
test('invalid target is rejected before any network request', async () => {
  const s = new SourceLookup({ fetchFn: () => assert.fail('unexpected request') });
  for (const input of [null, {}, { ...movie, id: '../api' }, { type: 'series', id: episode.id }, { ...episode, season: -1 }]) await assert.rejects(s.lookup(input), errorCode('INVALID_TARGET'));
});
test('fixed public endpoint receives no household cookies or TorBox credentials', async () => {
  const s = new SourceLookup({ fetchFn: async (url, options) => {
    assert.equal(url.origin, INDEX_ORIGIN); assert.equal(url.pathname, '/dmm/filtered');
    assert.equal(url.searchParams.get('ImdbId'), movie.id); assert.equal(url.searchParams.size, 1);
    assert.deepEqual(options.headers, { Accept: 'application/json' }); assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
    return reply([row]);
  } });
  const result = await s.lookup({ ...movie, url: 'https://evil.test', apiKey: 'secret' });
  assert.equal(result.provider, 'Zilean'); assert.equal(result.sources.length, 1);
});
test('series request uses validated numeric season and episode parameters', async () => {
  const s = new SourceLookup({ fetchFn: async url => {
    assert.equal(url.searchParams.get('Season'), '1'); assert.equal(url.searchParams.get('Episode'), '2');
    return reply([{ ...row, imdb_id: episode.id }]);
  } });
  await s.lookup(episode);
});
test('repeated lookup coalesces requests and caches successful results', async () => {
  let calls = 0;
  const s = new SourceLookup({ fetchFn: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return reply([row]); } });
  await Promise.all([s.lookup(movie), s.lookup(movie)]); await s.lookup(movie);
  assert.equal(calls, 1);
});
test('movie and episode cache identities do not collide', async () => {
  let calls = 0;
  const s = new SourceLookup({ fetchFn: async url => { calls++; return reply([{ ...row, imdb_id: url.searchParams.get('ImdbId') }]); } });
  await s.lookup(movie); await s.lookup(episode); await s.lookup({ ...episode, episode: 3 });
  assert.equal(calls, 3);
});
test('empty results expire sooner and get rechecked', async () => {
  let now = 0, calls = 0;
  const s = new SourceLookup({ now: () => now, fetchFn: async () => { calls++; return reply([]); } });
  await s.lookup(movie); now = 59999; await s.lookup(movie); assert.equal(calls, 1);
  now = 60001; await s.lookup(movie); assert.equal(calls, 2);
});
test('successful source metadata expires after fifteen minutes', async () => {
  let now = 0, calls = 0;
  const s = new SourceLookup({ now: () => now, fetchFn: async () => { calls++; return reply([row]); } });
  await s.lookup(movie); now = 900001; await s.lookup(movie); assert.equal(calls, 2);
});
test('source denial does not become empty results or a proxy retry', async () => {
  for (const status of [401, 403]) {
    let calls = 0; const s = new SourceLookup({ fetchFn: async () => { calls++; return reply({ private: 'sentinel' }, status); } });
    await assert.rejects(s.lookup(movie), errorCode('SOURCE_ACCESS_DENIED')); assert.equal(calls, 1);
  }
});
test('server errors and non-JSON responses remain clear failures', async () => {
  for (const response of [reply({}, 500), new Response('<html>bad</html>'), reply({ wrong: [] })]) {
    const s = new SourceLookup({ fetchFn: async () => response });
    await assert.rejects(s.lookup(movie), e => e instanceof SourceLookupError);
  }
});
test('rate limiting honors Retry-After without retrying from another destination', async () => {
  let now = 0, calls = 0;
  const s = new SourceLookup({ now: () => now, fetchFn: async () => { calls++; return reply({}, 429, { 'retry-after': '120' }); } });
  await assert.rejects(s.lookup(movie), errorCode('SOURCE_RATE_LIMITED'));
  now = 60000; await assert.rejects(s.lookup(episode), errorCode('SOURCE_RATE_LIMITED')); assert.equal(calls, 1);
  now = 120001; await assert.rejects(s.lookup(episode)); assert.equal(calls, 2);
});
test('network and timeout errors are redacted and distinguishable', async () => {
  for (const [error, code] of [[new Error('https://private.test/key'), 'SOURCE_UNAVAILABLE'], [new DOMException('https://private.test/key', 'TimeoutError'), 'SOURCE_TIMEOUT']]) {
    const s = new SourceLookup({ fetchFn: async () => { throw error; } });
    await assert.rejects(s.lookup(movie), e => e.code === code && !JSON.stringify(e).includes('private.test'));
  }
});
test('failed lookups are briefly cached instead of hammering the provider', async () => {
  let now = 0, calls = 0;
  const s = new SourceLookup({ now: () => now, fetchFn: async () => { calls++; throw new Error(); } });
  await assert.rejects(s.lookup(movie)); await assert.rejects(s.lookup(movie)); assert.equal(calls, 1);
  now = 15001; await assert.rejects(s.lookup(movie)); assert.equal(calls, 2);
});
test('bounded response reading rejects oversized source responses', async () => {
  const s = new SourceLookup({ fetchFn: async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)) });
  await assert.rejects(s.lookup(movie), errorCode('SOURCE_RESPONSE_TOO_LARGE'));
});
test('at most four different upstream lookups run concurrently', async () => {
  const complete = [];
  const s = new SourceLookup({ fetchFn: () => new Promise(r => complete.push(() => r(reply([])))) });
  const jobs = Array.from({ length: 4 }, (_, i) => s.lookup({ ...episode, episode: i + 1 }));
  await assert.rejects(s.lookup({ ...episode, episode: 5 }), errorCode('SOURCE_BUSY'));
  for (const finish of complete) finish(); await Promise.all(jobs);
});
test('unsupported configured provider fails closed', async () => {
  const s = new SourceLookup({ provider: 'other', fetchFn: () => assert.fail() });
  await assert.rejects(s.lookup(movie), errorCode('SOURCE_NOT_CONFIGURED'));
});
test('browser source lookup only sends an authenticated same-origin request', async () => {
  const result = await loadPublicSources(episode, { fetchFn: async (url, opts) => {
    assert.equal(url, '/api/discover/lookup?type=series&id=tt0903747&season=1&episode=2');
    assert.equal(opts.mode, 'same-origin'); assert.equal(opts.credentials, 'same-origin'); assert.equal(opts.cache, 'no-store');
    assert.equal(opts.redirect, 'error'); assert.equal(opts.headers, undefined);
    return reply({ sources: [{ hash }] });
  } });
  assert.equal(result.length, 1);
});
test('browser distinguishes expired login and server provider errors', async () => {
  await assert.rejects(loadPublicSources(movie, { fetchFn: async () => reply({}, 401) }), /sign in/i);
  await assert.rejects(loadPublicSources(movie, { fetchFn: async () => reply({ message: 'Source lookup timed out.' }, 504) }), /Source lookup timed out/);
});
test('browser rejects malformed response but accepts real empty source list', async () => {
  await assert.rejects(loadPublicSources(movie, { fetchFn: async () => reply({ streams: [] }) }));
  assert.deepEqual(await loadPublicSources(movie, { fetchFn: async () => reply({ sources: [] }) }), []);
});
test('obsolete browser lookups honor cancellation without rewriting the error', async () => {
  const controller = new AbortController(); controller.abort();
  const cancelled = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(loadPublicSources(movie, { signal: controller.signal, fetchFn: async () => { throw cancelled; } }), e => e === cancelled);
});
test('browser network failures do not expose raw fetch exception text', async () => {
  await assert.rejects(loadPublicSources(movie, { fetchFn: async () => { throw new Error('sensitive token'); } }), e => !e.message.includes('sensitive token'));
});

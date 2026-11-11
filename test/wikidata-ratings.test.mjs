import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWikidataRatingsClient, normalizeWikidataRating, rottenTomatoesSnapshotUrl,
  wikidataRatingQuery, WIKIDATA_RATINGS_STORAGE_KEY, WIKIDATA_RATINGS_TTL_MS,
  WIKIDATA_RATINGS_MISSING_TTL_MS
} from '../public/wikidata-ratings.js';

const NOW = Date.parse('2026-11-11T05:00:00Z');
const movie = { id: 'tt0133093', type: 'movie' };
const literal = value => ({ type: 'literal', value });
const uri = value => ({ type: 'uri', value });
function row({ id = movie.id, score = '83%', date = '2026-01-16T00:00:00Z', slug = 'm/matrix', source = 'Q105584', method = 'Q108403393', item = 'Q83495' } = {}) {
  return {
    item: uri(`http://www.wikidata.org/entity/${item}`), imdb: literal(id), score: literal(score),
    source: uri(`http://www.wikidata.org/entity/${source}`), method: uri(`http://www.wikidata.org/entity/${method}`),
    recordedAt: { ...literal(date), datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' }, rt: literal(slug),
    rank: uri('http://wikiba.se/ontology#NormalRank')
  };
}
const payload = (...rows) => ({ results: { bindings: rows } });
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/sparql-results+json' } });
const ok = options => response(payload(row(options)));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function memoryStorage() {
  const rows = new Map();
  return { getItem: key => rows.get(key) || null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}

test('Wikidata exact identity query and request contain no user credentials or title text', async () => {
  let requests = 0;
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: async (input, options) => {
    requests++;
    const url = new URL(input);
    assert.equal(url.origin, 'https://query.wikidata.org');
    assert.equal(url.pathname, '/sparql');
    assert.equal(url.searchParams.get('format'), 'json');
    const query = url.searchParams.get('query');
    assert.match(query, /VALUES \?imdb \{ "tt0133093" \}/);
    assert.match(query, /\?source = wd:Q105584/);
    assert.match(query, /\?method = wd:Q108403393/);
    assert.match(query, /DeprecatedRank/);
    assert.match(query, /LIMIT 100$/);
    assert.doesNotMatch(input, /do-not-send|api.?key|secret/i);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Accept: 'application/sparql-results+json' });
    return ok();
  } });
  assert.equal(requests, 0);
  assert.equal(client.peek(movie.id, movie.type), null);
  assert.equal(requests, 0);
  const rating = await client.fetch({ ...movie, name: 'do-not-send', apiKey: 'secret' });
  assert.deepEqual(rating, { ...movie, score: 83, source: 'Rotten Tomatoes', provider: 'Wikidata', recordedAt: '2026-01-16T00:00:00.000Z', url: 'https://www.rottentomatoes.com/m/matrix', fetchedAt: NOW });
  assert.equal(requests, 1);
  assert.throws(() => wikidataRatingQuery('tt0133093" } UNION { ?a ?b ?c'), TypeError);
});

test('Wikidata accepts exact 0/100 percent bounds and preserves dated records', () => {
  assert.equal(normalizeWikidataRating(payload(row({ score: '0%' })), movie, NOW).score, 0);
  assert.equal(normalizeWikidataRating(payload(row({ score: '100%' })), movie, NOW).score, 100);
  const result = normalizeWikidataRating(payload(row({ score: '82%', date: '2025-01-01T00:00:00Z' }), row()), movie, NOW);
  assert.equal(result.score, 83);
  assert.equal(result.recordedAt, '2026-01-16T00:00:00.000Z');
  assert.equal(normalizeWikidataRating(payload(row(), row()), movie, NOW).score, 83);
  assert.equal(normalizeWikidataRating(payload(), movie, NOW), null);
});

test('Wikidata rejects wrong IMDb identity, rating source, method, rank, and title type', () => {
  for (const bad of [row({ id: 'tt0114709' }), row({ source: 'Q37312' }), row({ method: 'Q108403540', score: '8/10' }), row({ slug: 'tv/matrix' }), { ...row(), rank: uri('http://wikiba.se/ontology#DeprecatedRank') }]) {
    assert.throws(() => normalizeWikidataRating(payload(bad), movie, NOW), /could not be verified/);
  }
  assert.throws(() => normalizeWikidataRating(payload({ ...row(), source: literal('http://www.wikidata.org/entity/Q105584') }), movie, NOW));
  assert.throws(() => normalizeWikidataRating(payload(row()), { ...movie, type: 'episode' }, NOW), TypeError);
  assert.equal(normalizeWikidataRating(payload(row({ slug: 'tv/the_matrix' })), { ...movie, type: 'series' }, NOW).url, 'https://www.rottentomatoes.com/tv/the_matrix');
});

test('Wikidata rejects malformed scores and invalid, missing, or future dates', () => {
  for (const score of ['101%', '-1%', '83.5%', '8.3/10', '83/100', '0083%', '83', 'N/A', '', '<img>83%']) {
    assert.throws(() => normalizeWikidataRating(payload(row({ score })), movie, NOW), /could not be verified/);
  }
  for (const date of ['2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-01-16', '2027-01-16T00:00:00Z', 'yesterday', '2026-13-16T00:00:00Z', '2026-01-16T25:00:00Z']) {
    assert.throws(() => normalizeWikidataRating(payload(row({ date })), movie, NOW), /could not be verified/);
  }
  assert.throws(() => normalizeWikidataRating(payload({ ...row(), recordedAt: literal('2026-01-16T00:00:00Z') }), movie, NOW));
  assert.equal(normalizeWikidataRating(payload(row({ date: '2024-02-29T00:00:00Z' })), movie, NOW).recordedAt, '2024-02-29T00:00:00.000Z');
});

test('Wikidata refuses same-date score/link conflicts and duplicate entity identities', () => {
  assert.throws(() => normalizeWikidataRating(payload(row(), row({ score: '84%' })), movie, NOW), /could not be verified/);
  assert.throws(() => normalizeWikidataRating(payload(row(), row({ slug: 'm/matrix_1999' })), movie, NOW), /could not be verified/);
  assert.throws(() => normalizeWikidataRating(payload(row(), row({ item: 'Q83496' })), movie, NOW), /could not be verified/);
  // An older score differing from the current recorded snapshot is expected.
  assert.equal(normalizeWikidataRating(payload(row(), row({ score: '82%', date: '2025-01-01T00:00:00Z' })), movie, NOW).score, 83);
});

test('Wikidata only constructs exact safe Rotten Tomatoes title links', () => {
  for (const slug of ['https://evil.test/m/matrix', '//evil.test/m/matrix', 'm/matrix?redirect=evil', 'm/matrix#fragment', 'm/../login', 'm/matrix/../../', 'm/%2f%2fevil.test', 'm/matrix\\evil', 'm/matrix\n', 'tv/matrix/s01']) {
    assert.equal(rottenTomatoesSnapshotUrl(slug, 'movie'), '');
  }
  assert.equal(rottenTomatoesSnapshotUrl('m/matrix_1999-remastered', 'movie'), 'https://www.rottentomatoes.com/m/matrix_1999-remastered');
  assert.equal(rottenTomatoesSnapshotUrl('tv/matrix/s01', 'series'), '');
  assert.throws(() => normalizeWikidataRating({ results: {} }, movie, NOW));
  assert.throws(() => normalizeWikidataRating(payload(...Array.from({ length: 100 }, () => row())), movie, NOW));
});

test('Wikidata caches validated scores for seven days with safe persistent reload', async () => {
  let time = NOW, calls = 0;
  const storage = memoryStorage(), fetchFn = async () => { calls++; return ok(); };
  const client = createWikidataRatingsClient({ storage, now: () => time, fetchFn });
  const result = await client.fetch(movie);
  result.score = 1;
  assert.equal(client.peek(movie.id, movie.type).score, 83);
  assert.equal((await client.fetch(movie)).score, 83);
  assert.equal(calls, 1);
  time += WIKIDATA_RATINGS_TTL_MS - 1;
  const reloaded = createWikidataRatingsClient({ storage, now: () => time, fetchFn });
  assert.equal((await reloaded.fetch(movie)).score, 83);
  assert.equal(calls, 1);
  time++;
  assert.equal(reloaded.peek(movie.id, movie.type), null);
  await reloaded.fetch(movie);
  assert.equal(calls, 2);
});

test('Wikidata negative caches only confirmed absence for one hour', async () => {
  let time = NOW, calls = 0;
  const client = createWikidataRatingsClient({ storage: null, now: () => time, fetchFn: async () => { calls++; return response(payload()); } });
  assert.equal(await client.fetch(movie), null);
  assert.equal(await client.fetch(movie), null);
  assert.equal(calls, 1);
  time += WIKIDATA_RATINGS_MISSING_TTL_MS;
  assert.equal(await client.fetch(movie), null);
  assert.equal(calls, 2);
});

test('Wikidata malformed/conflicting data and network failures never become missing-score caches', async () => {
  let calls = 0;
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: async () => {
    calls++;
    if (calls === 1) throw new Error('Fixture network error');
    if (calls === 2) return response(payload(row(), row({ score: '84%' })));
    if (calls === 3) return new Response('{not JSON');
    return ok();
  } });
  await assert.rejects(client.fetch(movie));
  await assert.rejects(client.fetch(movie));
  await assert.rejects(client.fetch(movie));
  assert.equal((await client.fetch(movie)).score, 83);
  assert.equal(calls, 4);
});

test('Wikidata discards poisoned, future, extended-TTL, and malformed persistent entries', async () => {
  const good = normalizeWikidataRating(payload(row()), movie, NOW);
  for (const patch of [
    { value: { ...good, url: 'https://www.rottentomatoes.com.evil.test/m/matrix' } },
    { value: { ...good, url: 'https://www.rottentomatoes.com/m/matrix?key=abc' } },
    { value: { ...good, id: 'tt0114709' } },
    { value: { ...good, score: 180 } },
    { value: { ...good, recordedAt: '2028-01-01T00:00:00Z' } },
    { fetchedAt: NOW + 1000, value: { ...good, fetchedAt: NOW + 1000 } },
    { expiresAt: NOW + WIKIDATA_RATINGS_TTL_MS + 1 }
  ]) {
    const storage = memoryStorage(); let calls = 0;
    storage.setItem(WIKIDATA_RATINGS_STORAGE_KEY, JSON.stringify({ version: 1, entries: [{ ...movie, fetchedAt: NOW, expiresAt: NOW + WIKIDATA_RATINGS_TTL_MS, value: good, ...patch }] }));
    const client = createWikidataRatingsClient({ storage, now: () => NOW, fetchFn: async () => { calls++; return ok(); } });
    assert.equal(client.peek(movie.id, movie.type), null);
    assert.equal((await client.fetch(movie)).score, 83);
    assert.equal(calls, 1);
  }
});

test('Wikidata bounds memory and stored entries to 200 and tolerates blocked storage', async () => {
  const storage = memoryStorage(); let calls = 0;
  const client = createWikidataRatingsClient({ storage, now: () => NOW, fetchFn: async input => {
    calls++; const id = new URL(input).searchParams.get('query').match(/"(tt[0-9]+)"/)[1]; return ok({ id });
  } });
  for (let i = 0; i < 201; i++) await client.fetch({ id: `tt${String(10000 + i)}`, type: 'movie' });
  assert.equal(calls, 201);
  assert.equal(client.peek('tt10000', 'movie'), null);
  assert.equal(client.peek('tt10200', 'movie').score, 83);
  assert.equal(JSON.parse(storage.getItem(WIKIDATA_RATINGS_STORAGE_KEY)).entries.length, 200);
  const blocked = createWikidataRatingsClient({ storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } }, now: () => NOW, fetchFn: async () => ok() });
  await blocked.fetch(movie);
  assert.equal(blocked.peek(movie.id, movie.type).score, 83);
});

test('Wikidata caps parallel requests at two, queues safely, and coalesces identical details', async () => {
  const pending = [];
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: (url, options) => {
    const task = deferred(); pending.push({ task, options, id: new URL(url).searchParams.get('query').match(/"(tt[0-9]+)"/)[1] }); return task.promise;
  } });
  const first = client.fetch(movie), duplicate = client.fetch(movie);
  const second = client.fetch({ id: 'tt0114709', type: 'movie' }), third = client.fetch({ id: 'tt0027977', type: 'movie' });
  assert.equal(pending.length, 2);
  pending[0].task.resolve(ok());
  assert.equal((await first).score, 83); assert.equal((await duplicate).score, 83);
  await tick();
  assert.equal(pending.length, 3);
  pending[1].task.resolve(ok({ id: pending[1].id })); pending[2].task.resolve(ok({ id: pending[2].id }));
  await Promise.all([second, third]);
});

test('Wikidata one cancelled waiter cannot cancel another reader of the same title', async () => {
  const task = deferred(); let requestSignal;
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: (_, options) => { requestSignal = options.signal; return task.promise; } });
  const controller = new AbortController();
  const first = client.fetch(movie, { signal: controller.signal }), second = client.fetch(movie);
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, false);
  task.resolve(ok());
  assert.equal((await second).score, 83);
});

test('Wikidata cancellation aborts obsolete requests and late completion cannot write cache', async () => {
  const pending = []; let calls = 0;
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: (_, options) => { calls++; const task = deferred(); pending.push({ ...task, signal: options.signal }); return task.promise; } });
  const controller = new AbortController();
  const first = client.fetch(movie, { signal: controller.signal });
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(ok()); await tick();
  assert.equal(client.peek(movie.id, movie.type), null);
  const next = client.fetch(movie); await tick();
  assert.equal(calls, 2); pending[1].resolve(ok()); await next;
  const already = new AbortController(); already.abort();
  await assert.rejects(client.fetch(movie, { signal: already.signal }), { name: 'AbortError' });
});

test('Wikidata queued requests cancel without being sent', async () => {
  const pending = [];
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: input => { const task = deferred(); pending.push(task); return task.promise; } });
  const first = client.fetch(movie), second = client.fetch({ id: 'tt0114709', type: 'movie' });
  const controller = new AbortController(), queued = client.fetch({ id: 'tt0027977', type: 'movie' }, { signal: controller.signal });
  controller.abort(); await assert.rejects(queued, { name: 'AbortError' });
  pending[0].resolve(ok()); pending[1].resolve(ok({ id: 'tt0114709' })); await Promise.all([first, second]); await tick();
  assert.equal(pending.length, 2);
});

test('Wikidata deadline bounds an unresponsive fetch and does not cache its late result', async () => {
  const task = deferred(); let signal;
  const client = createWikidataRatingsClient({ storage: null, now: () => NOW, timeoutMs: 25, fetchFn: (_, options) => { signal = options.signal; return task.promise; } });
  await assert.rejects(client.fetch(movie), { name: 'TimeoutError' });
  assert.equal(signal.aborted, true);
  task.resolve(ok()); await tick();
  assert.equal(client.peek(movie.id, movie.type), null);
});

test('Wikidata bounds streamed response bodies and response-read duration', async () => {
  const oversized = createWikidataRatingsClient({ storage: null, now: () => NOW, fetchFn: async () => new Response('x'.repeat(256 * 1024 + 1)) });
  await assert.rejects(oversized.fetch(movie));
  const stuck = createWikidataRatingsClient({ storage: null, now: () => NOW, timeoutMs: 25, fetchFn: async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })) });
  await assert.rejects(stuck.fetch(movie), { name: 'TimeoutError' });
});

test('Wikidata observes provider retry-after without caching a rate limit as absent', async () => {
  let time = NOW, calls = 0;
  const client = createWikidataRatingsClient({ storage: null, now: () => time, fetchFn: async () => { calls++; return calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '120' } }) : ok(); } });
  await assert.rejects(client.fetch(movie));
  await assert.rejects(client.fetch(movie));
  assert.equal(calls, 1);
  assert.equal(client.peek(movie.id, movie.type), null);
  time += 120000;
  assert.equal((await client.fetch(movie)).score, 83);
  assert.equal(calls, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, normalizeMeta } from '../lib/catalog.mjs';

const ID = 'tt0133093';
const response = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const seed = (extra = {}) => ({ id: ID, type: 'movie', name: 'Fixture Movie', genres: ['Sci-Fi', 'Action', 'Drama'], director: ['Fixture Director'], cast: ['Lead Actor'], ...extra });
const movie = (id, extra = {}) => ({ id, type: 'movie', name: `Movie ${id}`, genres: ['Action'], ...extra });

test('detail metadata retains only bounded YouTube trailers and labels IMDb independently', () => {
  const meta = normalizeMeta(seed({
    trailers: [
      { source: 'FVI84Dfx2-I', type: 'Trailer' },
      { source: 'FVI84Dfx2-I', type: 'Trailer' },
      { source: 'https://evil.test/private', type: 'Trailer' },
      { source: 'abc_def-12', type: 'Trailer' },
      { source: 'abcdefghijk', type: 'Clip' },
      { source: 'zzzzzzzzzzz', type: { toString: 'invalid' } },
      { source: 'abcde:fghij', type: 'Trailer' }
    ],
    trailerStreams: [
      { ytId: 'FVI84Dfx2-I', title: 'Duplicate' },
      { ytId: 'abcdefghijk', title: 'Full\nTrailer' },
      { url: 'https://youtube.com/watch?v=12345678901' }
    ],
    imdbRating: '8.7',
    tomatoMeter: '99%'
  }), 'movie', ID);
  assert.deepEqual(meta.trailers, [
    { ytId: 'FVI84Dfx2-I', title: 'Trailer' },
    { ytId: 'abcdefghijk', title: 'Full Trailer' }
  ]);
  assert.equal(meta.imdbRating, 8.7);
  assert.equal(Object.hasOwn(meta, 'tomatoMeter'), false);
  const many = normalizeMeta(seed({ trailers: Array.from({ length: 100 }, (_, n) => ({ source: String(n).padStart(11, '0') })) }), 'movie', ID);
  assert.equal(many.trailers.length, 4);
});

test('ratings reject malformed, missing and out-of-range values instead of displaying invented zeroes', () => {
  for (const value of ['', 'N/A', '8/10', '8.7%', '-1', '10.1', '999', 'Infinity', null, undefined, {}, [], true, NaN]) {
    assert.equal(normalizeMeta(seed({ imdbRating: value }), 'movie', ID).imdbRating, null, String(value));
  }
  for (const value of [0, 10, ' 8.6 ']) assert.equal(normalizeMeta(seed({ imdbRating: value }), 'movie', ID).imdbRating, Number(value));
});

test('cast and directors are sanitized, deduplicated, bounded name lists', () => {
  const meta = normalizeMeta(seed({ cast: ['  Lead Actor ', 'lead actor', '', {}, null, 'Next\nActor', ...Array.from({ length: 30 }, (_, n) => `Actor ${n}`)], director: [' Director ', 'DIRECTOR', ...Array.from({ length: 8 }, (_, n) => `Director ${n}`)] }), 'movie', ID);
  assert.equal(meta.cast.length, 12);
  assert.deepEqual(meta.cast.slice(0, 2), ['Lead Actor', 'Next Actor']);
  assert.equal(meta.directors.length, 4);
  assert.equal(meta.directors[0], 'Director');
  assert.deepEqual(normalizeMeta(seed({ cast: null, director: 'One Director' }), 'movie', ID).directors, ['One Director']);
});

test('similar titles use two genre feeds, exclude the selected title and wrong types, and rank genuine overlap', async () => {
  const calls = [];
  const rows = [
    seed(),
    movie('tt1000001', { name: 'Single genre', genres: ['Action'], imdbRating: '9.9' }),
    movie('tt1000002', { name: 'Shared director and genres', genres: ['Action', 'Sci-Fi'], director: ['fixture director'], cast: ['lead actor'] }),
    movie('tt1000003', { name: 'Shared genres', genres: ['Action', 'Sci-Fi'] }),
    movie('tt1000004', { name: 'Unrelated provider result', genres: ['Horror'] }),
    movie('tt1000005', { type: 'series', name: 'Wrong type', genres: ['Action'] }),
    { id: 'invalid', name: 'Bad identity', genres: ['Action'] }
  ];
  const catalog = new Catalog({ fetchFn: async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return response(String(url).includes('/meta/') ? { meta: seed() } : { metas: rows });
  } });
  const result = await catalog.similar('movie', ID);
  assert.deepEqual(result.metas.map(meta => meta.id), ['tt1000002', 'tt1000003', 'tt1000001']);
  assert.equal(result.provider, 'Cinemeta');
  assert.equal(result.basedOn, 'genres');
  assert.deepEqual(calls, [
    `https://v3-cinemeta.strem.io/meta/movie/${ID}.json`,
    'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Sci-Fi.json',
    'https://v3-cinemeta.strem.io/catalog/movie/top/genre=Action.json'
  ]);
});

test('similar results have a fixed size and do not fetch any candidate detail pages', async () => {
  const calls = [];
  const catalog = new Catalog({ fetchFn: async url => {
    calls.push(String(url));
    return response(String(url).includes('/meta/') ? { meta: seed() } : { metas: Array.from({ length: 220 }, (_, n) => movie('tt' + (2000000 + n))) });
  } });
  const result = await catalog.similar('movie', ID);
  assert.equal(result.metas.length, 12);
  assert.equal(new Set(result.metas.map(meta => meta.id)).size, 12);
  assert.equal(calls.filter(url => url.includes('/meta/')).length, 1);
  assert.equal(calls.length, 3);
});

test('similar reads share browse/metadata caches, coalesce concurrent calls and expire normally', async () => {
  let now = 1000, calls = 0;
  const catalog = new Catalog({ now: () => now, fetchFn: async url => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 2));
    return response(String(url).includes('/meta/') ? { meta: seed({ genres: ['Action'] }) } : { metas: [movie('tt3000001')] });
  } });
  await catalog.meta('movie', ID);
  await catalog.search({ type: 'movie', genre: 'Action' });
  const [first, second] = await Promise.all([catalog.similar('movie', ID), catalog.similar('movie', ID)]);
  assert.deepEqual(first, second);
  assert.equal(first.metas.length, 1);
  await catalog.similar('movie', ID);
  assert.equal(calls, 2);
  now += 300001;
  await catalog.similar('movie', ID);
  assert.equal(calls, 4);
});

test('concurrent related titles reuse the same genre request', async () => {
  const calls = [];
  const catalog = new Catalog({ fetchFn: async url => {
    calls.push(String(url));
    await new Promise(resolve => setTimeout(resolve, 2));
    if (String(url).includes('/meta/')) return response({ meta: seed({ id: String(url).includes(ID) ? ID : 'tt4000001', genres: ['Action'] }) });
    return response({ metas: [movie('tt4000002')] });
  } });
  await Promise.all([catalog.similar('movie', ID), catalog.similar('movie', 'tt4000001')]);
  assert.equal(calls.filter(url => url.includes('/catalog/')).length, 1);
});

test('one failed genre feed still returns relevant results without fetching backup feeds', async () => {
  const calls = [];
  const catalog = new Catalog({ fetchFn: async url => {
    calls.push(String(url));
    if (String(url).includes('/meta/')) return response({ meta: seed() });
    if (String(url).includes('Sci-Fi')) return new Response('Unavailable', { status: 503 });
    return response({ metas: [movie('tt5000001')] });
  } });
  assert.deepEqual((await catalog.similar('movie', ID)).metas.map(meta => meta.id), ['tt5000001']);
  assert.equal(calls.length, 3);
});

test('failed similar reads are retryable and remain separate from successful details', async () => {
  let failed = true, calls = 0;
  const catalog = new Catalog({ fetchFn: async url => {
    calls++;
    if (String(url).includes('/meta/')) return response({ meta: seed() });
    return failed ? new Response('Unavailable', { status: 503 }) : response({ metas: [movie('tt6000001')] });
  } });
  const meta = await catalog.meta('movie', ID);
  await assert.rejects(catalog.similar('movie', ID), error => error.code === 'SIMILAR_UNAVAILABLE');
  assert.equal(calls, 3);
  assert.equal(await catalog.meta('movie', ID), meta);
  failed = false;
  assert.equal((await catalog.similar('movie', ID)).metas.length, 1);
  assert.equal(calls, 5);
});

test('missing genres return an empty shelf without generic unrelated recommendations', async () => {
  let calls = 0;
  const catalog = new Catalog({ fetchFn: async url => {
    calls++;
    assert.ok(String(url).includes('/meta/'));
    return response({ meta: seed({ genres: [] }) });
  } });
  assert.deepEqual((await catalog.similar('movie', ID)).metas, []);
  assert.equal(calls, 1);
});

test('similar validates requested identities and preserves metadata identity verification', async () => {
  let calls = 0;
  const catalog = new Catalog({ fetchFn: async () => { calls++; return response({ meta: seed({ id: 'tt9999999' }) }); } });
  for (const [type, id] of [['all', ID], ['movie', '../escape'], ['series', 'tt1'], ['movie', null]]) await assert.rejects(catalog.similar(type, id), error => error.code === 'INVALID_TITLE');
  assert.equal(calls, 0);
  await assert.rejects(catalog.similar('movie', ID), error => error.code === 'INVALID_METADATA');
  assert.equal(calls, 1);
});

test('same-genre series suggestions stay series and omit episode payloads', async () => {
  const catalog = new Catalog({ fetchFn: async url => response(String(url).includes('/meta/')
    ? { meta: seed({ type: 'series', genres: ['Comedy'] }) }
    : { metas: [movie('tt7000001', { type: 'series', genres: ['Comedy'], videos: [{ season: 1, episode: 1, name: 'First' }] }), movie('tt7000002', { genres: ['Comedy'] })] }) });
  const result = await catalog.similar('series', ID);
  assert.deepEqual(result.metas.map(meta => [meta.id, meta.type, meta.episodes]), [['tt7000001', 'series', []]]);
});

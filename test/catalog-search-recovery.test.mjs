import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, CATALOG_ORIGIN, CATALOG_SECONDARY, CATALOG_LIVE, IMDB_SUGGEST_ORIGIN } from '../lib/catalog.mjs';

const ORIGIN = new URL(CATALOG_ORIGIN).hostname;
const SECONDARY = new URL(CATALOG_SECONDARY).hostname;
const SUGGEST = new URL(IMDB_SUGGEST_ORIGIN).hostname;
const original = 'tt0773262', newBlood = 'tt14164730', resurrection = 'tt33043892';
const card = (id, name = 'Dexter', extra = {}) => ({ id, type: 'series', name, ...extra });
const reply = (metas, status = 200) => new Response(JSON.stringify({ metas }), { status, headers: { 'content-type': 'application/json' } });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ids = result => result.metas.map(meta => meta.id).sort();
const matching = [card(original), card(newBlood, 'Dexter: New Blood'), card(resurrection, 'Dexter: Resurrection')];
// The secondary catalog is a browse feed that ignores search. Incidental name
// matches must never replace results from the query-aware primary endpoint.
const popular = [matching[2], ...Array.from({ length: 49 }, (_, i) => card(`tt${9000000 + i}`, `Unrelated Popular Show ${i}`))];

test('a fast browse-only response cannot replace a slower complete title search', async () => {
  const calls = [];
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value); calls.push(url);
    if (url.hostname === ORIGIN) { await pause(25); return reply(matching); }
    if (url.hostname === SECONDARY) return reply(popular);
    assert.fail('successful Cinemeta search must not use suggestions');
  } });
  const result = await catalog.search({ type: 'series', q: 'Dexter' });
  assert.deepEqual(ids(result), matching.map(row => row.id).sort());
  assert.equal(result.nextSkip, null);
  assert.equal(calls.filter(url => url.hostname === SECONDARY).length, 0);
});

test('completing a title prefix retains matching titles despite incidental popular-feed matches', async () => {
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value), exact = url.pathname.includes('search=Dexter.json');
    if (url.hostname === ORIGIN) { if (exact) await pause(20); return reply(matching); }
    if (url.hostname === SECONDARY) return reply(popular);
    assert.fail('unexpected service');
  } });
  const prefix = await catalog.search({ type: 'series', q: 'Dexte' });
  const complete = await catalog.search({ type: 'series', q: 'Dexter' });
  assert.deepEqual(ids(prefix), matching.map(row => row.id).sort());
  assert.deepEqual(ids(complete), ids(prefix));
});

test('search normalization retains identity, relevance, type, and poster trust boundaries', async () => {
  const poster = `https://images.metahub.space/poster/medium/${original}/img`;
  const catalog = new Catalog({ fetchFn: async value => {
    assert.equal(new URL(value).hostname, ORIGIN);
    return reply([card(original, 'Dexter', { poster, releaseInfo: '2006-2013' }), card(original), card('tt9990011', 'Unrelated Title'), card('tt9990012', 'Dexter Movie', { type: 'movie' }), card(newBlood, 'Dexter: New Blood', { poster: 'https://untrusted.invalid/poster' }), card('bad', 'Dexter Invalid')]);
  } });
  const result = await catalog.search({ type: 'series', q: 'Dexter' });
  assert.deepEqual(ids(result), [original, newBlood].sort());
  assert.equal(result.metas.find(row => row.id === original).poster, poster);
  assert.equal(result.metas.find(row => row.id === newBlood).poster, '');
  assert.ok(result.metas.every(row => row.type === 'series' && row.episodes.length === 0));
});

test('concurrent identical queries share and cache complete search instead of a popular subset', async () => {
  let primaryCalls = 0, secondaryCalls = 0;
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value);
    if (url.hostname === ORIGIN) { primaryCalls++; await pause(25); return reply(matching); }
    if (url.hostname === SECONDARY) { secondaryCalls++; return reply(popular); }
    assert.fail('unexpected service');
  } });
  const results = await Promise.all(Array.from({ length: 5 }, () => catalog.search({ type: 'series', q: 'Dexter' })));
  for (const result of results) assert.deepEqual(ids(result), matching.map(row => row.id).sort());
  assert.deepEqual(ids(await catalog.search({ type: 'series', q: 'Dexter' })), ids(results[0]));
  assert.equal(primaryCalls, 1); assert.equal(secondaryCalls, 0);
});

test('a stalled search reaches its deadline and uses only catalog-validated IMDb fallback', async t => {
  const nativeTimeout = AbortSignal.timeout.bind(AbortSignal), budgets = [];
  t.mock.method(AbortSignal, 'timeout', ms => { budgets.push(ms); return nativeTimeout(Math.min(ms, 30)); });
  let primaryAborted = false, suggestions = 0, secondaryCalls = 0;
  const missing = 'tt9990030';
  const catalog = new Catalog({ fetchFn: async (value, options) => {
    const url = new URL(value);
    if (url.hostname === ORIGIN && url.pathname.includes('/catalog/')) return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { primaryAborted = true; reject(options.signal.reason); }, { once: true });
    });
    if (url.hostname === SECONDARY) { secondaryCalls++; return reply(popular); }
    if (url.hostname === SUGGEST) { suggestions++; return new Response(JSON.stringify({ d: [{ id: original, l: 'Dexter', qid: 'tvSeries' }, { id: missing, l: 'Dexter Missing', qid: 'tvSeries' }] })); }
    if (url.pathname === `/meta/series/${original}.json`) return new Response(JSON.stringify({ meta: card(original, 'Dexter', { videos: [] }) }));
    if (url.pathname === `/meta/series/${missing}.json`) return new Response('{}', { status: 404 });
    assert.fail('unexpected service');
  } });
  const keepAlive = setTimeout(() => {}, 500);
  try {
    assert.deepEqual(ids(await catalog.search({ type: 'series', q: 'Dexter' })), [original]);
    assert.equal(primaryAborted, true); assert.equal(suggestions, 1); assert.equal(secondaryCalls, 0);
    assert.ok(budgets[0] > 0 && budgets[0] <= 8000);
  } finally { clearTimeout(keepAlive); }
});

test('malformed or failed search cannot be replaced by incidental browse matches', async () => {
  for (const failure of ['malformed', 'unavailable']) {
    let suggestions = 0;
    const catalog = new Catalog({ fetchFn: async value => {
      const url = new URL(value);
      if (url.hostname === ORIGIN && url.pathname.includes('/catalog/')) return failure === 'malformed' ? new Response('<html>private error</html>') : new Response('private error', { status: 503 });
      if (url.hostname === SECONDARY) return reply(popular);
      if (url.hostname === SUGGEST) { suggestions++; return new Response(JSON.stringify({ d: [{ id: original, l: 'Dexter', qid: 'tvSeries' }] })); }
      if (url.pathname === `/meta/series/${original}.json`) return new Response(JSON.stringify({ meta: card(original) }));
      assert.fail('unexpected service');
    } });
    assert.deepEqual(ids(await catalog.search({ type: 'series', q: 'Dexter' })), [original]);
    assert.equal(suggestions, 1);
  }
});

test('all-provider errors remain distinguishable from successful empty searches', async () => {
  const unavailable = new Catalog({ fetchFn: async () => new Response('private provider details', { status: 503 }) });
  await assert.rejects(unavailable.search({ type: 'series', q: 'Dexter' }), error => error.code && !String(error.message).includes('private provider details'));
  const empty = new Catalog({ fetchFn: async value => new URL(value).hostname === SUGGEST ? new Response(JSON.stringify({ d: [] })) : reply([]) });
  const result = await empty.search({ type: 'series', q: 'Dexter' });
  assert.deepEqual(result.metas, []); assert.equal(result.nextSkip, null);
});

test('text-search pagination follows the query-aware provider page width and validated offset', async () => {
  const calls = [];
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value); calls.push(url); assert.equal(url.hostname, ORIGIN);
    const skip = Number(/skip=(\d+)/.exec(url.pathname)?.[1] || 0);
    return reply(Array.from({ length: skip === 0 ? 100 : 1 }, (_, i) => card(`tt${2000000 + skip + i}`, `Dexter Fixture ${skip + i}`)));
  } });
  const first = await catalog.search({ type: 'series', q: 'Dexter' });
  assert.equal(first.nextSkip, 100);
  const second = await catalog.search({ type: 'series', q: 'Dexter', skip: first.nextSkip });
  assert.deepEqual(ids(second), ['tt2000100']); assert.equal(second.nextSkip, null);
  assert.equal(calls.filter(url => url.pathname.includes('skip=100')).length, 1);
});

test('cross-type search keeps flexible metadata validation for conflicting IMDb IDs', async () => {
  let metadataChecks = 0;
  const shared = 'tt9990020';
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value), type = url.pathname.includes('/movie/') ? 'movie' : 'series';
    assert.equal(url.hostname, ORIGIN);
    if (url.pathname.includes('/meta/')) {
      metadataChecks++;
      return type === 'movie' ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ meta: card(shared, 'Dexter Fixture Canonical', { videos: [] }) }));
    }
    return reply([card(shared, 'Dexter Fixture', { type })]);
  } });
  const result = await catalog.search({ type: 'all', q: 'Dexter Fixture' });
  assert.deepEqual(result.metas.map(meta => [meta.id, meta.type]), [[shared, 'series']]);
  assert.ok(metadataChecks >= 2);
});

test('cross-type pagination uses the earliest remaining full-page offset', async () => {
  const catalog = new Catalog({ fetchFn: async value => {
    const url = new URL(value), type = url.pathname.includes('/movie/') ? 'movie' : 'series';
    assert.equal(url.hostname, ORIGIN);
    return reply(Array.from({ length: type === 'movie' ? 200 : 100 }, (_, i) => card(`tt${(type === 'movie' ? 3000000 : 4000000) + i}`, `Dexter Fixture ${i}`, { type })));
  } });
  assert.equal((await catalog.search({ type: 'all', q: 'Dexter' })).nextSkip, 100);
});

test('distinct exact-name titles with a year or poster survive a more complete same-name card', async () => {
  for (const partial of [{ releaseInfo: '2006-2013' }, { poster: `https://images.metahub.space/poster/medium/${original}/img` }]) {
    const movieId = 'tt9990040';
    const catalog = new Catalog({ fetchFn: async value => {
      const url = new URL(value); assert.equal(url.hostname, ORIGIN);
      assert.ok(url.pathname.includes('/catalog/'), 'distinct title identities must not require metadata probing');
      return reply(url.pathname.includes('/movie/')
        ? [card(movieId, 'Dexter', { type: 'movie', releaseInfo: '2025', poster: `https://images.metahub.space/poster/medium/${movieId}/img`, description: 'Complete fixture', genres: ['Drama'] })]
        : [card(original, 'Dexter', partial)]);
    } });
    assert.deepEqual(ids(await catalog.search({ type: 'all', q: 'Dexter' })), [original, movieId].sort());
  }
});

test('trusted catalog redirects share one timeout budget instead of restarting it', async () => {
  const signals = [];
  const catalog = new Catalog({ fetchFn: async (value, options) => {
    signals.push(options.signal);
    if (new URL(value).hostname === ORIGIN) return new Response(null, { status: 307, headers: { location: `${CATALOG_LIVE}/catalog/series/top/search=Dexter.json` } });
    return reply(matching);
  } });
  await catalog.requestUrl(`${CATALOG_ORIGIN}/catalog/series/top/search=Dexter.json`, 8000);
  assert.equal(signals.length, 2);
  assert.equal(signals[0], signals[1], 'redirect hops must consume one original deadline');
});

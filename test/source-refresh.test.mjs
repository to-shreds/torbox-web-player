import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceLookup, TorrentioSourceLookup, TorznabSourceLookup, StremioSourceLookup, MultiSourceLookup, PUBLIC_STREMIO_PROVIDERS, SOURCE_REFRESH_INTERVAL_MS } from '../lib/source-lookup.mjs';
import { loadPublicSources } from '../public/source-client.js';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';

const target = { type: 'movie', id: 'tt1160419' };
const HASH = 'a'.repeat(40);
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const source = extension => ({ hash: HASH, title: `Fixture.H264.AAC.${extension}`, filename: `Fixture.H264.AAC.${extension}` });
const streams = extension => ({ streams: extension ? [{ infoHash: HASH, behaviorHints: { filename: source(extension).filename } }] : [] });

const adapters = [
  ['Zilean', options => new SourceLookup(options), extension => json(extension ? [{ imdb_id: target.id, info_hash: HASH, raw_title: source(extension).title }] : [])],
  ['Torrentio', options => new TorrentioSourceLookup(options), extension => json(streams(extension))],
  ['Stremio', options => new StremioSourceLookup({ ...PUBLIC_STREMIO_PROVIDERS[0], ...options }), extension => json(streams(extension))],
  ['Torznab', options => new TorznabSourceLookup(options), extension => new Response(`<rss><channel>${extension ? `<item><title>${source(extension).title}</title><torznab:attr name="infohash" value="${HASH}"/><torznab:attr name="imdb" value="${target.id}"/></item>` : ''}</channel></rss>`)]
];

for (const [name, create, response] of adapters) test(`${name} explicit refresh replaces cached empty and incompatible sources before normal expiry`, async () => {
  for (const initial of ['', 'avi']) {
    let extension = initial, calls = 0;
    const provider = create({ now: () => 1000, fetchFn: async () => { calls++; return response(extension); } });
    const stale = await provider.lookup(target);
    extension = 'mp4';
    assert.deepEqual(await provider.lookup(target), stale);
    assert.equal(calls, 1);
    const fresh = await provider.lookup(target, { refresh: true });
    assert.equal(calls, 2);
    assert.equal(fresh.sources.length, 1);
    assert.equal(fresh.sources[0].browserContainer, true);
    assert.equal(fresh.sources[0].browserUnsupported, false);
  }
});

test('multi-provider explicit refresh bypasses both combined and adapter caches', async () => {
  let extension = 'avi', indexCalls = 0, streamCalls = 0;
  const index = new SourceLookup({ fetchFn: async () => { indexCalls++; return json([{ imdb_id: target.id, info_hash: HASH, raw_title: source(extension).title }]); } });
  const stream = new TorrentioSourceLookup({ fetchFn: async () => { streamCalls++; return json(streams(extension)); } });
  const lookup = new MultiSourceLookup({ providers: [index, stream] });
  assert.equal((await lookup.lookup(target)).sources[0].browserUnsupported, true);
  await turn();
  extension = 'mp4';
  assert.equal((await lookup.lookup(target)).sources[0].browserUnsupported, true);
  const fresh = await lookup.lookup(target, { refresh: true });
  assert.equal(fresh.sources[0].browserContainer, true);
  assert.equal(indexCalls, 2); assert.equal(streamCalls, 2);
});

test('refresh clicks and ordinary lookups coalesce, then refresh is throttled per target', async () => {
  let now = 1000, calls = 0, held = null;
  const provider = new TorrentioSourceLookup({ now: () => now, fetchFn: async () => { calls++; if (held) await held.promise; return json(streams(calls === 1 ? 'avi' : 'mp4')); } });
  const lookup = new MultiSourceLookup({ providers: [provider], now: () => now });
  await lookup.lookup(target); await turn();
  held = deferred();
  const retries = [lookup.lookup(target, { refresh: true }), lookup.lookup(target, { refresh: true }), lookup.lookup(target)];
  await turn(); assert.equal(calls, 2);
  held.resolve(); held = null;
  const results = await Promise.all(retries);
  assert.ok(results.every(result => result.sources[0].browserContainer));
  await turn();
  await lookup.lookup(target, { refresh: true }); assert.equal(calls, 2);
  now += SOURCE_REFRESH_INTERVAL_MS;
  await lookup.lookup(target, { refresh: true }); assert.equal(calls, 3);
});

test('refresh during a partial lookup waits for its existing complete result', async () => {
  let firstCalls = 0, lateCalls = 0;
  const late = deferred();
  const lookup = new MultiSourceLookup({ timeoutMs: 1500, providers: [
    { name: 'First', lookup: async () => { firstCalls++; return { sources: [{ ...source('mp4'), browserContainer: true }] }; } },
    { name: 'Late', lookup: async () => { lateCalls++; return late.promise; } }
  ] });
  const early = await lookup.lookup(target, { fast: true });
  assert.equal(early.complete, false);
  let refreshed = false;
  const retry = lookup.lookup(target, { fast: true, refresh: true }).then(value => { refreshed = true; return value; });
  await turn(); assert.equal(refreshed, false);
  late.resolve({ sources: [{ ...source('mp4'), hash: 'b'.repeat(40), browserContainer: true }] });
  const result = await retry;
  assert.equal(result.complete, true); assert.equal(result.sources.length, 2);
  assert.equal(firstCalls, 1); assert.equal(lateCalls, 1);
});

test('explicit refresh preserves provider rate and access cooldowns', async () => {
  for (const status of [403, 429]) {
    let now = 1000, calls = 0;
    const provider = new TorrentioSourceLookup({ now: () => now, fetchFn: async () => { calls++; return new Response('', { status, headers: { 'retry-after': '120' } }); } });
    await assert.rejects(provider.lookup(target));
    now += SOURCE_REFRESH_INTERVAL_MS + 1;
    await assert.rejects(provider.lookup(target, { refresh: true }), error => error.code === 'SOURCE_PROVIDER_COOLDOWN');
    assert.equal(calls, 1);
    const lookup = new MultiSourceLookup({ providers: [provider], now: () => now });
    await assert.rejects(lookup.lookup(target, { refresh: true }), error => error.code === 'SOURCE_ALL_UNAVAILABLE');
    assert.equal(calls, 1);
  }
});

test('explicit refresh preserves the four-target concurrency bound', async () => {
  const pending = [];
  const provider = new TorrentioSourceLookup({ fetchFn: async () => { const job = deferred(); pending.push(job); await job.promise; return json(streams('mp4')); } });
  const lookup = new MultiSourceLookup({ providers: [provider] });
  const jobs = Array.from({ length: 4 }, (_, index) => lookup.lookup({ ...target, id: `tt12345${index}` }, { refresh: true }));
  await turn();
  await assert.rejects(lookup.lookup({ ...target, id: 'tt123459' }, { refresh: true }), error => error.code === 'SOURCE_BUSY');
  assert.equal(pending.length, 4);
  for (const job of pending) job.resolve();
  await Promise.all(jobs);
});

test('browser source lookup sends refresh only when explicitly requested', async () => {
  const seen = [];
  const api = async path => { seen.push(new URL(path, 'https://fixture.test')); return { sources: [] }; };
  await loadPublicSources(target, { api });
  await loadPublicSources(target, { api, fast: true, refresh: true });
  assert.equal(seen[0].searchParams.has('refresh'), false);
  assert.equal(seen[1].searchParams.get('refresh'), '1');
  assert.equal(seen[1].searchParams.get('fast'), '1');
  assert.equal(seen[1].searchParams.get('id'), target.id);
});

test('authenticated HTTP refresh reaches real lookup caches while anonymous refresh is rejected', async t => {
  let extension = 'avi', calls = 0;
  const provider = new TorrentioSourceLookup({ fetchFn: async () => { calls++; return json(streams(extension)); } });
  const lookup = new MultiSourceLookup({ providers: [provider] });
  const app = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: await hashPassword('source-refresh-fixture'), PUBLIC_ORIGIN: 'https://fixture.test' }, sourceLookupService: lookup });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}/api/discover/lookup?type=movie&id=${target.id}`;
  const session = app.sessions.create();
  const headers = { Cookie: `tw_session=${session.id}`, Origin: 'https://fixture.test' };
  assert.equal((await fetch(base + '&refresh=1')).status, 401);
  assert.equal(calls, 0);
  const initial = await (await fetch(base, { headers })).json();
  assert.equal(initial.sources[0].browserUnsupported, true);
  extension = 'mp4';
  assert.equal((await (await fetch(base, { headers })).json()).sources[0].browserUnsupported, true);
  const refreshed = await (await fetch(base + '&refresh=1', { headers })).json();
  assert.equal(refreshed.sources[0].browserContainer, true);
  assert.equal(calls, 2);
  assert.equal(app.discovery.operations.size, 0); assert.equal(app.discovery.tickets.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiSourceLookup } from '../lib/source-lookup.mjs';
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';

const movie = { type: 'movie', id: 'tt1160419' };
const source = (id, options = {}) => ({ hash: id.toString(16).padStart(40, '0'), title: 'Fixture.mp4', score: 100, browserContainer: true, ...options });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

test('fast source lookup returns one usable provider while full lookup shares and retains the late provider', async () => {
  let fastCalls = 0, lateCalls = 0;
  const late = deferred();
  const lookup = new MultiSourceLookup({ timeoutMs: 1000, providers: [
    { name: 'Fast', lookup: async () => { fastCalls++; return { sources: [source(1)] }; } },
    { name: 'Late', lookup: async () => { lateCalls++; return late.promise; } }
  ] });
  const started = Date.now();
  const early = await lookup.lookup(movie, { fast: true });
  assert.ok(Date.now() - started < 600, 'a single usable provider must not wait for the 1-second hard bound');
  assert.equal(early.complete, false);
  assert.equal(early.sources.length, 1);
  let completeReturned = false;
  const complete = lookup.lookup(movie, { complete: true }).then(value => { completeReturned = true; return value; });
  await turn();
  assert.equal(completeReturned, false, 'full lookup must not reuse the incomplete fast cache');
  late.resolve({ sources: [source(2)] });
  const full = await complete;
  assert.equal(full.complete, true);
  assert.equal(full.sources.length, 2);
  assert.equal(early.sources.length, 1, 'late enrichment must not mutate an already returned batch');
  const cached = await lookup.lookup(movie, { fast: true });
  assert.equal(cached.complete, true);
  assert.equal(cached.sources.length, 2);
  assert.equal(fastCalls, 1);
  assert.equal(lateCalls, 1);
});

test('fast source lookup never finishes on only known unsupported containers', async () => {
  const later = deferred();
  const lookup = new MultiSourceLookup({ timeoutMs: 1000, providers: [
    { name: 'AVI', lookup: async () => ({ sources: [source(1, { browserContainer: false, browserUnsupported: true, title: 'Fixture.avi' })] }) },
    { name: 'MP4', lookup: async () => later.promise }
  ] });
  let returned = false;
  const fast = lookup.lookup(movie, { fast: true }).then(value => { returned = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(returned, false, 'AVI metadata must not trigger the fast grace timer');
  later.resolve({ sources: [source(2)] });
  const result = await fast;
  assert.equal(result.complete, true);
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.some(row => row.browserContainer));
});

test('fast source lookup exposes a bounded incomplete result when a provider stalls', async () => {
  const lookup = new MultiSourceLookup({ timeoutMs: 30, providers: [
    { name: 'Ready', lookup: async () => ({ sources: [source(1)] }) },
    { name: 'Stalled', lookup: async () => new Promise(() => {}) }
  ] });
  const started = Date.now();
  const result = await lookup.lookup(movie, { fast: true, complete: true });
  assert.ok(Date.now() - started < 300);
  assert.equal(result.complete, false);
  assert.equal(result.sources.length, 1);
});

test('background provider enrichment retains the four-target concurrency bound after fast responses', async () => {
  const pending = [];
  const lookup = new MultiSourceLookup({ timeoutMs: 1000, providers: [
    { name: 'Ready', lookup: async () => ({ sources: [source(1)] }) },
    { name: 'Held', lookup: async () => { const job = deferred(); pending.push(job); return job.promise; } }
  ] });
  const targets = Array.from({ length: 4 }, (_, index) => ({ type: 'series', id: movie.id, season: 1, episode: index + 1 }));
  await Promise.all(targets.map(target => lookup.lookup(target, { fast: true })));
  await assert.rejects(lookup.lookup({ ...targets[0], episode: 5 }, { fast: true }), error => error.code === 'SOURCE_BUSY');
  assert.equal(pending.length, 4);
  const completions = targets.map(target => lookup.lookup(target, { complete: true }));
  for (const job of pending) job.resolve({ sources: [] });
  await Promise.all(completions);
  await turn();
  assert.equal(lookup.inflight.size, 0);
});

test('full lookup bypasses incomplete cached data after the provider collection deadline', async () => {
  let calls = 0;
  const lookup = new MultiSourceLookup({ timeoutMs: 20, providers: [
    { name: 'Ready', lookup: async () => ({ sources: [source(1)] }) },
    { name: 'Previously stalled', lookup: async () => ++calls === 1 ? new Promise(() => {}) : { sources: [source(2)] } }
  ] });
  assert.equal((await lookup.lookup(movie, { fast: true })).complete, false);
  await turn();
  const full = await lookup.lookup(movie, { complete: true });
  assert.equal(full.complete, true);
  assert.equal(full.sources.length, 2);
  assert.equal(calls, 2);
});

test('HTTP fast and complete flags preserve validated targets and household authentication', async t => {
  const calls = [];
  const app = createApp({
    env: { HOUSEHOLD_PASSWORD_HASH: await hashPassword('source-startup-fixture'), PUBLIC_ORIGIN: 'https://fixture.test' },
    sourceLookupService: { lookup: async (target, options) => { calls.push({ target, options }); return { sources: [source(1)], complete: true }; } }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.server.closeAllConnections(); app.server.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}/api/discover/lookup?type=movie&id=${movie.id}`;
  const session = app.sessions.create();
  const headers = { Cookie: `tw_session=${session.id}`, Origin: 'https://fixture.test' };
  assert.equal((await fetch(base + '&fast=1')).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await fetch(base + '&fast=1&apiKey=ignored', { headers })).status, 200);
  assert.equal((await fetch(base + '&fast=1&complete=1', { headers })).status, 200);
  assert.equal((await fetch(base + '&fast=true&complete=true', { headers })).status, 200);
  assert.deepEqual(calls, [
    { target: movie, options: { fast: true, complete: false } },
    { target: movie, options: { fast: true, complete: true } },
    { target: movie, options: { fast: false, complete: false } }
  ]);
  assert.equal(app.discovery.operations.size, 0);
});

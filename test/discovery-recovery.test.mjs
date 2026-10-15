import test from 'node:test';
import assert from 'node:assert/strict';
import { Discovery, TorrentGateway } from '../lib/discovery.mjs';
import { AppError, TorBox } from '../lib/torbox.mjs';

const HASH = 'a'.repeat(40);
const target = { type: 'series', id: 'tt33043892', season: 1, episode: 2 };
const source = { hash: HASH, filename: 'Fixture.S01E02.H264.AAC.mp4' };
const item = id => ({ id, hash: HASH, download_finished: true, download_present: true,
  files: [{ id: 7, name: source.filename, mimetype: 'video/mp4', size: 12345 }] });
const missing = () => new AppError('PREPARED_ITEM_MISSING', 'No longer in account', 404);
const catalog = { meta: async () => ({ episodes: [{ season: 1, episode: 2, released: '2020-01-01' }] }) };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function fixture(overrides = {}) {
  const calls = { cached: 0, find: 0, create: [], item: [] };
  const gateway = {
    cached: async () => { calls.cached++; return { [HASH]: { cached: true, files: [{ name: source.filename }] } }; },
    find: async () => { calls.find++; return item(42); },
    create: async (hash, onlyCached) => { calls.create.push({ hash, onlyCached }); return 43; },
    item: async id => { calls.item.push(id); return item(id); },
    ...overrides
  };
  const discovery = new Discovery({ catalog, gateway });
  return { discovery, gateway, calls, register: async (session = 'session') => (await discovery.register({ target, sources: [source] }, session)).sources[0].id };
}

test('a transient cache read is retried once before cached-only selection', async () => {
  let attempts = 0;
  const f = fixture({ cached: async () => {
    if (++attempts === 1) throw new AppError('TORBOX_UNAVAILABLE', 'Connection interrupted');
    return { [HASH]: { cached: true, files: [{ name: source.filename }] } };
  } });
  const result = await f.discovery.register({ target, sources: [source] }, 'session');
  assert.equal(attempts, 2);
  assert.equal(result.sources[0].cached, true);
  assert.equal(result.cacheAvailability, 'checked');
  assert.equal(result.cacheErrorCode, '');
  assert.equal(f.calls.find, 0); assert.deepEqual(f.calls.create, []);
});

test('a repeated transient cache outage stays unknown and is not reported as an empty cache', async () => {
  let attempts = 0;
  const f = fixture({ cached: async () => { attempts++; throw new AppError('TORBOX_TIMEOUT', 'Timed out'); } });
  const result = await f.discovery.register({ target, sources: [source] }, 'session');
  assert.equal(attempts, 2);
  assert.equal(result.sources[0].cached, null);
  assert.equal(result.cacheAvailability, 'unknown');
  assert.equal(result.cacheErrorCode, 'TORBOX_TIMEOUT');
  assert.match(result.warning, /could not be checked/);
  assert.deepEqual(f.calls.create, []);
});

test('both cache-read timeouts fit inside the browser registration deadline and return unknown', async t => {
  const nativeTimeout = AbortSignal.timeout, timeouts = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    timeouts.push(milliseconds);
    // Accelerate only the network timer; both attempts still abort through the
    // actual AbortSignal/fetch rejection path and registration handles the result.
    return nativeTimeout.call(AbortSignal, milliseconds / 1000);
  });
  const fetchFn = async (url, { signal }) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(resolve, 1000);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
  });
  const discovery = new Discovery({ catalog, provider: { key: 'synthetic' }, fetchFn });
  const result = await discovery.register({ target, sources: [source] }, 'session');
  assert.deepEqual(timeouts, [6000, 6000]);
  assert.ok(timeouts.reduce((total, milliseconds) => total + milliseconds, 200 + 12000) < 30000);
  assert.equal(result.cacheAvailability, 'unknown');
  assert.equal(result.cacheErrorCode, 'TORBOX_TIMEOUT');
});

test('authentication, rate, plan and malformed cache errors are never retried', async () => {
  for (const code of ['TORBOX_ACCESS_DENIED', 'TORBOX_RATE_LIMITED', 'TORBOX_PLAN_RESTRICTED', 'CACHE_SCHEMA', 'INVALID_PROVIDER_RESPONSE', 'PROVIDER_RESPONSE_TOO_LARGE']) {
    let attempts = 0;
    const f = fixture({ cached: async () => { attempts++; throw new AppError(code, 'private payload must not escape'); } });
    const result = await f.discovery.register({ target, sources: [source] }, 'session');
    assert.equal(attempts, 1, code);
    assert.equal(result.cacheAvailability, 'unknown', code);
    assert.equal(result.cacheErrorCode, code, code);
    assert.equal(result.sources[0].cached, null, code);
    assert.ok(!JSON.stringify(result).includes('private payload'));
  }
});

test('a genuinely uncached result remains a checked negative without retry', async () => {
  let attempts = 0;
  const f = fixture({ cached: async () => { attempts++; return { [HASH]: { cached: false, files: [] } }; } });
  const result = await f.discovery.register({ target, sources: [source] }, 'session');
  assert.equal(attempts, 1); assert.equal(result.sources[0].cached, false);
  assert.equal(result.cacheAvailability, 'checked'); assert.equal(result.cacheErrorCode, '');
});

test('gateway classifies HTML service outages for read retry without hiding auth or rate limits', async () => {
  for (const [status, expected] of [[503, 'TORBOX_HTTP_ERROR'], [401, 'TORBOX_ACCESS_DENIED'], [403, 'TORBOX_ACCESS_DENIED'], [429, 'TORBOX_RATE_LIMITED']]) {
    const g = new TorrentGateway({ provider: { key: 'synthetic' }, fetchFn: async () => new Response('<html>service unavailable</html>', { status }) });
    await assert.rejects(g.cached([HASH]), error => error.code === expected, String(status));
  }
  const g = new TorrentGateway({ provider: { key: 'synthetic' }, fetchFn: async () => reply({ success: false, error: 'PLAN_RESTRICTED_FEATURE' }, 503) });
  await assert.rejects(g.cached([HASH]), error => error.code === 'TORBOX_PLAN_RESTRICTED');
});

test('actual TorBox mylist response mapping repairs a definite missing ID and keeps every write cached-only', async () => {
  let removed = false, creates = 0;
  const fetchFn = async (url, options) => {
    assert.equal(url.origin, 'https://api.torbox.app');
    if (url.pathname.endsWith('/checkcached')) return reply({ success: true, data: { [HASH]: { hash: HASH, files: [{ name: source.filename }] } } });
    if (url.pathname.endsWith('/createtorrent')) {
      creates++; assert.equal(options.body.get('add_only_if_cached'), 'true');
      assert.equal(options.body.get('magnet'), `magnet:?xt=urn:btih:${HASH}`);
      return reply({ success: true, data: { torrent_id: 43 } });
    }
    assert.ok(url.pathname.endsWith('/mylist'));
    const id = url.searchParams.get('id');
    if (id === '42' && removed) return reply({ success: true, data: [] });
    if (id) return reply({ success: true, data: [item(Number(id))] });
    return reply({ success: true, data: removed ? [] : [item(42)] });
  };
  const provider = new TorBox({ key: 'synthetic', fetchFn });
  const discovery = new Discovery({ catalog, provider, fetchFn });
  const id = (await discovery.register({ target, sources: [source] }, 'session')).sources[0].id;
  assert.equal((await discovery.prepare(id, 'session', true)).file.id, 'torrents:42:7');
  removed = true;
  assert.equal((await discovery.prepare(id, 'session', true)).file.id, 'torrents:43:7');
  assert.equal(creates, 1);
});

test('only successful absent-item responses mean missing; TorBox HTTP and error payload failures stay errors', async () => {
  for (const data of [null, []]) {
    const provider = new TorBox({ key: 'synthetic', fetchFn: async () => reply({ success: true, data }) });
    await assert.rejects(new TorrentGateway({ provider }).item(42), error => error.code === 'PREPARED_ITEM_MISSING');
  }
  for (const [status, data, code] of [
    [503, { success: false }, 'TORBOX_HTTP_ERROR'],
    [401, { success: false }, 'TORBOX_ACCESS_DENIED'],
    [429, { success: false }, 'TORBOX_RATE_LIMITED'],
    [200, { success: false, error: 'DATABASE_ERROR' }, 'TORBOX_REQUEST_FAILED']
  ]) {
    const provider = new TorBox({ key: 'synthetic', fetchFn: async () => reply(data, status) });
    await assert.rejects(new TorrentGateway({ provider }).item(42), error => error.code === code, String(status));
  }
});

test('ambiguous HTTP or malformed creation responses never become automatically retried writes', async () => {
  for (const response of [() => new Response('Service unavailable', { status: 503 }), () => reply({ success: false, error: 'CACHE_ERROR' }, 503), () => reply({ success: true, data: {} })]) {
    let creates = 0;
    const gateway = new TorrentGateway({ provider: { key: 'synthetic', request: async () => [] }, fetchFn: async () => { creates++; return response(); } });
    const discovery = new Discovery({ catalog, gateway });
    // Source tickets are registered with a read-only, synthetic cache snapshot.
    gateway.cached = async () => ({ [HASH]: true });
    const id = (await discovery.register({ target, sources: [source] }, 'session')).sources[0].id;
    await assert.rejects(discovery.prepare(id, 'session', true), error => error.code === 'CREATE_UNCERTAIN');
    await assert.rejects(discovery.prepare(id, 'session', true), error => error.code === 'CREATE_UNCERTAIN');
    assert.equal((await discovery.status(id, 'session')).state, 'uncertain');
    assert.equal(creates, 1);
  }
});

test('a stale prepared ID is reconciled to the same hash under a new account ID', async () => {
  const f = fixture(); const id = await f.register();
  assert.equal((await f.discovery.prepare(id, 'session', true)).file.id, 'torrents:42:7');
  f.gateway.item = async id => { f.calls.item.push(id); if (id === 42) throw missing(); return item(id); };
  f.gateway.find = async () => { f.calls.find++; return item(77); };
  const restored = await f.discovery.prepare(id, 'session', true);
  assert.equal(restored.file.id, 'torrents:77:7');
  assert.equal(f.calls.find, 2); assert.deepEqual(f.calls.create, []);
});

test('concurrent stale-ID recovery coalesces and recreates only through cached-only TorBox addition', async () => {
  const f = fixture(); const id = await f.register();
  await f.discovery.prepare(id, 'session', false);
  f.gateway.item = async id => { if (id === 42) throw missing(); return item(id); };
  f.gateway.find = async () => { f.calls.find++; await new Promise(resolve => setTimeout(resolve, 5)); return null; };
  const results = await Promise.all(Array.from({ length: 8 }, () => f.discovery.prepare(id, 'session', false)));
  assert.ok(results.every(result => result.state === 'ready' && result.file.id === 'torrents:43:7'));
  assert.equal(f.calls.find, 2);
  assert.deepEqual(f.calls.create, [{ hash: HASH, onlyCached: true }]);
});

test('missing immediately after creation waits for provider visibility without adding again', async () => {
  const f = fixture({ find: async () => null }); const id = await f.register();
  let visible = false;
  f.gateway.item = async id => { if (!visible) throw missing(); return item(id); };
  assert.equal((await f.discovery.prepare(id, 'session', true)).state, 'preparing');
  assert.equal((await f.discovery.prepare(id, 'session', true)).state, 'preparing');
  assert.equal((await f.discovery.status(id, 'session')).state, 'preparing');
  assert.equal(f.calls.create.length, 1);
  visible = true;
  assert.equal((await f.discovery.status(id, 'session')).state, 'ready');
  assert.equal(f.calls.create.length, 1);
});

test('a delayed old-ID response cannot confirm a new ID or cause a second cached-only creation', async () => {
  const f = fixture(); const id = await f.register();
  await f.discovery.prepare(id, 'session', true);
  let resolveOld, oldReads = 0;
  f.gateway.item = async requestedId => {
    if (requestedId === 42 && oldReads++ === 0) return new Promise(resolve => { resolveOld = resolve; });
    throw missing();
  };
  f.gateway.find = async () => null;
  const oldStatus = f.discovery.status(id, 'session');
  assert.equal((await f.discovery.prepare(id, 'session', true)).state, 'preparing');
  assert.equal(f.calls.create.length, 1);
  resolveOld(item(42));
  assert.equal((await oldStatus).state, 'preparing');
  assert.equal((await f.discovery.prepare(id, 'session', true)).state, 'preparing');
  assert.equal(f.calls.create.length, 1);
});

test('status and prepare share uncertain-add reconciliation without racing the duplicate guard', async () => {
  const f = fixture({ find: async () => null }); const id = await f.register();
  let creates = 0;
  f.gateway.create = async () => { creates++; throw new AppError('CREATE_UNCERTAIN', 'Lost response'); };
  await assert.rejects(f.discovery.prepare(id, 'session', true), error => error.code === 'CREATE_UNCERTAIN');
  let resolveFind, finds = 0;
  f.gateway.find = async () => { finds++; return new Promise(resolve => { resolveFind = resolve; }); };
  const status = f.discovery.status(id, 'session');
  const preparation = f.discovery.prepare(id, 'session', true);
  assert.equal(finds, 1);
  resolveFind(item(43));
  assert.equal((await status).state, 'ready');
  assert.equal((await preparation).state, 'ready');
  assert.equal(creates, 1);
});

test('an uncertain stale-ID recreation retains the duplicate guard across retry and status', async () => {
  const f = fixture(); const id = await f.register();
  await f.discovery.prepare(id, 'session', true);
  f.gateway.item = async () => { throw missing(); };
  f.gateway.find = async () => null;
  let creates = 0;
  f.gateway.create = async (hash, onlyCached) => { creates++; assert.equal(onlyCached, true); throw new AppError('CREATE_UNCERTAIN', 'Provider response lost'); };
  await assert.rejects(f.discovery.prepare(id, 'session', true), error => error.code === 'CREATE_UNCERTAIN');
  await assert.rejects(f.discovery.prepare(id, 'session', true), error => error.code === 'CREATE_UNCERTAIN');
  assert.equal((await f.discovery.status(id, 'session')).state, 'uncertain');
  assert.equal(creates, 1);
});

test('transport failures and a different torrent hash never trigger stale-ID recreation', async () => {
  for (const mode of ['network', 'identity']) {
    const f = fixture(); const id = await f.register();
    await f.discovery.prepare(id, 'session', true);
    f.gateway.item = async () => {
      if (mode === 'network') throw new AppError('TORBOX_TIMEOUT', 'Timed out');
      return { ...item(42), hash: 'b'.repeat(40) };
    };
    await assert.rejects(f.discovery.prepare(id, 'session', true), error => error.code === (mode === 'network' ? 'TORBOX_TIMEOUT' : 'TORRENT_IDENTITY_MISMATCH'));
    assert.equal(f.calls.find, 1); assert.deepEqual(f.calls.create, []);
  }
});

test('recovery remains session-bound and account-local', async () => {
  const a = fixture(), b = fixture();
  const id = await a.register();
  await a.discovery.prepare(id, 'session', true);
  await assert.rejects(a.discovery.prepare(id, 'different-session', true), error => error.code === 'SOURCE_EXPIRED');
  await assert.rejects(b.discovery.prepare(id, 'session', true), error => error.code === 'SOURCE_EXPIRED');
  assert.equal(b.calls.find, 0); assert.deepEqual(b.calls.create, []);
});

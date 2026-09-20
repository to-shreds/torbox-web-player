import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog, normalizeMeta, posterUrl, jsonFromResponse } from '../lib/catalog.mjs';
import { Discovery, TorrentGateway, chooseVideo, episodeIdentity } from '../lib/discovery.mjs';
import { targetOf, normalizeSources, loadPublicSources, sourceHints, browserContainerHints } from '../public/source-client.js';
import { applySourceMemory, setSourceBad } from '../public/source-memory.js';
import { AppError } from '../lib/torbox.mjs';
const HASH = 'a'.repeat(40), HASH2 = 'b'.repeat(40), ID = 'tt1254207';
const target = { type: 'movie', id: ID };
const source = { infoHash: HASH, fileIdx: 0, behaviorHints: { filename: 'Fixture.mp4', videoSize: 100 } };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const item = { id: 42, hash: HASH, name: 'Fixture', download_finished: true, download_present: true, files: [{ id: 7, name: 'Fixture.mp4', size: 100, mimetype: 'video/mp4' }] };
const catalog = { meta: async (type, id) => ({ id, type, name: 'Fixture', episodes: [{ season: 1, episode: 2, released: '2020-01-01' }] }) };
function fixture(extra = {}) {
  const calls = { cached: 0, find: 0, create: 0, item: 0 };
  const gateway = {
    cached: async () => { calls.cached++; return { [HASH]: true }; },
    find: async () => { calls.find++; return null; },
    create: async () => { calls.create++; await new Promise(r => setTimeout(r, 3)); return 42; },
    item: async () => { calls.item++; return item; }, ...extra
  };
  return { discovery: new Discovery({ catalog, gateway }), calls, gateway };
}
function memoryStore(){const map=new Map();return{getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};}
async function registered(d, input = { target, sources: [source] }, session = 's') { return (await d.register(input, session)).sources[0].id; }

test('catalog validates identities before making requests', async () => {
  const c = new Catalog({ fetchFn: () => assert.fail() });
  for (const type of ['../', 'other', '']) await assert.rejects(c.search({ type }));
  for (const id of ['../x', 'https://example.com', 'tt12']) await assert.rejects(c.meta('movie', id));
});
test('catalog broad search is encoded and independent of TorBox files', async () => {
  const seen = [];
  const c = new Catalog({ fetchFn: async url => { seen.push(String(url)); return response({ metas: [{ id: ID, type: 'movie', name: 'A & B/?' }] }); } });
  const result = await c.search({ q: 'A & B/?', genre: 'Science Fiction' });
  assert.ok(seen.some(path => path.startsWith('https://v3-cinemeta.strem.io/catalog/movie/top/')));
  assert.ok(seen.some(path => path.startsWith('https://cinemeta-catalogs.strem.io/top/catalog/movie/top/')));
  const cinemeta = seen.filter(path => path.includes('cinemeta'));
  assert.ok(cinemeta.every(path => path.includes('search=A%20%26%20B%2F%3F')));
  assert.ok(cinemeta.every(path => path.includes('genre=Science%20Fiction')));
  assert.equal(result.metas.length, 1); assert.equal(result.nextSkip, null);
});
test('catalog IMDb search resolves metadata rather than partial text matches', async () => {
  const c = new Catalog({ fetchFn: async url => { assert.ok(url.endsWith('/meta/movie/' + ID + '.json')); return response({ meta: { id: ID, type: 'movie', name: 'Fixture' } }); } });
  assert.equal((await c.search({ q: ID })).metas[0].id, ID);
  assert.deepEqual((await c.search({ q: ID, skip: 100 })).metas, []);
});
test('catalog handles empty results separately from failed or malformed requests', async () => {
  assert.equal((await new Catalog({ fetchFn: async () => response({ metas: [] }) }).search()).metas.length, 0);
  for (const reply of [response({}, 200), response({ metas: [] }, 503), response({ metas: [{ id: 'bad' }] })]) {
    await assert.rejects(new Catalog({ fetchFn: async () => reply }).search());
  }
});
test('catalog caches and coalesces repeated requests', async () => {
  let calls = 0;
  const c = new Catalog({ fetchFn: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return response({ metas: [] }); } });
  await Promise.all([c.search(), c.search()]); await c.search(); assert.equal(calls, 1);
});
test('catalog pagination never skips entries truncated by its size bound', async () => {
  const metas = Array.from({ length: 210 }, (_, i) => ({ id: 'tt' + String(1000000 + i), type: 'movie', name: 'Fixture' }));
  const result = await new Catalog({ fetchFn: async () => response({ metas }) }).search({ skip: 100 });
  assert.equal(result.metas.length, 200); assert.equal(result.nextSkip, 300);
});
test('metadata refuses a different title or content type', () => {
  assert.throws(() => normalizeMeta({ id: 'tt9999999', name: 'Wrong' }, 'movie', ID));
  assert.throws(() => normalizeMeta({ id: ID, type: 'series', name: 'Wrong' }, 'movie', ID));
});
test('episodes are numeric, stable and deduplicated; mismatched IDs are omitted', () => {
  const result = normalizeMeta({ id: ID, name: 'Fixture', videos: [
    { season: 1, episode: 10, name: 'Ten' }, { season: 1, episode: 2, name: 'Two' },
    { season: 0, episode: 1 }, { season: 1, episode: 2 }, { season: 2, episode: 1, id: 'tt9999999:2:1' }
  ] }, 'series', ID);
  assert.deepEqual(result.episodes.map(e => e.id), [ID + ':0:1', ID + ':1:2', ID + ':1:10']);
});
test('poster URLs permit only expected HTTPS image hosts', () => {
  assert.ok(posterUrl('https://images.metahub.space/poster/medium/' + ID + '/img'));
  for (const u of ['http://images.metahub.space/a', 'https://images.metahub.space.evil.test/a', 'https://u:p@images.metahub.space/a', 'https://127.0.0.1/a', 'javascript:alert(1)']) assert.equal(posterUrl(u), '');
});
test('bounded JSON readers reject oversized payloads', async () => {
  await assert.rejects(jsonFromResponse(response({ x: 'a'.repeat(100) }), 20));
});
test('target validation keeps specials and rejects ambiguous series requests', () => {
  assert.equal(targetOf({ type: 'series', id: ID, season: 0, episode: 1 }).season, 0);
  assert.throws(() => targetOf({ type: 'series', id: ID }));
  assert.throws(() => targetOf({ type: 'series', id: ID, season: -1, episode: 1 }));
  assert.throws(() => targetOf({ type: 'movie', id: '../' }));
});
test('source normalization preserves zero index and strips URLs and unrecognized fields', () => {
  const [s] = normalizeSources([{ ...source, url: 'https://secret.test/token', apiKey: 'private', infoHash: HASH.toUpperCase() }]);
  assert.equal(s.hash, HASH); assert.equal(s.fileIdx, 0); assert.equal(s.filename, 'Fixture.mp4');
  assert.ok(!JSON.stringify(s).includes('private')); assert.ok(!JSON.stringify(s).includes('secret.test'));
});
test('source normalization deduplicates and bounds results', () => {
  assert.equal(normalizeSources([source, source, { url: 'https://example.com' }]).length, 1);
  const rows = Array.from({ length: 100 }, (_, n) => ({ infoHash: n.toString(16).padStart(40, '0') }));
  assert.equal(normalizeSources(rows).length, 40);
});
test('source hints identify likely browser-friendly audio without promising universal compatibility', () => {
  const friendly = sourceHints({ filename: 'Test.H264.AAC.mp4' });
  const risky = sourceHints({ filename: 'Test.HEVC.DTS.mkv' });
  assert.equal(friendly.browserFriendly, true); assert.ok(/browser/i.test(friendly.hint));
  assert.equal(risky.browserFriendly, false); assert.equal(risky.audioRisk, true); assert.equal(risky.browserUnsupported,true);assert.ok(/Android Chrome/i.test(risky.hint));
});
test('container hints reject AVI and MKV even when codec names look friendly', () => {
  for (const source of [{ filename: 'Show.H264.AAC.avi' }, { container: 'mkv', title: 'Show H264 AAC' }, { mime: 'video/x-msvideo' }]) {
    const hints=sourceHints(source);assert.equal(hints.browserUnsupported,true);assert.equal(hints.browserFriendly,false);
  }
  assert.equal(browserContainerHints({ title:'Show.mp4' }).containerStatus,'supported');
  assert.equal(browserContainerHints({ title:'Package without extension' }).containerStatus,'unknown');
});
test('source lookup uses the authenticated same-origin website and no TorBox credentials', async () => {
  const result = await loadPublicSources({ type: 'series', id: ID, season: 2, episode: 10 }, { fetchFn: async (url, opts) => {
    assert.equal(url, `/api/discover/lookup?type=series&id=${ID}&season=2&episode=10`);
    assert.equal(opts.credentials, 'same-origin'); assert.equal(opts.mode, 'same-origin'); assert.equal(opts.headers, undefined);
    assert.equal(opts.redirect, 'error'); return response({ sources: [source] });
  } });
  assert.equal(result.length, 1);
});
test('source lookup treats provider denial as an error, never no sources', async () => {
  await assert.rejects(loadPublicSources(target, { fetchFn: async () => response({}, 403) }), /403/);
  await assert.rejects(loadPublicSources(target, { fetchFn: async () => response({ sources: [{}] }) }), /no supported/);
  assert.deepEqual(await loadPublicSources(target, { fetchFn: async () => response({ sources: [] }) }), []);
});
test('cache calls go only to TorBox and preserve hash query repetitions', async () => {
  const g = new TorrentGateway({ provider: { key: 'synthetic-secret' }, fetchFn: async (url, opts) => {
    assert.equal(url.origin, 'https://api.torbox.app'); assert.equal(url.pathname, '/v1/api/torrents/checkcached');
    assert.deepEqual(url.searchParams.getAll('hash'), [HASH, HASH2]); assert.equal(opts.headers.Authorization, 'Bearer synthetic-secret');
    assert.equal(opts.redirect, 'error'); return response({ success: true, data: { [HASH]: { hash: HASH } } });
  } });
  assert.deepEqual(await g.cached([HASH, HASH2]), { [HASH]: true, [HASH2]: false });
});
test('torrent creation uses only a hash magnet, with cached-only explicit option', async () => {
  const g = new TorrentGateway({ provider: { key: 'synthetic' }, fetchFn: async (url, opts) => {
    assert.ok(url.pathname.endsWith('/createtorrent')); assert.equal(opts.method, 'POST');
    assert.equal(opts.body.get('magnet'), 'magnet:?xt=urn:btih:' + HASH); assert.equal(opts.body.get('allow_zip'), 'false');
    assert.equal(opts.body.get('add_only_if_cached'), 'true'); return response({ success: true, data: { torrent_id: 0 } });
  } });
  assert.equal(await g.create(HASH, true), 0);
});
test('unconfirmed creation never turns into an automatically retried write', async () => {
  const { discovery: d, calls } = fixture({ create: async () => { calls.create++; throw new AppError('CREATE_UNCERTAIN', 'Interrupted'); } });
  const id = await registered(d);
  await assert.rejects(d.prepare(id, 's')); await assert.rejects(d.prepare(id, 's'));
  assert.equal(calls.create, 1); assert.equal((await d.status(id, 's')).state, 'uncertain');
});
test('unreadable or missing-hash account rows stop duplicate reconciliation', async () => {
  const g = new TorrentGateway({ provider: { request: async () => [{ id: 1, name: 'Bad response' }] } });
  await assert.rejects(g.find(HASH));
});
test('registering sources and checking availability never enqueues', async () => {
  const { discovery: d, calls } = fixture(); const id = await registered(d);
  assert.equal(calls.create, 0); assert.equal(calls.find, 0); assert.equal(calls.cached, 1);
  assert.equal((await d.status(id, 's')).state, 'not_started');
});
test('re-registering a source preserves its hash-based bad-source memory',async()=>{
  const {discovery:d}=fixture(),store=memoryStore();
  const first=(await d.register({target,sources:[source]},'s')).sources[0];
  setSourceBad(target,first,true,store);
  const second=(await d.register({target,sources:[source]},'s')).sources[0];
  assert.notEqual(first.id,second.id);assert.equal(first.hash,HASH);assert.equal(second.hash,HASH);
  assert.equal(applySourceMemory(target,[second],store)[0].memoryBad,true);
});
test('availability failure preserves sources and marks cached state unknown', async () => {
  const { discovery: d } = fixture({ cached: async () => { throw new Error('private-url'); } });
  const r = await d.register({ target, sources: [source] }, 's');
  assert.equal(r.sources[0].cached, null); assert.ok(r.warning); assert.ok(!JSON.stringify(r).includes('private-url'));
});
test('preparation is idempotent across concurrent sessions for the same hash', async () => {
  const { discovery: d, calls } = fixture(); const a = await registered(d), b = await registered(d, { target, sources: [source] }, 'other');
  const results = await Promise.all([d.prepare(a, 's'), d.prepare(a, 's'), d.prepare(b, 'other')]);
  assert.equal(calls.create, 1); assert.ok(results.every(r => r.state === 'ready')); assert.equal(results[0].file.id, 'torrents:42:7');
});
test('existing account torrent is reused before a mutation', async () => {
  const { discovery: d, calls } = fixture({ find: async () => item }); const id = await registered(d);
  assert.equal((await d.prepare(id, 's')).state, 'ready'); assert.equal(calls.create, 0);
});
test('actual AVI file is rejected before browser playback even when source metadata was unknown', async () => {
  const aviItem={...item,files:[{id:7,name:'Fixture.avi',size:100,mimetype:'video/x-msvideo'}]};
  const {discovery:d}=fixture({find:async()=>aviItem,item:async()=>aviItem});
  const id=await registered(d,{target,sources:[{infoHash:HASH,title:'Unknown package'}]});
  const result=await d.prepare(id,'s');assert.equal(result.state,'browser_unsupported');assert.equal(result.compatibility.container,'avi');assert.match(result.message,/Android Chrome/);
});
test('source tickets are session-bound and revoked on logout', async () => {
  const { discovery: d } = fixture(); const id = await registered(d);
  await assert.rejects(d.prepare(id, 'other')); d.revoke('s'); await assert.rejects(d.prepare(id, 's'));
});
test('source tickets expire instead of becoming permanent playback URLs', async () => {
  const { discovery: d } = fixture(); let now = 0; d.now = () => now;
  const id = await registered(d); now = 1800001; await assert.rejects(d.status(id, 's'));
});
test('series episode must exist in authoritative metadata', async () => {
  const { discovery: d } = fixture();
  await assert.rejects(registered(d, { target: { type: 'series', id: ID, season: 5, episode: 1 }, sources: [source] }), e => e.code === 'EPISODE_NOT_FOUND');
});
test('future episodes cannot start preparation', async () => {
  const { discovery: d } = fixture(); d.catalog = { meta: async () => ({ episodes: [{ season: 1, episode: 1, released: '2099-01-01' }] }) };
  await assert.rejects(registered(d, { target: { type: 'series', id: ID, season: 1, episode: 1 }, sources: [source] }), e => e.code === 'EPISODE_NOT_RELEASED');
});
test('returned torrent identity must match the originally selected hash', async () => {
  const { discovery: d } = fixture({ item: async () => ({ ...item, hash: HASH2 }) }); const id = await registered(d);
  await assert.rejects(d.prepare(id, 's'), e => e.code === 'TORRENT_IDENTITY_MISMATCH');
});
test('provider preparation percentages are not invented', async () => {
  const { discovery: d } = fixture({ item: async () => ({ ...item, download_finished: false, progress: undefined }) }); const id = await registered(d);
  const r = await d.prepare(id, 's'); assert.equal(r.state, 'preparing'); assert.equal(r.progress, null);
});
test('fileIndex zero is not interpreted as a TorBox file ID', () => {
  const files = [{ id: 'torrents:1:5', title: 'Fixture.mp4' }, { id: 'torrents:1:0', title: 'Other.mp4' }];
  assert.equal(chooseVideo(files, target, { filename: 'Fixture.mp4', fileIdx: 0 }).file.id, 'torrents:1:5');
});
test('episode matching cannot switch season or episode', () => {
  const t = { type: 'series', season: 1, episode: 2 };
  const files = [{ id: 'a', title: 'Show.S01E02.mp4' }, { id: 'b', title: 'Show.S02E02.mp4' }, { id: 'c', title: 'Show.S01E03.mp4' }];
  assert.equal(chooseVideo(files, t, {}).file.id, 'a');
  assert.throws(() => chooseVideo(files, t, {}, 'b'));
});
test('multiple movie files and multi-episode files require explicit choice', () => {
  assert.equal(chooseVideo([{ id: 'a', title: 'A.mp4' }, { id: 'b', title: 'B.mp4' }], target, {}).file, null);
  const files = [{ id: 'a', title: 'Show.S01E02E03.mp4' }];
  assert.equal(chooseVideo(files, { type: 'series', season: 1, episode: 2 }, {}).file, null);
  assert.equal(chooseVideo(files, { type: 'series', season: 1, episode: 2 }, {}, 'a').file.id, 'a');
});
test('samples and trailers never beat the selected full video', () => {
  const f = [{ id: 'a', title: 'movie.sample.mp4' }, { id: 'b', title: 'movie.mp4' }];
  assert.equal(chooseVideo(f, target, {}).file.id, 'b');
});
test('alternate numeric episode form and specials are recognized', () => {
  assert.deepEqual(episodeIdentity('Show.1x02.mp4'), { season: 1, episode: 2, multi: false });
  assert.equal(episodeIdentity('Show.S00E01.mp4').season, 0);
  assert.equal(episodeIdentity('Movie.2024.mp4'), null);
});

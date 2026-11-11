import test from 'node:test';
import assert from 'node:assert/strict';
import {createTitleRatingsClient} from '../public/title-ratings.js';

const movie = {id:'tt0133093', type:'movie'};
const KEY_STORE = 'torbox-omdb-key-v1';
const CACHE_STORE = 'torbox-title-ratings-v1';
function memoryStorage() {
  const values = new Map();
  return {values, getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,String(value)), removeItem:key => values.delete(key)};
}
const response = (meta = movie, score = '88%', additions = {}) => new Response(JSON.stringify({Response:'True', imdbID:meta.id, Type:meta.type, Ratings:[{Source:'Internet Movie Database', Value:'8.7/10'}, {Source:'Rotten Tomatoes', Value:score}], ...additions}), {headers:{'content-type':'application/json'}});
function fixture(options = {}) {
  const storage = options.storage || memoryStorage(), calls = [];
  let time = 1000000;
  const client = createTitleRatingsClient({storage, now:() => time, fetchFn:async(url,init) => {calls.push({url,init}); return response();}, ...options});
  return {client, storage, calls, advance:amount => time += amount};
}
const deferred = () => {let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('ratings stay entirely idle without a user-provided key or valid title identity', async () => {
  const f = fixture();
  assert.equal(f.client.getRatingsKey(), '');
  assert.equal(await f.client.fetchRottenTomatoes(movie), null);
  assert.equal(f.client.peekRottenTomatoes(movie.id), null);
  f.client.setRatingsKey('testkey1');
  for (const meta of [{...movie,id:'other'},{...movie,type:'episode'},{id:movie.id},null]) assert.equal(await f.client.fetchRottenTomatoes(meta), null);
  assert.equal(f.calls.length, 0);
});

test('exact IMDb/type lookup sends only the optional key to OMDb and caches a genuine RT score', async () => {
  const f = fixture();
  f.client.setRatingsKey(' testkey1 ');
  const score = await f.client.fetchRottenTomatoes(movie);
  assert.deepEqual(score, {...movie,score:88,source:'Rotten Tomatoes',provider:'OMDb',fetchedAt:1000000});
  assert.equal(f.calls.length, 1);
  const {url,init} = f.calls[0], endpoint = new URL(url);
  assert.equal(endpoint.origin, 'https://www.omdbapi.com');
  assert.deepEqual(Object.fromEntries(endpoint.searchParams), {apikey:'testkey1',i:movie.id,type:'movie',r:'json',plot:'short'});
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, {Accept:'application/json'});
  assert.deepEqual(await f.client.fetchRottenTomatoes(movie), score);
  assert.deepEqual(f.client.peekRottenTomatoes(movie.id,'movie'), score);
  assert.equal(f.client.peekRottenTomatoes(movie.id,'series'), null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.storage.getItem(KEY_STORE), 'testkey1');
  assert.ok(!f.storage.getItem(CACHE_STORE).includes('testkey1'));
  assert.deepEqual([...f.storage.values.keys()].sort(), [KEY_STORE,CACHE_STORE].sort());
});

test('0% is retained; IMDb and malformed percentages never become RT scores', async () => {
  for (const [value,wanted] of [['0%',0],['100%',100],['101%',null],['-1%',null],['8.7/10',null],['98.5%',null],['N/A',null]]) {
    const f = fixture({fetchFn:async() => response(movie,value)});
    f.client.setRatingsKey('testkey1');
    assert.equal((await f.client.fetchRottenTomatoes(movie))?.score ?? null, wanted);
  }
  const f = fixture({fetchFn:async() => response(movie,'88%',{Ratings:[{Source:'Internet Movie Database',Value:'88%'}],tomatoMeter:'88'})});
  f.client.setRatingsKey('testkey1');
  assert.equal(await f.client.fetchRottenTomatoes(movie), null);
});

test('a response for the wrong IMDb ID or media type is rejected without a cache entry', async () => {
  for (const additions of [{imdbID:'tt0114709'},{Type:'series'},{Response:'garbled'}]) {
    const f = fixture({fetchFn:async() => response(movie,'88%',additions)});
    f.client.setRatingsKey('testkey1');
    await assert.rejects(f.client.fetchRottenTomatoes(movie), {code:'RATINGS_IDENTITY_MISMATCH'});
    assert.equal(f.client.peekRottenTomatoes(movie.id), null);
    assert.deepEqual(JSON.parse(f.storage.getItem(CACHE_STORE)).entries, []);
  }
});

test('positive scores survive reload for seven days; an unavailable score expires sooner', async () => {
  const f = fixture();
  f.client.setRatingsKey('testkey1');
  await f.client.fetchRottenTomatoes(movie);
  const reload = fixture({storage:f.storage});
  assert.equal((await reload.client.fetchRottenTomatoes(movie)).score, 88);
  assert.equal(reload.calls.length, 0);
  f.advance(7*24*60*60*1000 + 1);
  assert.equal(f.client.peekRottenTomatoes(movie.id), null);
  await f.client.fetchRottenTomatoes(movie);
  assert.equal(f.calls.length, 2);

  let requests = 0;
  const empty = fixture({fetchFn:async() => {requests++;return response(movie,'N/A');}});
  empty.client.setRatingsKey('testkey1');
  assert.equal(await empty.client.fetchRottenTomatoes(movie), null);
  assert.equal(await empty.client.fetchRottenTomatoes(movie), null);
  assert.equal(requests, 1);
  empty.advance(6*60*60*1000 + 1);
  await empty.client.fetchRottenTomatoes(movie);
  assert.equal(requests, 2);
});

test('missing title is briefly cached, but credential, quota, transport and malformed responses are not title misses', async () => {
  let mode = 'missing', requests = 0;
  const f = fixture({fetchFn:async() => {
    requests++;
    if (mode === 'missing') return new Response(JSON.stringify({Response:'False',Error:'Movie not found!'}));
    if (mode === 'key') return new Response(JSON.stringify({Response:'False',Error:'Invalid API key!'}));
    if (mode === 'quota') return new Response(JSON.stringify({Response:'False',Error:'Request limit reached!'}));
    if (mode === 'network') throw new Error('Failed URL ?apikey=testkey1');
    if (mode === 'broken') return new Response('<html>unexpected</html>');
    return response();
  }});
  f.client.setRatingsKey('testkey1');
  await f.client.fetchRottenTomatoes(movie);
  await f.client.fetchRottenTomatoes(movie);
  assert.equal(requests, 1);
  for (const [next,code] of [['key','RATINGS_KEY_INVALID'],['quota','RATINGS_QUOTA'],['network','RATINGS_UNAVAILABLE'],['broken','RATINGS_UNAVAILABLE']]) {
    mode = next;
    f.client.setRatingsKey('testkey1');
    await assert.rejects(f.client.fetchRottenTomatoes(movie), error => error.code === code && !error.message.includes('testkey1'));
    assert.equal(JSON.parse(f.storage.getItem(CACHE_STORE)).entries.length, 0);
  }
  mode = 'success';
  f.client.setRatingsKey('testkey1');
  assert.equal((await f.client.fetchRottenTomatoes(movie)).score, 88);
});

test('an invalid key temporarily stops further requests and a saved key can retry immediately', async () => {
  let requests = 0;
  const f = fixture({fetchFn:async() => {requests++;return new Response('',{status:401});}});
  f.client.setRatingsKey('testkey1');
  await assert.rejects(f.client.fetchRottenTomatoes(movie), {code:'RATINGS_KEY_INVALID'});
  await assert.rejects(f.client.fetchRottenTomatoes({...movie,id:'tt0114709'}), {code:'RATINGS_KEY_INVALID'});
  assert.equal(requests,1);
  f.client.setRatingsKey('testkey2');
  await assert.rejects(f.client.fetchRottenTomatoes(movie), {code:'RATINGS_KEY_INVALID'});
  assert.equal(requests,2);
});

test('duplicate callers share a request, and cancelling one does not cancel the other', async () => {
  const gate = deferred(), calls = [];
  const f = fixture({fetchFn:(url,init) => {calls.push({url,init});return gate.promise;}});
  f.client.setRatingsKey('testkey1');
  const firstController = new AbortController();
  const first = f.client.fetchRottenTomatoes(movie,{signal:firstController.signal});
  const second = f.client.fetchRottenTomatoes(movie);
  assert.equal(calls.length,1);
  firstController.abort();
  await assert.rejects(first,{name:'AbortError'});
  assert.equal(calls[0].init.signal.aborted,false);
  gate.resolve(response());
  assert.equal((await second).score,88);
});

test('closing the only waiting details view aborts its request and prevents a late cache write', async () => {
  const gate = deferred();
  let requestSignal;
  const f = fixture({fetchFn:(_url,init) => {requestSignal=init.signal;return gate.promise;}});
  f.client.setRatingsKey('testkey1');
  const controller = new AbortController(), pending = f.client.fetchRottenTomatoes(movie,{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(requestSignal.aborted,true);
  gate.resolve(response());
  await tick();
  assert.equal(f.client.peekRottenTomatoes(movie.id),null);
});

test('changing/removing the key cancels old work, invalidates misses and ignores delayed old-key results', async () => {
  const old = deferred();
  let requests = 0;
  const f = fixture({fetchFn:async() => {requests++;return requests===1 ? old.promise : response(movie,'90%');}});
  f.client.setRatingsKey('testkey1');
  const pending = f.client.fetchRottenTomatoes(movie);
  f.client.setRatingsKey('testkey2');
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal((await f.client.fetchRottenTomatoes(movie)).score,90);
  old.resolve(response(movie,'12%'));
  await tick();
  assert.equal(f.client.peekRottenTomatoes(movie.id).score,90);
  f.client.clearRatingsKey();
  assert.equal(f.client.getRatingsKey(),'');
  assert.equal(f.client.peekRottenTomatoes(movie.id),null);
  assert.equal(await f.client.fetchRottenTomatoes(movie),null);
  assert.equal(requests,2);
});

test('cross-tab removal of a key is observed before a delayed request can populate the cache', async () => {
  const gate = deferred(), f = fixture({fetchFn:() => gate.promise});
  f.client.setRatingsKey('testkey1');
  const pending = f.client.fetchRottenTomatoes(movie);
  f.storage.removeItem(KEY_STORE);
  gate.resolve(response());
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.client.getRatingsKey(),'');
  assert.deepEqual(JSON.parse(f.storage.getItem(CACHE_STORE)).entries,[]);
});

test('network concurrency stays at two and queued requests retain their own identities', async () => {
  const gates = [], requested = [];
  const f = fixture({fetchFn:(url) => {const gate=deferred();gates.push(gate);requested.push(new URL(url).searchParams.get('i'));return gate.promise;}});
  f.client.setRatingsKey('testkey1');
  const metas = [movie,{...movie,id:'tt0114709'},{...movie,id:'tt0027977'}];
  const pending = metas.map(meta => f.client.fetchRottenTomatoes(meta));
  assert.deepEqual(requested,metas.slice(0,2).map(meta=>meta.id));
  gates[0].resolve(response(metas[0]));
  await pending[0];
  assert.deepEqual(requested,metas.map(meta=>meta.id));
  gates[1].resolve(response(metas[1]));gates[2].resolve(response(metas[2]));
  assert.deepEqual((await Promise.all(pending)).map(score=>score.id),metas.map(meta=>meta.id));
});

test('timeout is bounded even when a provider ignores cancellation', async () => {
  let requestSignal;
  const f = fixture({timeoutMs:15,fetchFn:(_url,init) => {requestSignal=init.signal;return new Promise(()=>{});}});
  f.client.setRatingsKey('testkey1');
  await assert.rejects(f.client.fetchRottenTomatoes(movie),{code:'RATINGS_UNAVAILABLE'});
  assert.equal(requestSignal.aborted,true);
  assert.equal(f.client.peekRottenTomatoes(movie.id),null);
});

test('oversized streaming responses are cancelled and never persisted', async () => {
  let cancelled = false;
  const f = fixture({fetchFn:async() => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(65000));controller.enqueue(new Uint8Array(1000));},cancel() {cancelled=true;}}))});
  f.client.setRatingsKey('testkey1');
  await assert.rejects(f.client.fetchRottenTomatoes(movie),{code:'RATINGS_UNAVAILABLE'});
  assert.equal(cancelled,true);
  assert.deepEqual(JSON.parse(f.storage.getItem(CACHE_STORE)).entries,[]);
});

test('persistent public cache remains capped and rejects poisoned or overlong records', async () => {
  const f = fixture({fetchFn:async url => response({...movie,id:new URL(url).searchParams.get('i')})});
  f.client.setRatingsKey('testkey1');
  for(let n=1000000;n<1000202;n++) await f.client.fetchRottenTomatoes({...movie,id:`tt${n}`});
  const stored = JSON.parse(f.storage.getItem(CACHE_STORE));
  assert.equal(stored.entries.length,200);
  assert.equal(f.client.peekRottenTomatoes('tt1000000'),null);
  assert.equal(stored.entries[0].id,'tt1000002');
  assert.ok(!JSON.stringify(stored).includes('testkey1'));
  stored.entries = [
    {...stored.entries[0],id:movie.id,score:101},
    {...stored.entries[1],id:movie.id,expiresAt:9999999999999},
    {...stored.entries[2],id:movie.id,fetchedAt:1000001}
  ];
  f.storage.setItem(CACHE_STORE,JSON.stringify(stored));
  const reloaded = fixture({storage:f.storage});
  assert.equal(reloaded.client.peekRottenTomatoes(movie.id),null);
  f.storage.setItem(CACHE_STORE,' '.repeat(100001));
  assert.equal(fixture({storage:f.storage}).client.peekRottenTomatoes(movie.id),null);
});

test('key validation/storage failures are explicit and never initiate requests', () => {
  const f = fixture();
  assert.throws(() => f.client.setRatingsKey('https://example.com/?key=secret'),{code:'RATINGS_KEY_INVALID'});
  assert.equal(f.calls.length,0);
  const client = createTitleRatingsClient({storage:null});
  assert.throws(() => client.setRatingsKey('testkey1'),{code:'RATINGS_STORAGE_UNAVAILABLE'});
  const blocked = createTitleRatingsClient({storage:{getItem(){throw new Error();},setItem(){throw new Error();}}});
  assert.equal(blocked.getRatingsKey(),'');
  assert.throws(() => blocked.setRatingsKey('testkey1'),{code:'RATINGS_STORAGE_UNAVAILABLE'});
});

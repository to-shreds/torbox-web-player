import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackPreparationCache } from '../public/playback-lifecycle.js';
import { loadPublicSources } from '../public/source-client.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
test('details warm and Play share one preparation, retained until its short expiry',async()=>{
  let now=0,calls=0;const work=deferred(),cache=new PlaybackPreparationCache({now:()=>now,ttlMs:100});
  const load=()=>{calls++;return work.promise;},a=cache.get('movie',load),b=cache.get('movie',load);
  work.resolve({file:'ready'});assert.deepEqual(await a,await b);assert.equal(calls,1);
  assert.deepEqual(await cache.get('movie',load),{file:'ready'});assert.equal(calls,1);
  now=101;await cache.get('movie',()=>{calls++;return{file:'fresh'};});assert.equal(calls,2);
});
test('canceling one Play waiter cannot deliver late playback or cancel a shared title warm',async()=>{
  const cache=new PlaybackPreparationCache(),work=deferred(),controller=new AbortController();let sharedSignal;
  const warm=cache.get('movie',signal=>{sharedSignal=signal;return work.promise;});
  const play=cache.get('movie',()=>assert.fail('duplicate work'),{signal:controller.signal});
  controller.abort();await assert.rejects(play,error=>error.name==='AbortError');
  assert.equal(sharedSignal.aborted,false);work.resolve('ready');assert.equal(await warm,'ready');
});
test('title close aborts pending work while successful preparation remains reusable',async()=>{
  const cache=new PlaybackPreparationCache(),work=deferred();let signal;
  await cache.get('ready',()=>({file:1}));const pending=cache.get('pending',s=>{signal=s;return work.promise;});
  await Promise.resolve();cache.cancelPending();assert.equal(signal.aborted,true);work.resolve('obsolete');
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.deepEqual(await cache.get('ready',()=>assert.fail('completed work discarded')),{file:1});
});
test('session/viewer cache clear aborts work and discards all prepared identities',async()=>{
  const cache=new PlaybackPreparationCache(),work=deferred();let signal;
  await cache.get('ready',()=>1);const pending=cache.get('pending',s=>{signal=s;return work.promise;});
  await Promise.resolve();cache.clear();assert.equal(signal.aborted,true);work.resolve(2);await assert.rejects(pending);
  assert.equal(cache.rows.size,0);assert.equal(await cache.get('ready',()=>3),3);
});
test('canceling the sole foreground or next-episode waiter aborts its upstream work',async()=>{
  const cache=new PlaybackPreparationCache(),work=deferred(),controller=new AbortController();let signal;
  const pending=cache.get('episode',s=>{signal=s;return work.promise;},{signal:controller.signal});
  await Promise.resolve();controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(signal.aborted,true);assert.equal(cache.rows.size,0);work.resolve('obsolete');
});
test('failed preparations never poison the cache, and the row count stays bounded',async()=>{
  const cache=new PlaybackPreparationCache({maxEntries:2});
  await assert.rejects(cache.get('fail',()=>Promise.reject(new Error('temporary'))));
  assert.equal(await cache.get('fail',()=>1),1);await cache.get('other',()=>2);await cache.get('third',()=>3);
  assert.equal(cache.rows.size,2);assert.equal(cache.rows.has('fail'),false);
});
test('fast source response retains completion metadata for safe slower-provider fallback',async()=>{
  const target={type:'movie',id:'tt1160419'};let url;
  const row={hash:'a'.repeat(40),filename:'Dune.2021.720p.H264.AAC.mp4'};
  const result=await loadPublicSources(target,{fast:true,withMetadata:true,api:async path=>{url=path;return{sources:[row],complete:false};}});
  assert.match(url,/fast=1/);assert.equal(result.complete,false);assert.equal(result.sources.length,1);
  await loadPublicSources(target,{complete:true,api:async path=>{assert.match(path,/complete=1/);return{sources:[row],complete:true};}});
});

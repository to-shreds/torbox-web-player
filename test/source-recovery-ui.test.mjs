import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticCachedSourceOrder, browserPreparationOptions, isRecoverableSourceFailure, resolveAutomaticCachedSource } from '../public/discover.js';

const safe=(id,extra={})=>({id,hash:id.repeat(40),cached:true,browserContainer:true,browserFriendly:true,browserUnsupported:false,cachedBrowserPlayable:null,audioRisk:false,videoRisk:false,resolution:'720p',filename:'Fixture.Show.S01E01.H264.AAC.mp4',...extra});

test('an unknown cache check remains eligible, but a confirmed uncached source never enters automatic playback',async()=>{
  const unknown=safe('a',{cached:null}),uncached=safe('b',{cached:false});
  assert.deepEqual(automaticCachedSourceOrder([uncached,unknown],'series').map(row=>row.id),['a']);
  const tried=[];
  const result=await resolveAutomaticCachedSource([uncached,unknown],{type:'series'},'auto',{prepare:async source=>{tried.push(source.id);return{state:'ready',file:{id:'exact-file'}};}});
  assert.equal(result.source.id,'a');assert.deepEqual(tried,['a']);
});

test('recovery retains cached copies that were slow instead of discarding every choice',()=>{
  const cached=safe('a'),uncached=safe('b',{cached:false});
  assert.deepEqual(browserPreparationOptions([cached,uncached],'series').map(row=>row.id),['a','b']);
});

test('unknown containers are offered only with independent browser-compatible evidence',()=>{
  const plausible=safe('a',{cached:false,browserContainer:false,browserFriendly:true,filename:'Fixture.Show.S01E01.H264.AAC',containerStatus:'unknown'});
  const verified=safe('b',{cached:true,browserContainer:false,browserFriendly:false,cachedBrowserPlayable:true,filename:'Fixture.Show.S01E01',containerStatus:'unknown'});
  const unconfirmed=safe('c',{cached:false,browserContainer:false,browserFriendly:false,filename:'Fixture.Show.S01E01',containerStatus:'unknown'});
  assert.deepEqual(new Set(browserPreparationOptions([plausible,verified,unconfirmed],'series').map(row=>row.id)),new Set(['a','b']));
});

test('curated recovery still excludes known container, codec, cache-file, and user-feedback failures',()=>{
  const rows=[safe('a',{browserUnsupported:true}),safe('b',{cachedBrowserPlayable:false}),safe('c',{audioRisk:true}),safe('d',{videoRisk:true}),safe('e',{memoryBad:true}),safe('f',{memoryAudio:'bad'})];
  assert.deepEqual(browserPreparationOptions(rows,'series'),[]);
  assert.equal(browserPreparationOptions([safe('a'),safe('b'),safe('c'),safe('d')],'series').length,3);
});

test('temporary source failures allow recovery while cancellation and identity mismatches do not',()=>{
  for(const code of ['NO_CACHED_BROWSER_SOURCE','SOURCE_TIMEOUT','TORBOX_TIMEOUT','TORBOX_CONNECTION_ERROR','TORBOX_RATE_LIMITED','CACHED_SOURCE_NOT_READY','SOURCE_EXPIRED'])assert.equal(isRecoverableSourceFailure({code}),true,code);
  assert.equal(isRecoverableSourceFailure({name:'TimeoutError'}),true);
  assert.equal(isRecoverableSourceFailure({name:'AbortError'}),false);
  assert.equal(isRecoverableSourceFailure({code:'TORRENT_IDENTITY_MISMATCH'}),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticCachedSourceOrder, browserPreparationOptions, isRecoverableSourceFailure, resolveAutomaticCachedSource, recommendSource, sourceLanguagePreference, sourceLanguageLabel, playbackFailureDetails } from '../public/discover.js';

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

test('explicit English audio wins among otherwise safe versions without guessing release-group language',()=>{
  const english=safe('a',{languages:['en'],score:0}),foreign=safe('b',{languages:['ru'],score:1000}),unknown=safe('c',{filename:'Fixture.Show.S01E01.H264.AAC.le-production.mp4',score:900});
  assert.equal(recommendSource([foreign,unknown,english],'series').id,'a');
  assert.equal(sourceLanguagePreference(unknown),2);
  assert.equal(sourceLanguageLabel(unknown),'Language unconfirmed');
});

test('English-only beats multilingual audio, but risky English codecs do not displace a safe unknown version',()=>{
  const english=safe('a',{languages:['en'],score:0}),multilingual=safe('b',{languages:['en','fr'],score:1000});
  assert.equal(recommendSource([multilingual,english],'series').id,'a');
  const risky=safe('c',{languages:['en'],audioRisk:true,score:1000}),safeUnknown=safe('d',{languages:[],score:0});
  assert.equal(recommendSource([risky,safeUnknown],'series').id,'d');
});

test('an unconfirmed DUB version cannot outrank an unconfirmed original merely for an AAC tag',()=>{
  const dubbed=safe('a',{filename:'Fixture.Show.S01E01.H264.AAC.DUB.mp4',score:1000});
  const unconfirmed=safe('b',{filename:'Fixture.Show.S01E01.H264.mp4',browserFriendly:false,score:0});
  assert.equal(recommendSource([dubbed,unconfirmed],'series').id,'b');
  assert.equal(sourceLanguageLabel(dubbed),'Dubbed · language unconfirmed');
});

test('known foreign-only audio is explicit-only while an English track keeps a multilingual version eligible',()=>{
  const foreign=safe('a',{languages:['ru']}),english=safe('b',{languages:['en','ru']});
  assert.deepEqual(automaticCachedSourceOrder([foreign,english],'series').map(row=>row.id),['b']);
  assert.deepEqual(browserPreparationOptions([foreign,english],'series').map(row=>row.id),['b','a']);
  assert.equal(sourceLanguageLabel(foreign),'Russian');
  assert.equal(sourceLanguageLabel(english),'English / Russian');
});

test('equivalent English native containers are preferred ahead of a conditional MKV',()=>{
  const native=safe('a',{languages:['en'],container:'mp4',containerStatus:'supported',score:0});
  const conditional=safe('b',{languages:['en'],container:'mkv',containerStatus:'conditional',score:1000});
  assert.equal(recommendSource([conditional,native],'series').id,'a');
});

test('playback diagnostic counts useful states without copying filenames, hashes, credentials, or error payloads',()=>{
  const details=playbackFailureDetails({type:'series',id:'tt33043892',season:1,episode:2,apiKey:'secret-target'},[safe('a',{languages:['en'],filename:'private-file.mp4',title:'private-title',url:'https://cdn.example/secret'})],{code:'SOURCE_TIMEOUT',message:'secret-error',registered:{cacheAvailability:'unknown',cacheErrorCode:'TORBOX_TIMEOUT',session:'secret-session'}},1,'release-test.1');
  assert.deepEqual(details,{target:{type:'series',id:'tt33043892',season:1,episode:2},appBuild:'release-test.1',failureCode:'SOURCE_TIMEOUT',sourceCount:1,containerCounts:{mp4:1},eligibleCount:1,cacheAvailability:'unknown',cacheErrorCode:'TORBOX_TIMEOUT',languageCounts:{english:1,foreignOnly:0,unconfirmed:0}});
  assert.doesNotMatch(JSON.stringify(details),/private|secret|cdn|aaaaaaa/);
});

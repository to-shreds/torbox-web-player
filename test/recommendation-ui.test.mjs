import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recommendSource, automaticSourceOrder, automaticCachedSourceOrder, resolveAutomaticCachedSource, isAutomaticCandidateFailure, selectAutomaticVideoFile, filterSourcesByResolution, episodeQueue, sourceMatchesResolution, lowerResolutionOrder, recoverySourceOrder, boundedRecoverySourceOrder, sourceRecoveryKey, MAX_AUTOMATIC_SOURCE_ATTEMPTS, AUTOMATIC_SOURCE_PREPARE_TIMEOUT_MS } from '../public/discover.js';
import { parseSizeBytes } from '../public/source-client.js';
import { normalizeIndexRows } from '../lib/source-lookup.mjs';

const G=1024**3;
const src=(id,extra={})=>({id,score:0,cached:true,browserFriendly:true,audioRisk:false,resolution:'1080p',size:2*G,...extra});

test('movie recommendation prefers cached 720p under about 3 GB',()=>{
  const best=recommendSource([src('1080'),src('720big',{resolution:'720p',size:5*G}),src('720good',{resolution:'720p',size:2.4*G})],'movie','auto');
  assert.equal(best.id,'720good');
});
test('show recommendation prefers cached 720p under about 1 GB',()=>{
  const best=recommendSource([src('large',{resolution:'720p',size:1.8*G}),src('small',{resolution:'720p',size:.72*G})],'series','auto');
  assert.equal(best.id,'small');
});
test('browser-friendly uncached source beats cached known-silent audio when necessary',()=>{
  const best=recommendSource([src('risky',{audioRisk:true,browserFriendly:false}),src('safe',{cached:false,browserFriendly:true,resolution:'720p'})],'movie','auto');
  assert.equal(best.id,'safe');
});
test('known MP4 source beats cached AVI and unsupported containers never enter automatic order',()=>{
  const avi=src('avi',{cached:true,browserFriendly:false,browserUnsupported:true,browserContainer:false,containerStatus:'unsupported'});
  const mkv=src('mkv',{cached:true,browserFriendly:false,browserUnsupported:true,browserContainer:false,containerStatus:'unsupported'});
  const mp4=src('mp4',{cached:false,browserFriendly:false,browserUnsupported:false,browserContainer:true,containerStatus:'supported'});
  assert.equal(recommendSource([avi,mkv,mp4],'series','auto').id,'mp4');
  assert.deepEqual(automaticSourceOrder([avi,mkv,mp4],'series','auto').map(source=>source.id),['mp4']);
  assert.equal(recommendSource([avi,mkv],'series','auto'),null);
});
test('cached plausible source is tried before an uncached MP4',()=>{
  const cached=src('cached-unknown',{browserFriendly:false,browserContainer:false,browserUnsupported:false,containerStatus:'unknown'});
  const mp4=src('uncached-mp4',{cached:false,browserFriendly:true,browserContainer:true,browserUnsupported:false,containerStatus:'supported'});
  assert.equal(recommendSource([mp4,cached],'series','auto').id,'cached-unknown');
  assert.deepEqual(automaticSourceOrder([mp4,cached],'series','auto').map(source=>source.id),['cached-unknown','uncached-mp4']);
  assert.deepEqual(automaticCachedSourceOrder([mp4,cached],'series','auto').map(source=>source.id),['cached-unknown']);
});
test('automatic playback never prepares an uncached source',async()=>{
  const calls=[];
  const uncached=src('uncached-mp4',{cached:false,browserContainer:true,containerStatus:'supported'});
  await assert.rejects(resolveAutomaticCachedSource([uncached],{type:'series'},'auto',{prepare:async source=>{calls.push(source.id);return{state:'ready'};}}),error=>error.code==='NO_CACHED_BROWSER_SOURCE'&&!/More Options|Prepare/i.test(error.message));
  assert.deepEqual(calls,[]);
});
test('automatic playback skips a cached source whose real file is AVI',async()=>{
  const first=src('cached-unknown-1',{browserFriendly:false,browserContainer:false,containerStatus:'unknown',size:.5*G});
  const second=src('cached-unknown-2',{browserFriendly:false,browserContainer:false,containerStatus:'unknown',size:.7*G});
  const calls=[],rejected=[];
  const resolved=await resolveAutomaticCachedSource([second,first],{type:'series'},'auto',{onRejected:(source,error)=>rejected.push([source.id,error.code]),prepare:async source=>{
    calls.push(source.id);
    if(source.id==='cached-unknown-1'){const error=new Error('AVI');error.code='BROWSER_CONTAINER_UNSUPPORTED';throw error;}
    return{state:'ready',file:{id:'video'}};
  }});
  assert.deepEqual(calls,['cached-unknown-1','cached-unknown-2']);
  assert.deepEqual(rejected,[['cached-unknown-1','BROWSER_CONTAINER_UNSUPPORTED']]);
  assert.equal(resolved.source.id,'cached-unknown-2');
});
test('automatic playback advances past a stale TorBox cache result',async()=>{
  const first=src('stale',{browserFriendly:true,browserContainer:true,containerStatus:'supported',size:.5*G});
  const second=src('ready',{browserFriendly:true,browserContainer:true,containerStatus:'supported',size:.7*G});
  const calls=[];
  const resolved=await resolveAutomaticCachedSource([second,first],{type:'series'},'auto',{prepare:async source=>{
    calls.push(source.id);
    if(source.id==='stale'){const error=new Error('This source is no longer cached. Use Prepare to request a download.');error.code='TORBOX_OPERATION_FAILED';throw error;}
    return{state:'ready',file:{id:'video'}};
  }});
  assert.deepEqual(calls,['stale','ready']);assert.equal(resolved.source.id,'ready');
  assert.equal(isAutomaticCandidateFailure({code:'TORBOX_OPERATION_FAILED',message:'TorBox is rate limiting requests.'}),false);
});
test('automatic cached checks share one total timeout budget',async()=>{
  const sources=[1,2,3].map(id=>src(`cached-${id}`,{browserFriendly:true,browserContainer:true,containerStatus:'supported',size:id*G/10}));
  let calls=0;const started=Date.now();
  await assert.rejects(resolveAutomaticCachedSource(sources,{type:'series'},'auto',{totalTimeoutMs:30,prepare:async(_source,{signal})=>{calls++;await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}}),error=>error.code==='NO_CACHED_BROWSER_SOURCE');
  assert.ok(Date.now()-started<150);assert.equal(calls,1);
});
test('automatic playback stays bounded and never opens the technical source picker',async()=>{
  const source=await readFile(new URL('../public/discover.js',import.meta.url),'utf8');
  const stop=source.indexOf("if(!waitForPreparation)");
  const poll=source.indexOf('await delay(3500)',stop);
  assert.ok(stop>0&&poll>stop);
  assert.ok(source.includes('unattended:true,waitForPreparation:false'));
  assert.ok(source.includes('unattended?selectAutomaticVideoFile(result.files):result.files[0]'));
  assert.ok(!source.includes("if(e?.code==='NO_CACHED_BROWSER_SOURCE')await openOptions(meta,target,episodeName)"));
  assert.equal(AUTOMATIC_SOURCE_PREPARE_TIMEOUT_MS,8000);
});
test('automatic package selection prefers a browser-playable episode file and rejects all-unsupported choices',()=>{
  const files=[{id:'mkv',title:'Elena.of.Avalor.S02E03.mkv'},{id:'mp4',title:'Elena.of.Avalor.S02E03.mp4'},{id:'avi',title:'Elena.of.Avalor.S02E03.avi'}];
  assert.equal(selectAutomaticVideoFile(files)?.id,'mp4');
  assert.equal(selectAutomaticVideoFile(files.filter(file=>file.id!=='mp4')),null);
});
test('resolution filter supports exact 720/1080 and 4K alias',()=>{
  const list=[src('a',{resolution:'720p'}),src('b',{resolution:'1080p'}),src('c',{resolution:'4K'})];
  assert.deepEqual(filterSourcesByResolution(list,'720p').map(x=>x.id),['a']);
  assert.deepEqual(filterSourcesByResolution(list,'2160p').map(x=>x.id),['c']);
  assert.equal(sourceMatchesResolution(list[1],'1080p'),true);
});
test('episode queue crosses seasons and skips unreleased episodes',()=>{
  const meta={id:'tt1234567',episodes:[{season:1,episode:1},{season:1,episode:2},{season:2,episode:1},{season:2,episode:2,released:'2099-01-01'}]};
  assert.deepEqual(episodeQueue(meta,{type:'series',season:1,episode:1},Date.parse('2026-01-01')).map(e=>[e.season,e.episode]),[[1,2],[2,1]]);
});
test('source size parser handles provider string sizes',()=>{
  assert.equal(parseSizeBytes('1.5 GB'),1500000000); assert.equal(parseSizeBytes('700 MiB'),700*1024**2); assert.equal(parseSizeBytes('bad'),null);
});
test('Zilean release metadata exposes size/quality while absent seeders stay unknown',()=>{
  const [row]=normalizeIndexRows([{info_hash:'a'.repeat(40),imdb_id:'tt1160419',raw_title:'Fixture.720p.WEB-DL',resolution:'720p',quality:'WEB-DL',codec:'H264',audio:['AAC'],size:'850 MB'}],{type:'movie',id:'tt1160419'});
  assert.equal(row.size,850000000); assert.equal(row.releaseQuality,'WEB-DL'); assert.equal(row.seeders,null);
});
test('playback recovery walks strictly down the resolution ladder',()=>{
  assert.deepEqual(lowerResolutionOrder('2160p','auto'),['1080p','720p','480p']);
  assert.deepEqual(lowerResolutionOrder('1080p','auto'),['720p','480p']);
  assert.deepEqual(lowerResolutionOrder('720p','auto'),['480p']);
});
test('playback recovery tries other safe sources after a 480p source fails',()=>{
  const failed=src('failed',{hash:'a'.repeat(40),resolution:'480p'});
  const sameQuality=src('same-quality',{hash:'b'.repeat(40),resolution:'480p'});
  const remaining=src('remaining',{hash:'c'.repeat(40),resolution:'720p'});
  const alreadyTried=src('already-tried',{hash:'d'.repeat(40),resolution:'480p'});
  const risky=src('known-risk',{hash:'e'.repeat(40),resolution:'480p',videoRisk:true});
  const avi=src('known-avi',{hash:'f'.repeat(40),resolution:'480p',browserUnsupported:true});
  const ordered=recoverySourceOrder(
    [failed,remaining,risky,avi,alreadyTried,sameQuality],
    {resolution:'auto',sourceResolution:'480p',sourceInfo:failed,recoveryTried:[sourceRecoveryKey(alreadyTried)]},
    'series'
  );
  assert.deepEqual(ordered.map(source=>source.id),['same-quality','remaining']);
});
test('automatic playback recovery can open at most three sources total',()=>{
  const failed=src('failed',{hash:'a'.repeat(40),resolution:'480p'});
  const candidates=['b','c','d','e','f'].map(letter=>src(letter,{hash:letter.repeat(40),resolution:'480p'}));
  assert.equal(MAX_AUTOMATIC_SOURCE_ATTEMPTS,3);
  assert.deepEqual(boundedRecoverySourceOrder([failed,...candidates],{sourceInfo:failed,resolution:'auto'},'series').map(row=>row.id),['b','c']);
  assert.deepEqual(boundedRecoverySourceOrder([failed,...candidates],{sourceInfo:candidates[1],recoveryTried:[sourceRecoveryKey(failed),sourceRecoveryKey(candidates[0])]},'series'),[]);
});

test('source size profile can favor a smaller data-saver source or a larger quality source',()=>{
  const small=src('small',{resolution:'720p',size:1.2*G}),large=src('large',{resolution:'720p',size:4.8*G,score:80});
  assert.equal(recommendSource([small,large],'movie','auto','data').id,'small');
  assert.equal(recommendSource([small,large],'movie','auto','quality').id,'large');
});
test('memory-blacklisted and known-no-sound sources are not auto-selected',()=>{
  assert.equal(recommendSource([src('bad',{memoryBad:true}),src('good')],'movie','auto').id,'good');
  assert.equal(recommendSource([src('silent',{memoryAudio:'bad'}),src('good')],'movie','auto').id,'good');
});

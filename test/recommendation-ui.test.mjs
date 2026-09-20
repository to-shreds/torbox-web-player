import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendSource, filterSourcesByResolution, episodeQueue, sourceMatchesResolution, lowerResolutionOrder, recoverySourceOrder, sourceRecoveryKey } from '../public/discover.js';
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
  const ordered=recoverySourceOrder(
    [failed,remaining,risky,alreadyTried,sameQuality],
    {resolution:'auto',sourceResolution:'480p',sourceInfo:failed,recoveryTried:[sourceRecoveryKey(alreadyTried)]},
    'series'
  );
  assert.deepEqual(ordered.map(source=>source.id),['same-quality','remaining']);
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

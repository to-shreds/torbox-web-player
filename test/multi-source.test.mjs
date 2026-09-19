import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MultiSourceLookup, StremioSourceLookup, SourceLookupError,
  PUBLIC_STREMIO_PROVIDERS, mergeProviderSources, normalizeStremioStreams
} from '../lib/source-lookup.mjs';

const movie={type:'movie',id:'tt1160419'};
const episode={type:'series',id:'tt0903747',season:1,episode:1};
const hash=n=>n.toString(16).padStart(40,'0');
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
const stremthru=PUBLIC_STREMIO_PROVIDERS.find(x=>x.id==='stremthru');

test('anonymous Stremio adapter uses only its fixed approved endpoint and no credentials',async()=>{
  const s=new StremioSourceLookup({...stremthru,fetchFn:async(url,opts)=>{
    assert.equal(url.origin,'https://stremthru.elfhosted.com');
    assert.ok(url.pathname.includes('/stream/series/tt0903747:1:1.json'));
    assert.deepEqual(opts.headers,{Accept:'application/json'});
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.redirect,'manual');
    return reply({streams:[{infoHash:hash(1),name:'Torz',description:'Show.S01E01.720p.x264.AAC',behaviorHints:{filename:'Show.S01E01.mkv',videoSize:700000000}}]});
  }});
  const result=await s.lookup(episode);
  assert.equal(result.sources.length,1);
  assert.equal(result.sources[0].provider,'StremThru Torz');
});

test('anonymous stream normalizer ignores URL-only streams and parses provider metadata',()=>{
  const rows=normalizeStremioStreams({streams:[
    {url:'https://untrusted.test/file'},
    {infoHash:hash(2),name:'Comet',description:'Movie.1080p.BluRay.x264 👤 1,234',behaviorHints:{filename:'Movie.1080p.mkv',videoSize:2000000000}}
  ]},movie,'Comet');
  assert.equal(rows.length,1);
  assert.equal(rows[0].seeders,1234);
  assert.equal(rows[0].resolution,'1080p');
  assert.equal(rows[0].provider,'Comet');
  assert.ok(!JSON.stringify(rows).includes('untrusted.test'));
});

test('access denial puts a public addon into provider-wide cooldown',async()=>{
  let now=0,calls=0;
  const comet=PUBLIC_STREMIO_PROVIDERS.find(x=>x.id==='comet');
  const s=new StremioSourceLookup({...comet,now:()=>now,fetchFn:async()=>{calls++;return reply({},403);}});
  await assert.rejects(s.lookup(movie),e=>e.code==='SOURCE_ACCESS_DENIED');
  now=1000;
  await assert.rejects(s.lookup(episode),e=>e.code==='SOURCE_PROVIDER_COOLDOWN');
  assert.equal(calls,1);
  assert.ok(s.diagnostics().cooldownMs>0);
});

test('multi lookup does not hit backups when primary already has enough sources',async()=>{
  let backup=0;
  const primary={name:'Primary',lookup:async()=>({sources:Array.from({length:12},(_,i)=>({hash:hash(i+1),title:'A'+i,score:1}))})};
  const secondary={name:'Backup',lookup:async()=>{backup++;return{sources:[{hash:hash(99),title:'B',score:1}]}}};
  const result=await new MultiSourceLookup({providers:[primary,secondary]}).lookup(movie);
  assert.equal(result.sources.length,12);
  assert.equal(backup,0);
  assert.equal(result.fallbackUsed,false);
});

test('empty or failed primary falls through to a backup',async()=>{
  for(const primary of [
    {name:'Empty',lookup:async()=>({sources:[]})},
    {name:'Broken',lookup:async()=>{throw new SourceLookupError('SOURCE_UNAVAILABLE','no');}}
  ]){
    const backup={name:'Backup',lookup:async()=>({sources:[{hash:hash(50),title:'Backup',score:1,provider:'Backup'}]})};
    const result=await new MultiSourceLookup({providers:[primary,backup]}).lookup(movie);
    assert.equal(result.sources.length,1);
    assert.equal(result.sources[0].hash,hash(50));
    assert.equal(result.fallbackUsed,true);
  }
});

test('provider merge deduplicates the same torrent and keeps richer metadata plus provenance',()=>{
  const merged=mergeProviderSources([
    [{hash:hash(1),title:'Basic',score:1,provider:'A',providers:['A'],filename:'',size:null}],
    [{hash:hash(1),title:'Rich',score:2,provider:'B',providers:['B'],filename:'Movie.mkv',size:123,resolution:'720p'}]
  ]);
  assert.equal(merged.length,1);
  assert.equal(merged[0].filename,'Movie.mkv');
  assert.deepEqual(merged[0].providers,['A','B']);
});

test('all provider failures are unavailable rather than a fake empty success',async()=>{
  const providers=['A','B'].map(name=>({name,lookup:async()=>{throw new SourceLookupError('SOURCE_UNAVAILABLE','x')}}));
  await assert.rejects(new MultiSourceLookup({providers}).lookup(movie),e=>e.code==='SOURCE_ALL_UNAVAILABLE');
});

test('all successful empty providers return an honest empty result',async()=>{
  const providers=['A','B'].map(name=>({name,lookup:async()=>({sources:[]})}));
  const result=await new MultiSourceLookup({providers}).lookup(movie);
  assert.deepEqual(result.sources,[]);
  assert.equal(result.providersTried.length,2);
});

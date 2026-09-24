import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MultiSourceLookup, StremioSourceLookup, TorznabSourceLookup, SourceLookupError,
  PUBLIC_STREMIO_PROVIDERS, mergeProviderSources, normalizeStremioStreams, normalizeTorznabXml,
  MEDIAFUSION_TORZNAB_ORIGIN, browserSourceCount
} from '../lib/source-lookup.mjs';

const movie={type:'movie',id:'tt1160419'};
const episode={type:'series',id:'tt0903747',season:1,episode:1};
const hash=n=>n.toString(16).padStart(40,'0');
const reply=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
const stremthru=PUBLIC_STREMIO_PROVIDERS.find(x=>x.id==='stremthru-main');

test('anonymous Stremio adapter uses only its fixed approved endpoint and no credentials',async()=>{
  const s=new StremioSourceLookup({...stremthru,fetchFn:async(url,opts)=>{
    assert.equal(url.origin,'https://stremthru.13377001.xyz');
    assert.ok(url.pathname.includes('/stream/series/tt0903747:1:1.json'));
    assert.deepEqual(opts.headers,{Accept:'application/json'}); assert.equal(opts.credentials,'omit'); assert.equal(opts.redirect,'manual');
    return reply({streams:[{infoHash:hash(1),name:'Torz',description:'Show.S01E01.720p.x264.AAC',behaviorHints:{filename:'Show.S01E01.mkv',videoSize:700000000}}]});
  }});
  const result=await s.lookup(episode); assert.equal(result.sources.length,1); assert.equal(result.sources[0].provider,'StremThru Torz Main');
});

test('anonymous stream normalizer ignores URL-only streams and parses provider metadata',()=>{
  const rows=normalizeStremioStreams({streams:[
    {url:'https://untrusted.test/file'},
    {infoHash:hash(2),name:'Comet',description:'Movie.1080p.BluRay.x264 👤 1,234',behaviorHints:{filename:'Movie.1080p.mkv',videoSize:2000000000}}
  ]},movie,'Comet');
  assert.equal(rows.length,1); assert.equal(rows[0].seeders,1234); assert.equal(rows[0].resolution,'1080p'); assert.ok(!JSON.stringify(rows).includes('untrusted.test'));
});

test('MediaFusion Torznab normalization keeps only hashes and useful metadata',()=>{
  const xml=`<rss><channel>
  <item><title><![CDATA[Movie.720p.WEB-DL.x264.AAC]]></title><size>1800000000</size><torznab:attr name="infohash" value="${hash(3)}"/><torznab:attr name="seeders" value="42"/><torznab:attr name="imdb" value="tt1160419"/></item>
  <item><title>Wrong</title><torznab:attr name="infohash" value="bad"/></item>
  </channel></rss>`;
  const rows=normalizeTorznabXml(xml,movie);
  assert.equal(rows.length,1); assert.equal(rows[0].hash,hash(3)); assert.equal(rows[0].seeders,42); assert.equal(rows[0].size,1800000000); assert.equal(rows[0].resolution,'720p');
});

test('MediaFusion Torznab adapter sends anonymous IMDb/episode metadata query only',async()=>{
  const s=new TorznabSourceLookup({fetchFn:async(url,opts)=>{
    assert.equal(url.origin,new URL(MEDIAFUSION_TORZNAB_ORIGIN).origin); assert.equal(url.pathname,'/torznab');
    assert.equal(url.searchParams.get('t'),'tvsearch'); assert.equal(url.searchParams.get('imdbid'),episode.id);
    assert.equal(url.searchParams.get('season'),'1'); assert.equal(url.searchParams.get('ep'),'1'); assert.equal(url.searchParams.get('limit'),'100');
    assert.equal(opts.credentials,'omit'); assert.ok(!('Authorization' in opts.headers));
    return new Response(`<rss><channel><item><title>Show.S01E01.720p</title><size>700000000</size><torznab:attr name="infohash" value="${hash(4)}"/><torznab:attr name="seeders" value="12"/><torznab:attr name="imdb" value="0903747"/></item></channel></rss>`,{status:200,headers:{'content-type':'application/xml'}});
  }});
  const result=await s.lookup(episode); assert.equal(result.sources.length,1); assert.equal(result.sources[0].provider,'MediaFusion Torznab');
});

test('MediaFusion Torznab requires a matching IMDb identity and accepts its numeric live format',()=>{
  const xml=`<rss><channel>
    <item><title>Correct</title><torznab:attr name="infohash" value="${hash(41)}"/><torznab:attr name="imdb" value="0903747"/></item>
    <item><title>Wrong ID</title><torznab:attr name="infohash" value="${hash(42)}"/><torznab:attr name="imdb" value="1234567"/></item>
    <item><title>Missing ID</title><torznab:attr name="infohash" value="${hash(43)}"/></item>
  </channel></rss>`;
  const rows=normalizeTorznabXml(xml,episode);
  assert.deepEqual(rows.map(row=>row.hash),[hash(41)]);
});

test('multi lookup aggregates two primary indexes in parallel and deduplicates by hash',async()=>{
  const calls=[];
  const a={name:'A',lookup:async()=>{calls.push('A');return{sources:[{hash:hash(1),title:'basic',score:1,provider:'A'}]}}};
  const b={name:'B',lookup:async()=>{calls.push('B');return{sources:[{hash:hash(1),title:'rich',score:2,provider:'B',seeders:50},{hash:hash(2),title:'extra',score:1,provider:'B'}]}}};
  const result=await new MultiSourceLookup({providers:[a,b],primaryCount:2}).lookup(movie);
  assert.deepEqual(new Set(calls),new Set(['A','B'])); assert.equal(result.sources.length,2); assert.equal(result.sources.find(x=>x.hash===hash(1)).seeders,50);
  assert.deepEqual(result.sources.find(x=>x.hash===hash(1)).providers,['A','B']);
});

test('configured fallback providers run concurrently and contribute metadata',async()=>{
  let fallback=0;
  const primaryA={name:'A',lookup:async()=>({sources:Array.from({length:10},(_,i)=>({hash:hash(i+1),title:'A'+i,score:1,provider:'A'}))})};
  const primaryB={name:'B',lookup:async()=>({sources:Array.from({length:5},(_,i)=>({hash:hash(i+11),title:'B'+i,score:1,provider:'B'}))})};
  const backup={name:'Backup',lookup:async()=>{fallback++;return{sources:Array.from({length:10},(_,i)=>({hash:hash(i+16),title:'C'+i,score:1,provider:'Backup'}))}}};
  const result=await new MultiSourceLookup({providers:[primaryA,primaryB,backup],primaryCount:2}).lookup(movie);
  assert.equal(fallback,1); assert.equal(result.sources.length,25); assert.equal(result.fallbackUsed,true);
});

test('an empty concurrent fallback is not reported as used',async()=>{
  let fallback=0;
  const provider=(name,start)=>({name,lookup:async()=>({sources:Array.from({length:10},(_,i)=>({hash:hash(start+i),title:name+i,score:1,provider:name,browserContainer:true}))})});
  const backup={name:'Backup',lookup:async()=>{fallback++;return{sources:[]}}};
  const result=await new MultiSourceLookup({providers:[provider('A',1),provider('B',11),backup],primaryCount:2}).lookup(movie);
  assert.equal(result.sources.length,20); assert.equal(fallback,1); assert.equal(result.fallbackUsed,false);
});

test('twenty unsupported primary results do not hide a playable fallback',async()=>{
  let fallback=0;
  const primary={name:'AVI primary',lookup:async()=>({sources:Array.from({length:20},(_,i)=>({hash:hash(i+1),title:`Show.${i}.avi`,score:-500,provider:'AVI primary',browserUnsupported:true,containerStatus:'unsupported'}))})};
  const backup={name:'MP4 backup',lookup:async()=>{fallback++;return{sources:Array.from({length:3},(_,i)=>({hash:hash(i+30),title:`Show.${i}.mp4`,score:100,provider:'MP4 backup',browserContainer:true,containerStatus:'supported'}))}}};
  const result=await new MultiSourceLookup({providers:[primary,backup],primaryCount:1}).lookup(movie);
  assert.equal(fallback,1);assert.equal(result.fallbackUsed,true);assert.equal(result.sources.filter(source=>source.browserContainer).length,3);
});

test('twenty fast unsupported results wait for a delayed playable fallback',async()=>{
  const primary={name:'AVI primary',lookup:async()=>({sources:Array.from({length:20},(_,i)=>({hash:hash(i+1),title:`Show.${i}.avi`,score:-500,provider:'AVI primary',browserUnsupported:true,containerStatus:'unsupported'}))})};
  const backup={name:'MP4 backup',lookup:async()=>{await new Promise(resolve=>setTimeout(resolve,220));return{sources:[{hash:hash(40),title:'Show.mp4',score:100,provider:'MP4 backup',browserContainer:true,containerStatus:'supported'}]}}};
  const result=await new MultiSourceLookup({providers:[primary,backup],primaryCount:1,timeoutMs:1000}).lookup(movie);
  assert.equal(result.sources.length,21);assert.equal(browserSourceCount(result.sources),1);assert.equal(result.fallbackUsed,true);
});

test('provider merge deduplicates the same torrent and keeps richer metadata plus provenance',()=>{
  const merged=mergeProviderSources([
    [{hash:hash(1),title:'Basic',score:1,provider:'A',providers:['A'],filename:'',size:null}],
    [{hash:hash(1),title:'Rich',score:2,provider:'B',providers:['B'],filename:'Movie.mkv',size:123,resolution:'720p',seeders:99}]
  ]);
  assert.equal(merged.length,1); assert.equal(merged[0].filename,'Movie.mkv'); assert.equal(merged[0].seeders,99); assert.deepEqual(merged[0].providers,['A','B']);
});

test('all provider failures are unavailable rather than a fake empty success',async()=>{
  const providers=['A','B'].map(name=>({name,lookup:async()=>{throw new SourceLookupError('SOURCE_UNAVAILABLE','x')}}));
  await assert.rejects(new MultiSourceLookup({providers,primaryCount:2}).lookup(movie),e=>e.code==='SOURCE_ALL_UNAVAILABLE');
});

test('all successful empty providers return an honest empty result',async()=>{
  const providers=['A','B'].map(name=>({name,lookup:async()=>({sources:[]})}));
  const result=await new MultiSourceLookup({providers,primaryCount:2}).lookup(movie);
  assert.deepEqual(result.sources,[]); assert.equal(result.providersTried.length,2);
});

test('one empty provider plus a stalled provider reports timeout instead of caching an empty result',async()=>{
  const providers=[{name:'Empty',lookup:async()=>({sources:[]})},{name:'Stalled',lookup:async()=>new Promise(()=>{})}];
  await assert.rejects(new MultiSourceLookup({providers,primaryCount:1,timeoutMs:30}).lookup(movie),error=>error.code==='SOURCE_TIMEOUT');
});

test('a stalled provider cannot hold lookup beyond the configured bound',async()=>{
  const fast={name:'Fast',lookup:async()=>({sources:[{hash:hash(1),title:'Movie.mp4',score:10,provider:'Fast',browserContainer:true}]})};
  const stalled={name:'Stalled',lookup:async()=>new Promise(()=>{})};
  const started=Date.now();
  const result=await new MultiSourceLookup({providers:[fast,stalled],primaryCount:1,timeoutMs:30}).lookup(movie);
  assert.ok(Date.now()-started<250);assert.equal(result.sources.length,1);assert.equal(result.providersTried.length,2);
  assert.equal(result.warning,'Some anonymous source indexes were unavailable, but the search completed with the remaining providers.');
});

test('enough browser candidates return after a brief grace without waiting for the hard bound',async()=>{
  const ready={name:'Ready',lookup:async()=>({sources:Array.from({length:20},(_,i)=>({hash:hash(i+1),title:`Movie.${i}.mp4`,score:10,provider:'Ready',browserContainer:true}))})};
  const stalled={name:'Stalled',lookup:async()=>new Promise(()=>{})};
  const started=Date.now();
  const result=await new MultiSourceLookup({providers:[ready,stalled],primaryCount:1,timeoutMs:1000}).lookup(movie);
  assert.ok(Date.now()-started<600);assert.equal(result.sources.length,20);assert.equal(result.providersTried.length,2);
});

test('one browser source plus a second empty success finishes after grace',async()=>{
  const browser={name:'Browser',lookup:async()=>({sources:[{hash:hash(1),title:'Movie.mp4',score:10,provider:'Browser',browserContainer:true}]})};
  const empty={name:'Empty',lookup:async()=>({sources:[]})},stalled={name:'Stalled',lookup:async()=>new Promise(()=>{})};
  const started=Date.now();
  const result=await new MultiSourceLookup({providers:[browser,empty,stalled],primaryCount:2,timeoutMs:1500}).lookup(movie);
  assert.ok(Date.now()-started<800);assert.equal(result.sources.length,1);assert.equal(browserSourceCount(result.sources),1);
});

test('an AVI source plus an empty success still waits for a delayed browser source',async()=>{
  const avi={name:'AVI',lookup:async()=>({sources:[{hash:hash(1),title:'Movie.avi',score:10,provider:'AVI',browserUnsupported:true}]})};
  const empty={name:'Empty',lookup:async()=>({sources:[]})};
  const browser={name:'Browser',lookup:async()=>{await new Promise(resolve=>setTimeout(resolve,350));return{sources:[{hash:hash(2),title:'Movie.mp4',score:10,provider:'Browser',browserContainer:true}]}}};
  const result=await new MultiSourceLookup({providers:[avi,empty,browser],primaryCount:2,timeoutMs:1000}).lookup(movie);
  assert.equal(result.sources.length,2);assert.equal(browserSourceCount(result.sources),1);
});

test('two AVI providers do not hide a delayed browser source',async()=>{
  const avi=(name,id)=>({name,lookup:async()=>({sources:[{hash:hash(id),title:`Movie.${id}.avi`,score:10,provider:name,browserUnsupported:true}]})});
  const browser={name:'Browser',lookup:async()=>{await new Promise(resolve=>setTimeout(resolve,350));return{sources:[{hash:hash(3),title:'Movie.mp4',score:10,provider:'Browser',browserContainer:true}]}}};
  const result=await new MultiSourceLookup({providers:[avi('AVI A',1),avi('AVI B',2),browser],primaryCount:2,timeoutMs:1000}).lookup(movie);
  assert.equal(result.sources.length,3);assert.equal(browserSourceCount(result.sources),1);
});

test('two source-yielding providers with plausible unknown containers finish after grace',async()=>{
  const provider=(name,id)=>({name,lookup:async()=>({sources:[{hash:hash(id),title:`Movie.${id}`,score:10,provider:name}]})});
  const stalled={name:'Stalled',lookup:async()=>new Promise(()=>{})};
  const started=Date.now();
  const result=await new MultiSourceLookup({providers:[provider('A',1),provider('B',2),stalled],primaryCount:2,timeoutMs:1500}).lookup(movie);
  assert.ok(Date.now()-started<800);assert.equal(result.sources.length,2);assert.equal(result.providersTried.length,3);
});

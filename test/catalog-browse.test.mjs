import test from 'node:test';
import assert from 'node:assert/strict';
import { Catalog } from '../lib/catalog.mjs';
const ID='tt1254207';
const ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
test('browse falls back from Popular to Featured without turning search into an error',async()=>{
  const seen=[];
  const c=new Catalog({fetchFn:async url=>{seen.push(url); if(url.includes('/top')) return new Response('no',{status:503}); return ok({metas:[{id:ID,type:'movie',name:'Fixture'}]});}});
  const result=await c.search({type:'movie',feed:'popular'});
  assert.equal(result.feed,'featured'); assert.equal(result.fallback,true); assert.equal(result.metas[0].id,ID); assert.equal(seen.length,2);
});
test('New browse uses the current-year Cinemeta catalog',async()=>{
  let seen='';
  const c=new Catalog({fetchFn:async url=>{seen=url; return ok({metas:[]});}});
  const result=await c.search({type:'series',feed:'new'});
  assert.equal(result.feed,'new'); assert.ok(seen.includes('/catalog/series/year/')); assert.ok(seen.includes('genre='+new Date().getUTCFullYear()));
});
test('browse accepts current Cinemeta imdb_id catalog rows',async()=>{
  const c=new Catalog({fetchFn:async()=>ok({metas:[{imdb_id:ID,type:'movie',name:'Fixture',poster:'https://images.metahub.space/poster/medium/'+ID+'/img'}]})});
  const result=await c.search({type:'movie',feed:'popular'});
  assert.equal(result.metas.length,1);
  assert.equal(result.metas[0].id,ID);
  assert.equal(result.metas[0].name,'Fixture');
});

test('browse follows only the trusted Cinemeta catalogs redirect used by no-query feeds',async()=>{
  const seen=[];
  const c=new Catalog({fetchFn:async(url,opts)=>{
    seen.push({url:String(url),redirect:opts.redirect});
    if(String(url)==='https://v3-cinemeta.strem.io/catalog/movie/top.json') return new Response(null,{status:307,headers:{location:'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json'}});
    if(String(url)==='https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json') return ok({metas:[{imdb_id:ID,type:'movie',name:'Fixture'}]});
    throw new Error('unexpected '+url);
  }});
  const result=await c.search({type:'movie',feed:'popular'});
  assert.equal(result.metas[0].id,ID);
  assert.equal(seen.length,2);
  assert.ok(seen.every(x=>x.redirect==='manual'));
});
test('browse rejects redirects outside the Cinemeta allowlist',async()=>{
  const c=new Catalog({fetchFn:async()=>new Response(null,{status:307,headers:{location:'https://evil.test/catalog.json'}})});
  await assert.rejects(c.search({type:'movie',feed:'popular'}),e=>e.code==='CATALOG_UNAVAILABLE');
});

test('metadata follows the exact Cinemeta live redirect but still rejects other hosts',async()=>{
  const seen=[];
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);seen.push(value);
    if(value===`https://v3-cinemeta.strem.io/meta/movie/${ID}.json`)return new Response(null,{status:307,headers:{location:`https://cinemeta-live.strem.io/meta/movie/${ID}.json`}});
    if(value===`https://cinemeta-live.strem.io/meta/movie/${ID}.json`)return ok({meta:{id:ID,type:'movie',name:'Live Fixture'}});
    throw new Error('unexpected '+value);
  }});
  assert.equal((await c.meta('movie',ID)).name,'Live Fixture');
  assert.deepEqual(seen,[`https://v3-cinemeta.strem.io/meta/movie/${ID}.json`,`https://cinemeta-live.strem.io/meta/movie/${ID}.json`]);
  const blocked=new Catalog({fetchFn:async()=>new Response(null,{status:307,headers:{location:`https://evil.test/meta/movie/${ID}.json`}})});
  await assert.rejects(blocked.meta('movie',ID),error=>error.code==='CATALOG_UNAVAILABLE'&&error.message==='The catalog target was not trusted.');
});

test('server search rejects query-ignoring results and uses the prefixed Cinemeta route',async()=>{
  const junk=[{imdb_id:'tt13210838',type:'series',name:'The Gentlemen'},{imdb_id:'tt14688458',type:'series',name:'Silo'}];
  const seen=[];
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);seen.push(value);
    if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Elena%20of%20Avalor.json')return ok({metas:junk});
    if(value==='https://cinemeta-catalogs.strem.io/top/catalog/series/top/search=Elena%20of%20Avalor.json')return ok({metas:[{imdb_id:'tt4549142',type:'series',name:'Elena of Avalor'}]});
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))return ok({d:[]});
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'series',q:'Elena of Avalor'});
  assert.deepEqual(result.metas.map(row=>row.name),['Elena of Avalor']);
  assert.ok(seen.some(value=>value.includes('cinemeta-catalogs.strem.io')));
});

test('server cross-type search returns movies and shows from one request',async()=>{
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))return ok({d:[]});
    if(value.includes('/catalog/movie/top/search=Shared%20Title.json'))return ok({metas:[{imdb_id:'tt1111111',type:'movie',name:'Shared Title Movie'}]});
    if(value.includes('/catalog/series/top/search=Shared%20Title.json'))return ok({metas:[{imdb_id:'tt2222222',type:'series',name:'Shared Title Series'}]});
    return ok({metas:[]});
  }});
  const result=await c.search({type:'all',q:'Shared Title'});
  assert.deepEqual(new Set(result.metas.map(row=>row.type)),new Set(['movie','series']));
});

test('IMDb suggestion fallback recovers Elena when Cinemeta ignores the query',async()=>{
  const seen=[];
  const junk={metas:[{imdb_id:'tt13210838',type:'series',name:'The Gentlemen'},{imdb_id:'tt14688458',type:'series',name:'Silo'}]};
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);seen.push(value);
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))return ok({d:[{id:'tt4549142',l:'Elena of Avalor',qid:'tvSeries',y:2016}]});
    if(value.includes('/catalog/series/top/search=Elena%20of%20Avalor.json'))return ok(junk);
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'series',q:'Elena of Avalor'});
  assert.equal(result.metas[0]?.id,'tt4549142');
  assert.equal(result.metas[0]?.name,'Elena of Avalor');
  assert.equal(result.metas[0]?.type,'series');
  assert.ok(seen.some(value=>value.includes('v3.sg.media-imdb.com/suggestion/')));
});

test('a fast IMDb suggestion cannot beat a slower relevant Cinemeta search',async()=>{
  let suggestionCalls=0;
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/')){suggestionCalls++;return ok({d:[{id:'tt36271324',l:'Elena Pilot',qid:'video',y:1998}]});}
    if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Elena.json'){
      await new Promise(resolve=>setTimeout(resolve,20));
      return ok({metas:[{imdb_id:'tt4549142',type:'series',name:'Elena of Avalor',releaseInfo:'2016'}]});
    }
    if(value==='https://cinemeta-catalogs.strem.io/top/catalog/series/top/search=Elena.json')return ok({metas:[{imdb_id:'tt13210838',type:'series',name:'The Gentlemen'}]});
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'series',q:'Elena'});
  assert.deepEqual(result.metas.map(row=>row.id),['tt4549142']);
  assert.equal(suggestionCalls,0);
});

test('Family Guy search prunes the empty exact duplicate without metadata delay and the surviving card opens',async()=>{
  const movieId='tt2551566',seriesId='tt0182576';
  let allowMetadata=false,metadataCalls=0;
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))throw new Error('suggestions must not race successful Cinemeta searches');
    if(value==='https://v3-cinemeta.strem.io/catalog/movie/top/search=Family%20Guy.json')return ok({metas:[{id:movieId,type:'movie',name:'Family Guy'}]});
    if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Family%20Guy.json')return ok({metas:[{id:seriesId,type:'series',name:'Family Guy',releaseInfo:'1999-',poster:`https://images.metahub.space/poster/medium/${seriesId}/img`}]});
    if(value.includes('cinemeta-catalogs.strem.io/'))return ok({metas:[{id:'tt13210838',type:value.includes('/movie/')?'movie':'series',name:'Unrelated'}]});
    if(value===`https://v3-cinemeta.strem.io/meta/series/${seriesId}.json`){
      metadataCalls++;if(!allowMetadata)throw new Error('search must not wait for exact-title metadata');
      return ok({meta:{id:seriesId,type:'series',name:'Family Guy',releaseInfo:'1999-',runtime:'22 min',description:'Canonical series',genres:['Animation','Comedy'],poster:`https://images.metahub.space/poster/medium/${seriesId}/img`,videos:[{season:1,episode:1,name:'Death Has a Shadow'}]}});
    }
    if(value.includes('/meta/')){metadataCalls++;throw new Error('the discarded exact duplicate must not be metadata-validated');}
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'all',q:'Family Guy'});
  assert.deepEqual(result.metas.map(row=>[row.id,row.type,row.name]),[[seriesId,'series','Family Guy']]);
  assert.equal(result.metas.filter(row=>row.name==='Family Guy').length,1);
  assert.equal(metadataCalls,0);
  allowMetadata=true;
  const opened=await c.meta(result.metas[0].type,result.metas[0].id);
  assert.equal(metadataCalls,1);
  assert.equal(opened.year,'1999-');
  assert.deepEqual(opened.episodes.map(row=>row.name),['Death Has a Shadow']);
});

test('complete same-title movie and series cards are both retained',async()=>{
  const movieId='tt9000010',seriesId='tt9000011',poster=id=>`https://images.metahub.space/poster/medium/${id}/img`;
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/')||value.includes('/meta/'))throw new Error('complete exact cards need neither fallback nor metadata validation');
    if(value==='https://v3-cinemeta.strem.io/catalog/movie/top/search=Shared%20Name.json')return ok({metas:[{id:movieId,type:'movie',name:'Shared Name',releaseInfo:'1998',poster:poster(movieId)}]});
    if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Shared%20Name.json')return ok({metas:[{id:seriesId,type:'series',name:'Shared Name',releaseInfo:'2024-',poster:poster(seriesId)}]});
    if(value.includes('cinemeta-catalogs.strem.io/'))return ok({metas:[]});
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'all',q:'Shared Name'});
  assert.deepEqual(new Set(result.metas.map(row=>row.id)),new Set([movieId,seriesId]));
});

test('cross-type identity conflicts are corrected through flexible metadata verification',async()=>{
  const shared='tt9000002';
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))throw new Error('suggestions must not run');
    if(value.includes('/catalog/movie/'))return ok({metas:[{id:shared,type:'movie',name:'Recovered Title'}]});
    if(value.includes('/catalog/series/'))return ok({metas:[{id:shared,type:'series',name:'Recovered Title'}]});
    if(value===`https://v3-cinemeta.strem.io/meta/movie/${shared}.json`)return new Response('{}',{status:404,headers:{'content-type':'application/json'}});
    if(value===`https://v3-cinemeta.strem.io/meta/series/${shared}.json`)return ok({meta:{id:shared,type:'series',name:'Recovered Title',videos:[]}});
    throw new Error('unexpected '+value);
  }});
  const result=await c.search({type:'all',q:'Recovered Title'});
  assert.deepEqual(result.metas.map(row=>[row.id,row.type]),[[shared,'series']]);
});

test('IMDb suggestions ignore people and the wrong media type',async()=>{
  const c=new Catalog({fetchFn:async url=>{
    const value=String(url);
    if(value.includes('v3.sg.media-imdb.com/suggestion/'))return ok({d:[
      {id:'nm1234567',l:'Elena Person',qid:'name'},
      {id:'tt1111111',l:'Elena Movie',qid:'movie',y:2020},
      {id:'tt2222222',l:'Elena Series',qid:'tvSeries',y:2021}
    ]});
    return ok({metas:[]});
  }});
  const result=await c.search({type:'series',q:'Elena'});
  assert.deepEqual(result.metas.map(row=>row.id),['tt2222222']);
});

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

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

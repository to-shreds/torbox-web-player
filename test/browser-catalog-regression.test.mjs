import test from 'node:test';
import assert from 'node:assert/strict';
import { directApi } from '../public/direct-runtime.js';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
async function withFetch(fetchFn,run){
  const original=globalThis.fetch;
  globalThis.fetch=fetchFn;
  try{return await run();}finally{globalThis.fetch=original;}
}

test('browser-local Cinemeta routing and cross-type search regressions',async t=>{
  await t.test('browse uses the catalog host with its required catalog-id prefix',async()=>{
    const seen=[];
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value==='https://cinemeta-catalogs.strem.io/top/catalog/movie/top/genre=Action.json')return json({metas:[{id:'tt9000000',type:'movie',name:'Browse Fixture',genres:['Action']}]});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/catalog?type=movie&q=&skip=0&genre=Action&feed=popular'));
    assert.equal(result.metas[0].name,'Browse Fixture');
    assert.deepEqual(seen,['https://cinemeta-catalogs.strem.io/top/catalog/movie/top/genre=Action.json']);
  });

  await t.test('metadata retries v3 after a transient browser fetch failure',async()=>{
    const seen=[];let attempts=0;
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value!=='https://v3-cinemeta.strem.io/meta/movie/tt9000001.json')throw new Error('unexpected '+value);
      attempts++;
      if(attempts===1)throw new TypeError('transient');
      return json({meta:{id:'tt9000001',type:'movie',name:'Retry Fixture'}});
    },()=>directApi('/api/discover/meta?type=movie&id=tt9000001'));
    assert.equal(result.meta.name,'Retry Fixture');
    assert.equal(attempts,2);
    assert.equal(seen.every(value=>value.startsWith('https://v3-cinemeta.strem.io/meta/')),true);
  });

  await t.test('a misclassified result recovers the opposite title type after a 404',async()=>{
    const seen=[];
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value==='https://v3-cinemeta.strem.io/meta/movie/tt9000002.json')return json({},404);
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt9000002.json')return json({meta:{id:'tt9000002',type:'series',name:'Recovered Show',videos:[]}});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/meta?type=movie&id=tt9000002'));
    assert.equal(result.meta.type,'series');
    assert.deepEqual(seen,['https://v3-cinemeta.strem.io/meta/movie/tt9000002.json','https://v3-cinemeta.strem.io/meta/series/tt9000002.json']);
  });

  await t.test('Family Guy style search queries movies and series and keeps the verified series identity',async()=>{
    const seen=[];
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value==='https://v3-cinemeta.strem.io/catalog/movie/top/search=Family%20Guy.json')return json({metas:[{id:'tt0182576',name:'Family Guy'},{id:'tt9000003',type:'movie',name:'Family Guy Plush: Peter Is Afraid',year:'2024'}]});
      if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Family%20Guy.json')return json({metas:[{id:'tt0182576',type:'series',name:'Family Guy',poster:'https://images.metahub.space/poster/medium/tt0182576/img'}]});
      if(value==='https://v3-cinemeta.strem.io/meta/movie/tt0182576.json')return json({},404);
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt0182576.json')return json({meta:{id:'tt0182576',type:'series',name:'Family Guy',poster:'https://images.metahub.space/poster/medium/tt0182576/img',videos:[]}});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/catalog?type=all&q=Family%20Guy&skip=0&genre=&feed=popular'));
    const family=result.metas.find(meta=>meta.id==='tt0182576');
    assert.equal(family?.type,'series');
    assert.ok(family?.poster);
    assert.equal(result.metas.some(meta=>meta.id==='tt9000003'&&meta.type==='movie'),true);
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/catalog/movie/top/search=Family%20Guy.json'),true);
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/catalog/series/top/search=Family%20Guy.json'),true);
  });
});

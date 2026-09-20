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
    assert.equal(seen.includes('https://cinemeta-live.strem.io/meta/movie/tt9000001.json'),true);
    assert.equal(seen.filter(value=>value==='https://v3-cinemeta.strem.io/meta/movie/tt9000001.json').length,2);
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
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/meta/movie/tt9000002.json'),true);
    assert.equal(seen.includes('https://cinemeta-live.strem.io/meta/movie/tt9000002.json'),true);
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/meta/series/tt9000002.json'),true);
  });

  await t.test('metadata falls back through the Cloudflare catalog relay when browser-direct hosts fail',async()=>{
    const result=await withFetch(async url=>{
      const value=String(url);
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt9000004.json'||value==='https://cinemeta-live.strem.io/meta/series/tt9000004.json')throw new TypeError('browser blocked');
      if(value==='./relay-config.json')return json({primary:'https://torbox-web-player-key.onrender.com',secondary:'https://torbox-web-player-relay.jonathanjablon.workers.dev'});
      if(value.startsWith('https://torbox-web-player-relay.jonathanjablon.workers.dev/relay/cinemeta?'))return json({meta:{id:'tt9000004',type:'series',name:'Relay Fixture',videos:[]}});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/meta?type=series&id=tt9000004'));
    assert.equal(result.meta.name,'Relay Fixture');
  });

  await t.test('Elena of Avalor search rejects a bogus Popular response and uses the real search fallback',async()=>{
    const seen=[];
    const junk=[
      {id:'tt13210838',type:'series',name:'The Gentlemen',year:'2024'},
      {id:'tt14688458',type:'series',name:'Silo',year:'2023'},
      {id:'tt31122777',type:'series',name:'Lanterns',year:'2026'},
      {id:'tt9288030',type:'series',name:'Reacher',year:'2022'},
      {id:'tt10986410',type:'series',name:'Ted Lasso',year:'2020'},
      {id:'tt13111040',type:'series',name:'Lioness',year:'2023'}
    ];
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value==='https://v3-cinemeta.strem.io/catalog/movie/top/search=Elena%20of%20avalor.json')return json({metas:junk.map(row=>({...row,type:'movie'}))});
      if(value==='https://cinemeta-catalogs.strem.io/top/catalog/movie/top/search=Elena%20of%20avalor.json')return json({metas:[]});
      if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Elena%20of%20avalor.json')return json({metas:junk});
      if(value==='https://cinemeta-catalogs.strem.io/top/catalog/series/top/search=Elena%20of%20avalor.json')return json({metas:[{id:'tt4549142',type:'series',name:'Elena of Avalor',year:'2016',poster:'https://images.metahub.space/poster/medium/tt4549142/img'}]});
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt4549142.json')return json({meta:{id:'tt4549142',type:'series',name:'Elena of Avalor',releaseInfo:'2016–2020',poster:'https://images.metahub.space/poster/medium/tt4549142/img',videos:[]}});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/catalog?type=all&q=Elena%20of%20avalor&skip=0&genre=&feed=popular'));
    assert.equal(result.metas[0]?.name,'Elena of Avalor');
    assert.equal(result.metas.some(meta=>junk.some(row=>row.name===meta.name)),false);
    assert.equal(seen.includes('https://cinemeta-catalogs.strem.io/top/catalog/series/top/search=Elena%20of%20avalor.json'),true);
  });

  await t.test('search never displays an unrelated Popular catalog when every search origin ignores the query',async()=>{
    const junk=[{id:'tt13210838',type:'series',name:'The Gentlemen',year:'2024'},{id:'tt14688458',type:'series',name:'Silo',year:'2023'}];
    const result=await withFetch(async url=>{
      const value=String(url);
      if(value==='./relay-config.json')return json({primary:'',secondary:''});
      if(value.includes('/catalog/movie/'))return json({metas:junk.map(row=>({...row,type:'movie'}))});
      if(value.includes('/catalog/series/'))return json({metas:junk});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/catalog?type=all&q=Elena%20of%20avalor&skip=0&genre=&feed=popular'));
    assert.deepEqual(result.metas,[]);
  });

  await t.test('Family Guy style search queries movies and series and keeps the verified series identity',async()=>{
    const seen=[];
    const result=await withFetch(async url=>{
      const value=String(url);seen.push(value);
      if(value==='https://v3-cinemeta.strem.io/catalog/movie/top/search=Family%20Guy.json')return json({metas:[{id:'tt9000005',type:'movie',name:'Family Guy'},{id:'tt9000003',type:'movie',name:'Family Guy Plush: Peter Is Afraid',year:'2024'}]});
      if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Family%20Guy.json')return json({metas:[{id:'tt0182576',type:'series',name:'Family Guy',poster:'https://images.metahub.space/poster/medium/tt0182576/img'}]});
      if(value==='https://v3-cinemeta.strem.io/meta/movie/tt9000005.json'||value==='https://cinemeta-live.strem.io/meta/movie/tt9000005.json')return json({},404);
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt9000005.json'||value==='https://cinemeta-live.strem.io/meta/series/tt9000005.json')return json({},404);
      if(value==='https://v3-cinemeta.strem.io/meta/series/tt0182576.json')return json({meta:{id:'tt0182576',type:'series',name:'Family Guy',poster:'https://images.metahub.space/poster/medium/tt0182576/img',videos:[]}});
      throw new Error('unexpected '+value);
    },()=>directApi('/api/discover/catalog?type=all&q=Family%20Guy&skip=0&genre=&feed=popular'));
    const family=result.metas.find(meta=>meta.id==='tt0182576');
    assert.equal(family?.type,'series');
    assert.ok(family?.poster);
    assert.equal(result.metas.filter(meta=>meta.name==='Family Guy').length,1);
    assert.equal(result.metas.some(meta=>meta.id==='tt9000005'),false);
    assert.equal(result.metas.some(meta=>meta.id==='tt9000003'&&meta.type==='movie'),true);
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/catalog/movie/top/search=Family%20Guy.json'),true);
    assert.equal(seen.includes('https://v3-cinemeta.strem.io/catalog/series/top/search=Family%20Guy.json'),true);
  });
});

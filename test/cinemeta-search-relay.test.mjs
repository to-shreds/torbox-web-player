import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/cloudflare/worker.js';

const PAGE='https://to-shreds.github.io';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('Cloudflare Cinemeta search ignores unrelated Popular payloads and tries the prefixed fallback',async()=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async input=>{
    const value=String(input);seen.push(value);
    if(value==='https://v3-cinemeta.strem.io/catalog/series/top/search=Elena%20of%20avalor.json')return json({metas:[
      {id:'tt13210838',type:'series',name:'The Gentlemen'},
      {id:'tt14688458',type:'series',name:'Silo'},
      {id:'tt9288030',type:'series',name:'Reacher'}
    ]});
    if(value==='https://cinemeta-catalogs.strem.io/top/catalog/series/top/search=Elena%20of%20avalor.json')return json({metas:[
      {id:'tt4549142',type:'series',name:'Elena of Avalor'}
    ]});
    throw new Error('unexpected '+value);
  };
  try{
    const path='/catalog/series/top/search=Elena%20of%20avalor.json';
    const response=await worker.fetch(new Request('https://worker.invalid/relay/cinemeta?path='+encodeURIComponent(path),{headers:{Origin:PAGE}}));
    assert.equal(response.status,200);
    const data=await response.json();
    assert.deepEqual(data.metas.map(row=>row.name),['Elena of Avalor']);
    assert.ok(seen.some(value=>value.includes('cinemeta-catalogs.strem.io')));
  }finally{globalThis.fetch=original;}
});

test('Cloudflare Cinemeta search returns an empty result instead of unrelated browse cards',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>json({metas:[{id:'tt13210838',type:'series',name:'The Gentlemen'}]});
  try{
    const path='/catalog/series/top/search=Elena%20of%20avalor.json';
    const response=await worker.fetch(new Request('https://worker.invalid/relay/cinemeta?path='+encodeURIComponent(path),{headers:{Origin:PAGE}}));
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).metas,[]);
  }finally{globalThis.fetch=original;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const page='https://to-shreds.github.io';
const goodKey='tb-fixture-api-key-123456';
function fakeProvider(key){return{key,account:async()=>{if(key!==goodKey){const e=new Error('denied');e.code='TORBOX_ACCESS_DENIED';e.status=502;throw e;}return{valid:true};},list:async()=>({files:[],stale:false}),resolveForRelay:async videoId=>({upstreamUrl:'https://store.tb-cdn.io/file',file:{id:videoId}}),request:async()=>[]};}
async function fixture(t){
  const app=createApp({env:{AUTH_MODE:'api-key',PUBLIC_ORIGIN:'https://torbox-web-player-key.onrender.com',FRONTEND_ORIGINS:page,NODE_ENV:'production'},providerFactory:fakeProvider});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=(path,{method='GET',data,token,origin=page}={})=>fetch(base+path,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
  return{...app,call};
}
const lookup='a'.repeat(64);
const envelope={version:1,salt:'A'.repeat(22),iv:'B'.repeat(16),data:'C'.repeat(64)};

test('setup transfers require an authenticated creator and are one-time public redemptions',async t=>{
  const {call}=await fixture(t);
  assert.equal((await call('/api/setup-transfer',{method:'POST',data:{lookup,envelope}})).status,401);
  const login=await (await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).json();
  const created=await call('/api/setup-transfer',{method:'POST',token:login.sessionToken,data:{lookup,envelope}});
  assert.equal(created.status,200);assert.ok((await created.json()).expiresAt);
  const first=await call('/api/setup-transfer?id='+lookup);assert.equal(first.status,200);assert.deepEqual((await first.json()).envelope,envelope);
  assert.equal((await call('/api/setup-transfer?id='+lookup)).status,404);
});

test('setup transfer endpoint rejects malformed encrypted envelopes',async t=>{
  const {call}=await fixture(t);const login=await (await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).json();
  assert.equal((await call('/api/setup-transfer',{method:'POST',token:login.sessionToken,data:{lookup:'bad',envelope:{version:1}}})).status,400);
});

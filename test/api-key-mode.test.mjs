import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const page='https://to-shreds.github.io';
const goodKey='tb-fixture-api-key-123456';
function fakeProvider(key) {
  return {
    key,
    account: async () => {
      if (key !== goodKey) { const e=new Error('denied'); e.code='TORBOX_ACCESS_DENIED'; e.status=502; throw e; }
      return { valid:true, planCode:'fixture' };
    },
    list: async () => ({ files: [], stale:false }),
    resolveForRelay: async videoId => ({ upstreamUrl:`https://store.tb-cdn.io/file?token=${key}`, file:{id:videoId} }),
    request: async () => []
  };
}
async function fixture(t) {
  const mediaRequests=[];
  const app=createApp({
    env:{AUTH_MODE:'api-key',PUBLIC_ORIGIN:'https://torbox-web-player-key.onrender.com',FRONTEND_ORIGINS:page,NODE_ENV:'production'},
    providerFactory:fakeProvider,
    mediaFetch:async(url,options={})=>{mediaRequests.push({url:String(url),range:options.headers?.Range||''});return new Response(Buffer.from('R'),{status:options.headers?.Range?206:200,headers:{'content-type':'video/mp4','content-length':'1','accept-ranges':'bytes',...(options.headers?.Range?{'content-range':'bytes 0-0/100'}:{})}});}
  });
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=(path,{method='GET',data,token,origin=page}={})=>fetch(base+path,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});
  return {...app,call,mediaRequests};
}
test('clone requires no Render-stored household password or TorBox key', async t=>{
  const {call}=await fixture(t); const s=await (await call('/api/session')).json();
  assert.equal(s.setupRequired,false); assert.equal(s.authMode,'api-key'); assert.equal(s.authenticated,false);
});
test('TorBox API key is the login credential and a wrong key is rejected', async t=>{
  const {call}=await fixture(t);
  assert.notEqual((await call('/api/login',{method:'POST',data:{apiKey:'wrong-key'}})).status,200);
  const r=await call('/api/login',{method:'POST',data:{apiKey:goodKey}}); assert.equal(r.status,200);
  const body=await r.json(); assert.match(body.sessionToken,/^[A-Za-z0-9_-]{43}$/); assert.equal(body.authMode,'api-key');
});
test('validated key stays in server process session and is not returned by normal API calls', async t=>{
  const {call}=await fixture(t); const login=await (await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).json();
  const r=await call('/api/library',{token:login.sessionToken}); assert.equal(r.status,200);
  assert.ok(!(await r.text()).includes(goodKey));
});
test('API-key playback returns an opaque ticket and relays byte ranges without browser credentials', async t=>{
  const {call,mediaRequests}=await fixture(t); const login=await (await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).json();
  const p=await (await call('/api/playback',{method:'POST',token:login.sessionToken,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();
  assert.equal(p.delivery,'relay'); assert.equal(p.exposesTorBoxToken,false);assert.match(p.mediaUrl,/^\/media\/[A-Za-z0-9_-]{43}$/);assert.ok(!JSON.stringify(p).includes(goodKey));
  const media=await call(p.mediaUrl,{origin:page});assert.equal(media.status,200);assert.equal(await media.text(),'R');assert.ok(mediaRequests[0].url.includes(goodKey));
});
test('logout clears API access for the in-memory key session', async t=>{
  const {call}=await fixture(t); const login=await (await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).json();
  const playback=await (await call('/api/playback',{method:'POST',token:login.sessionToken,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).json();
  assert.equal((await call('/api/logout',{method:'POST',token:login.sessionToken,data:{}})).status,200);
  assert.equal((await call('/api/library',{token:login.sessionToken})).status,401);
  assert.equal((await call(playback.mediaUrl)).status,401);
});

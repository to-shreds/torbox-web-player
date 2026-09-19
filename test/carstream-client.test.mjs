import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.mjs';
const goodKey='carstream-fixture-key-only',page='https://to-shreds.github.io';
async function fixture(t,extra={}) {
  const app=createApp({env:{AUTH_MODE:'api-key',CARSTREAM_CLIENT_ENABLED:'true',PUBLIC_ORIGIN:'https://torbox-web-player-key.onrender.com',FRONTEND_ORIGINS:page,...extra},providerFactory:key=>({key,account:async()=>{if(key!==goodKey)throw new Error('fixture denied');return {valid:true};},resolveForRelay:async id=>({upstreamUrl:'https://store.tb-cdn.io/movie?token=phone-only',file:{id}})})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const call=(path,{method='GET',data,token,headers={},phone=true}={})=>new Promise((resolve,reject)=>{
    const raw=data===undefined?null:JSON.stringify(data);const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path,method,headers:{...(phone?{'X-CarStream-Client':'2'}:{}),...(token?{Authorization:`Bearer ${token}`}:{ }),...(raw?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}:{}),...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,text,data:JSON.parse(text)});});});req.on('error',reject);req.end(raw);
  });
  const login=async()=>{const response=await call('/api/carstream/login',{method:'POST',data:{apiKey:goodKey}});assert.equal(response.status,200,response.text);return response.data.sessionToken;};
  return {...app,call,login};
}
test('native client path is explicitly disabled unless enabled in API-key mode',async t=>{
  const {call}=await fixture(t,{CARSTREAM_CLIENT_ENABLED:'false'});assert.equal((await call('/api/carstream/login',{method:'POST',data:{apiKey:goodKey}})).status,404);
});
test('native login validates the key and yields a scoped bearer, not a cookie or echoed key',async t=>{
  const {call}=await fixture(t);assert.notEqual((await call('/api/carstream/login',{method:'POST',data:{apiKey:'wrong-fixture'}})).status,200);
  const r=await call('/api/carstream/login',{method:'POST',data:{apiKey:goodKey}});assert.equal(r.status,200);assert.match(r.data.sessionToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(r.data.client,'carstream');assert.equal(r.headers['set-cookie'],undefined);assert.ok(!r.text.includes(goodKey));
});
test('native route rejects real and spoofed browser origins, browser metadata and missing client version',async t=>{
  const {call}=await fixture(t);for(const headers of [{Origin:page},{Origin:'https://evil.test'},{Origin:'null'},{Origin:''},{'Sec-Fetch-Mode':'cors'},{'Sec-Fetch-Site':'none'},{'X-CarStream-Client':'1'}]){
    const r=await call('/api/carstream/login',{method:'POST',data:{apiKey:goodKey},headers});assert.equal(r.status,403,JSON.stringify(headers));assert.equal(r.headers['access-control-allow-origin'],undefined);
  }
  assert.equal((await call('/api/carstream/login',{method:'POST',data:{apiKey:goodKey},phone:false})).status,403);
});
test('normal browser mutation protection is not relaxed for phones',async t=>{
  const {call}=await fixture(t);assert.equal((await call('/api/login',{method:'POST',data:{apiKey:goodKey}})).status,403);
  assert.equal((await call('/api/login',{method:'POST',data:{apiKey:goodKey},headers:{Origin:page},phone:false})).status,200);
});
test('phone and browser bearer sessions cannot cross client boundaries',async t=>{
  const {call,login}=await fixture(t);const phone=await login();assert.equal((await call('/api/session',{token:phone,headers:{Origin:page},phone:false})).status,403);
  const browser=(await call('/api/login',{method:'POST',data:{apiKey:goodKey},headers:{Origin:page},phone:false})).data.sessionToken;
  assert.equal((await call('/api/carstream/session',{token:browser})).status,403);
});
test('native authenticated requests ignore cookies and require bearer authorization',async t=>{
  const {call,login}=await fixture(t);const token=await login();const cookie=await call('/api/carstream/session',{headers:{Cookie:`tw_session=${token}`}});assert.equal(cookie.data.authenticated,false);
  assert.equal((await call('/api/carstream/playback',{method:'POST',data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).status,401);
});
test('native phone receives the existing playback contract and logout revokes access',async t=>{
  const {call,login}=await fixture(t);const token=await login();const play=await call('/api/carstream/playback',{method:'POST',token,data:{viewer:'viewer-1',videoId:'torrents:1:0'}});
  assert.equal(play.status,200,play.text);assert.equal(play.data.file.id,'torrents:1:0');assert.equal(play.data.mediaUrl,'https://store.tb-cdn.io/movie?token=phone-only');assert.ok(play.data.leaseId);
  assert.equal((await call('/api/carstream/logout',{method:'POST',token,data:{}})).status,200);assert.equal((await call('/api/carstream/session',{token})).data.authenticated,false);
});
test('native endpoint is not a general backend, Drive, owner or arbitrary URL proxy',async t=>{
  const {call,login}=await fixture(t);const token=await login();for(const path of ['library','drive/config','owner/diagnostics','share/create','guest/accept','proxy?url=https://evil.test'])assert.equal((await call('/api/carstream/'+path,{token})).status,404,path);
  assert.equal((await call('/api/carstream/playback',{method:'DELETE',token})).status,404);
});
test('native progress leases are isolated from browser viewers and other phones',async t=>{
  const {call,login,progress}=await fixture(t);const first=await login(),second=await login();
  for(const token of [first,second])assert.equal((await call('/api/carstream/playback',{method:'POST',token,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).status,200);
  const a=(await call('/api/carstream/playback',{method:'POST',token:first,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).data;
  assert.equal((await call('/api/carstream/progress',{method:'PUT',token:second,data:{viewer:'viewer-1',videoId:'torrents:1:0',leaseId:a.leaseId,seq:1,position:10,duration:100}})).data.saved,false);
});

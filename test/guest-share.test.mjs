import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { GuestInvites } from '../lib/auth.mjs';

const page='https://to-shreds.github.io';
const key='tb-fixture-api-key-123456';
const show='tt0182576';

const metadata = (type,id) => ({
  meta: {
    id, type, name: id===show?'Family Guy':'Other',
    poster:'https://images.metahub.space/poster/medium/'+id+'/img',
    videos:type==='series'?[{id:id+':1:1',season:1,episode:1,name:'Pilot'}]:[]
  }
});
function fakeProvider(value){
  return {
    key:value,
    account:async()=>{if(value!==key) throw Object.assign(new Error('denied'),{code:'TORBOX_ACCESS_DENIED',status:502}); return {valid:true};},
    list:async()=>({files:[],stale:false}),
    resolveForRelay:async videoId=>({upstreamUrl:'https://store.tb-cdn.io/file?token='+value,file:{id:videoId}}),
    resolve:async videoId=>({url:'https://store.tb-cdn.io/file?token=temporary-file-token',file:{id:videoId}}),
    resolveGuest:async videoId=>({url:'https://store.tb-cdn.io/file?token=temporary-file-token',file:{id:videoId}}),
    request:async()=>[]
  };
}
async function fixture(t){
  const mediaRequests=[];
  const discoveryFetch=async url=>{
    const u=new URL(url);
    if(u.hostname==='v3-cinemeta.strem.io'&&u.pathname.includes('/meta/')){
      const parts=u.pathname.split('/'); const type=parts[2],id=parts[3].replace('.json','');
      return new Response(JSON.stringify(metadata(type,id)),{status:200,headers:{'content-type':'application/json'}});
    }
    throw new Error('unexpected external request '+url);
  };
  const sourceLookupService={lookup:async()=>({sources:[],provider:'fixture'}),diagnostics:()=>[]};
  const app=createApp({
    env:{AUTH_MODE:'api-key',SOURCE_PROVIDER:'multi',PUBLIC_ORIGIN:'https://torbox-web-player-key.onrender.com',FRONTEND_ORIGINS:page,NODE_ENV:'production'},
    providerFactory:fakeProvider,discoveryFetch,sourceLookupService,
    mediaFetch:async url=>{mediaRequests.push(String(url));return new Response(Buffer.from('G'),{status:200,headers:{'content-type':'video/mp4','content-length':'1','accept-ranges':'bytes'}});}
  });
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=(path,{method='GET',data,token,origin=page}={})=>fetch(base+path,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
  return {...app,call,mediaRequests};
}
async function owner(call){
  const r=await call('/api/login',{method:'POST',data:{apiKey:key}}); assert.equal(r.status,200); return (await r.json()).sessionToken;
}

test('temporary invite token expires and is stored hashed',()=>{
  let now=0; const invites=new GuestInvites(()=>now);
  const created=invites.create({ownerId:'owner-digest',scope:{type:'series',id:show},ttlMs:3600000});
  assert.match(created.token,/^[A-Za-z0-9_-]{43}$/); assert.ok(!invites.rows.has(created.token));
  assert.equal(invites.read(created.token).scope.id,show); now=3600001; assert.equal(invites.read(created.token),null);
});

test('owner can create a title-scoped temporary guest session without exposing TorBox key',async t=>{
  const {call}=await fixture(t),ownerToken=await owner(call);
  const share=await call('/api/share/create',{method:'POST',token:ownerToken,data:{type:'series',id:show,hours:6}});
  assert.equal(share.status,200); const invite=await share.json(); assert.match(invite.token,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(invite).includes(key));

  const accepted=await call('/api/guest/accept',{method:'POST',data:{token:invite.token}});
  assert.equal(accepted.status,200); const guest=await accepted.json(); assert.equal(guest.guest,true); assert.equal(guest.scope.id,show);
  assert.ok(!JSON.stringify(guest).includes(key));

  const session=await (await call('/api/session',{token:guest.sessionToken})).json();
  assert.equal(session.authenticated,true); assert.equal(session.guest,true); assert.equal(session.scope.id,show);
  assert.equal((await call('/api/discover/meta?type=series&id='+show,{token:guest.sessionToken})).status,200);
});

test('guest is blocked from browsing, owner tools, library, other titles and arbitrary playback ids',async t=>{
  const {call}=await fixture(t),ownerToken=await owner(call);
  const invite=await (await call('/api/share/create',{method:'POST',token:ownerToken,data:{type:'series',id:show,hours:2}})).json();
  const guest=(await (await call('/api/guest/accept',{method:'POST',data:{token:invite.token}})).json()).sessionToken;
  assert.equal((await call('/api/discover/catalog?type=series',{token:guest})).status,403);
  assert.equal((await call('/api/library',{token:guest})).status,403);
  assert.equal((await call('/api/discover/meta?type=series&id=tt9999999',{token:guest})).status,403);
  assert.equal((await call('/api/share/create',{method:'POST',token:guest,data:{type:'series',id:show,hours:2}})).status,403);
  assert.equal((await call('/api/owner/unlock',{method:'POST',token:guest,data:{apiKey:key}})).status,403);
  assert.equal((await call('/api/playback',{method:'POST',token:guest,data:{viewer:'viewer-1',videoId:'torrents:1:0'}})).status,403);
});

test('owner sign-out invalidates existing guest sessions and invitation links',async t=>{
  const {call}=await fixture(t),ownerToken=await owner(call);
  const invite=await (await call('/api/share/create',{method:'POST',token:ownerToken,data:{type:'series',id:show,hours:6}})).json();
  const guest=(await (await call('/api/guest/accept',{method:'POST',data:{token:invite.token}})).json()).sessionToken;
  assert.equal((await call('/api/logout',{method:'POST',token:ownerToken,data:{}})).status,200);
  assert.equal((await call('/api/library',{token:guest})).status,401);
  assert.equal((await call('/api/guest/accept',{method:'POST',data:{token:invite.token}})).status,401);
});

test('guest playback uses an opaque relay ticket and never exposes the owner key',async t=>{
  const {call,sessions,mediaRequests}=await fixture(t),ownerToken=await owner(call);
  const invite=await (await call('/api/share/create',{method:'POST',token:ownerToken,data:{type:'series',id:show,hours:2}})).json();
  const accepted=await (await call('/api/guest/accept',{method:'POST',data:{token:invite.token}})).json();
  const row=sessions.read(accepted.sessionToken),videoId='torrents:7:3'; row.allowedVideos.add(videoId);
  const playback=await call('/api/playback',{method:'POST',token:accepted.sessionToken,data:{viewer:'viewer-1',videoId}});
  assert.equal(playback.status,200); const body=await playback.json();
  assert.equal(body.guestSafeLink,true);assert.equal(body.delivery,'relay');assert.match(body.mediaUrl,/^\/media\/[A-Za-z0-9_-]{43}$/);assert.ok(!JSON.stringify(body).includes(key));
  const media=await call(body.mediaUrl);assert.equal(media.status,200);assert.equal(await media.text(),'G');assert.ok(mediaRequests[0].includes(key));
});

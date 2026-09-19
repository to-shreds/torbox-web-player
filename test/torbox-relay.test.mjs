import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

const PAGE='https://to-shreds.github.io';
const KEY='fixture-torbox-key-123456';

async function fixture(t){
  const seen=[];
  const discoveryFetch=async(url,options={})=>{
    const u=new URL(String(url));
    seen.push({url:u.href,method:options.method||'GET',authorization:options.headers?.Authorization||'',body:options.body});
    if(u.pathname.endsWith('/user/me'))return new Response(JSON.stringify({success:true,data:{plan:2}}),{status:200,headers:{'content-type':'application/json'}});
    if(u.pathname.endsWith('/torrents/checkcached'))return new Response(JSON.stringify({success:true,data:{}}),{status:200,headers:{'content-type':'application/json'}});
    if(u.pathname.endsWith('/torrents/mylist'))return new Response(JSON.stringify({success:true,data:[]}),{status:200,headers:{'content-type':'application/json'}});
    if(u.pathname.endsWith('/torrents/createtorrent'))return new Response(JSON.stringify({success:true,data:{torrent_id:42}}),{status:200,headers:{'content-type':'application/json'}});
    if(u.pathname.endsWith('/torrents/requestdl'))return new Response(JSON.stringify({success:true,data:'https://store.tb-cdn.io/file'}),{status:200,headers:{'content-type':'application/json'}});
    return new Response('missing',{status:404});
  };
  const app=createApp({env:{AUTH_MODE:'api-key',PUBLIC_ORIGIN:'https://torbox-web-player-key.onrender.com',FRONTEND_ORIGINS:PAGE,NODE_ENV:'production'},discoveryFetch});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.server.closeAllConnections();app.server.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=(path,{method='GET',data,key=KEY,origin=PAGE}={})=>fetch(base+path,{
    method,
    headers:{Origin:origin,...(key?{Authorization:'Bearer '+key}:{}),...(data?{'Content-Type':'application/json'}:{})},
    body:data?JSON.stringify(data):undefined
  });
  return{call,seen};
}

test('stateless Render relay exposes health and forwards allowlisted TorBox reads without a player session',async t=>{
  const {call,seen}=await fixture(t);
  const health=await call('/relay/health',{key:''});
  assert.equal(health.status,200);
  assert.equal(health.headers.get('x-torbox-bridge'),'render');

  const response=await call('/relay/torbox/user/me?settings=false');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-torbox-bridge'),'render');
  assert.equal(response.headers.get('access-control-allow-origin'),PAGE);
  assert.equal(response.headers.get('access-control-expose-headers').includes('X-TorBox-Bridge'),true);
  assert.equal((await response.json()).success,true);
  assert.equal(seen.at(-1).authorization,'Bearer '+KEY);
  assert.match(seen.at(-1).url,/\/v1\/api\/user\/me\?settings=false$/);
});

test('relay rejects unapproved origins, missing credentials, routes, and query keys',async t=>{
  const {call}=await fixture(t);
  assert.equal((await call('/relay/torbox/user/me?settings=false',{origin:'https://evil.example'})).status,403);
  assert.equal((await call('/relay/torbox/user/me?settings=false',{key:''})).status,401);
  assert.equal((await call('/relay/torbox/user/delete')).status,404);
  assert.equal((await call('/relay/torbox/torrents/mylist?token=secret')).status,400);
});

test('relay constructs create-torrent form from a bounded hash-only JSON request',async t=>{
  const {call,seen}=await fixture(t);
  const hash='a'.repeat(40);
  const response=await call('/relay/torbox/torrents/createtorrent',{method:'POST',data:{hash,onlyCached:true}});
  assert.equal(response.status,200);
  const last=seen.at(-1);
  assert.equal(last.method,'POST');
  assert.equal(last.authorization,'Bearer '+KEY);
  assert.ok(last.body instanceof FormData);
  assert.equal(last.body.get('magnet'),'magnet:?xt=urn:btih:'+hash);
  assert.equal(last.body.get('allow_zip'),'false');
  assert.equal(last.body.get('add_only_if_cached'),'true');
});

test('requestdl relay injects the API key only into the upstream TorBox token query',async t=>{
  const {call,seen}=await fixture(t);
  const response=await call('/relay/torbox/torrents/requestdl?torrent_id=7&file_id=9&zip_link=false&redirect=false');
  assert.equal(response.status,200);
  const upstream=new URL(seen.at(-1).url);
  assert.equal(seen.at(-1).authorization,'');
  assert.equal(upstream.searchParams.get('token'),KEY);
  assert.equal(upstream.searchParams.get('torrent_id'),'7');
  assert.equal(upstream.searchParams.get('file_id'),'9');
});

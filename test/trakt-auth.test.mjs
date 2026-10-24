import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const source=(await readFile(new URL('../public/trakt.js',import.meta.url),'utf8'))
  .replace(/^import .*;\r?\n/gm,'')
  .replace(/^export /gm,'');

function storage(){
  const map=new Map();
  return {
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>map.set(key,String(value)),
    removeItem:key=>map.delete(key)
  };
}
function fixture(){
  const localStorage=storage(),sessionStorage=storage(),tokens=new Map(),calls=[];
  const clientId='a'.repeat(64),input={value:clientId};
  const document={activeElement:null,getElementById:id=>id==='trakt-client-id'?input:null};
  const location={href:'https://to-shreds.github.io/torbox-web-player/',assign(href){this.href=href;}};
  const history={replaceState(_state,_unused,path){location.href='https://to-shreds.github.io'+path;}};
  const fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/oauth/token')){
      const payload=JSON.parse(options.body);
      return {ok:true,status:200,json:async()=>({access_token:'new-token',refresh_token:'new-refresh',expires_in:604800,created_at:Math.floor(Date.now()/1000)})};
    }
    if(url.includes('/seasons/1/episodes/2'))return {ok:true,status:200,json:async()=>({season:1,number:2,ids:{trakt:54321}})};
    if(url.includes('/sync/history')||url.includes('/sync/playback'))return {ok:true,status:200,json:async()=>([])};
    if(url.includes('/scrobble/'))return {ok:true,status:201,json:async()=>({action:'start'})};
    throw new Error('Unexpected API request: '+url);
  };
  const context=vm.createContext({
    localStorage,sessionStorage,document,location,history,fetch,
    crypto:webcrypto,URL,TextEncoder,TextDecoder,AbortSignal,setTimeout,clearTimeout,isSecureContext:true,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    saveTraktCredentials:async(viewer,value)=>{tokens.set(viewer,value);},
    loadTraktCredentials:async(viewer)=>tokens.get(viewer)||null,
    removeTraktCredentials:async viewer=>{tokens.delete(viewer);}
  });
  vm.runInContext(source+'\nthis.Integration=TraktIntegration;',context);
  return {TraktIntegration:context.Integration,location,localStorage,sessionStorage,document,calls,tokens,clientId,context};
}

test('Trakt PKCE login returns to the main Pages site and clears its authorization code',async()=>{
  const f=fixture(),app=new f.TraktIntegration({getViewer:()=> 'viewer-2'});
  await app.connect();
  const auth=new URL(f.location.href),state=auth.searchParams.get('state');
  assert.equal(auth.origin,'https://auth.trakt.tv');
  assert.equal(auth.searchParams.get('redirect_uri'),'https://to-shreds.github.io/torbox-web-player/');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  assert.ok(auth.searchParams.get('code_challenge'));
  assert.ok(state&&state.length>=30);
  assert.ok(f.sessionStorage.getItem('torbox-trakt-oauth-pending-v1'));
  f.location.href='https://to-shreds.github.io/torbox-web-player/?code=synthetic&state='+encodeURIComponent(state);
  await app.completeOAuth();
  assert.equal(f.location.href,'https://to-shreds.github.io/torbox-web-player/');
  assert.equal(f.sessionStorage.getItem('torbox-trakt-oauth-pending-v1'),null);
  assert.equal(f.tokens.get('viewer-2').access_token,'new-token');
  assert.equal(app.preferences('viewer-2').enabled,true);
  assert.equal(app.preferences('viewer-1').enabled,false);
  assert.equal(f.calls[0].url,'https://api.trakt.tv/oauth/token');
  const exchange=JSON.parse(f.calls[0].options.body);
  assert.ok(exchange.code_verifier);
  assert.equal(exchange.client_secret,undefined);
});

test('mismatched OAuth state prevents token exchange and strips code',async()=>{
  const f=fixture(),app=new f.TraktIntegration({getViewer:()=> 'viewer-1'});
  await app.connect();
  f.location.href='https://to-shreds.github.io/torbox-web-player/?code=synthetic&state=attacker';
  await app.completeOAuth();
  assert.equal(f.calls.length,0);
  assert.equal(f.tokens.size,0);
  assert.equal(f.location.href,'https://to-shreds.github.io/torbox-web-player/');
});

test('Trakt posts exact movie progress once and never if disabled',async()=>{
  const f=fixture(),app=new f.TraktIntegration({getViewer:()=> 'viewer-1'});
  f.localStorage.setItem('torbox-trakt-client-id-v1',f.clientId);
  app.credentials.set('viewer-1',{client_id:f.clientId,access_token:'tok',refresh_token:'refresh',expires_at:Date.now()+86400000});
  const context={viewer:'viewer-1',playbackContext:{current:{type:'movie',id:'tt0133093'}},video:{currentTime:300,duration:600}};
  app.playing(context);
  await app.requests;
  assert.equal(f.calls.length,0);
  app.setPreferences('viewer-1',{enabled:true});
  const next={...context};
  app.playing(next);
  await app.requests;
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'https://api.trakt.tv/scrobble/start');
  const sent=JSON.parse(f.calls[0].options.body);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)),{movie:{ids:{imdb:'tt0133093'}},progress:50});
});

test('episode scrobble looks up exact episode id, then reports that episode',async()=>{
  const f=fixture(),app=new f.TraktIntegration({getViewer:()=> 'viewer-1'});
  f.localStorage.setItem('torbox-trakt-client-id-v1',f.clientId);
  app.credentials.set('viewer-1',{client_id:f.clientId,access_token:'tok',refresh_token:'refresh',expires_at:Date.now()+86400000});
  app.setPreferences('viewer-1',{enabled:true});
  app.playing({viewer:'viewer-1',playbackContext:{current:{type:'series',id:'tt0903747',season:1,episode:2}},video:{currentTime:30,duration:60}});
  await app.requests;
  assert.equal(f.calls.length,2);
  assert.match(f.calls[0].url,/\/shows\/tt0903747\/seasons\/1\/episodes\/2$/);
  assert.equal(f.calls[1].url,'https://api.trakt.tv/scrobble/start');
  assert.deepEqual(JSON.parse(f.calls[1].options.body),{episode:{ids:{trakt:54321}},progress:50});
});

function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function authorize(f,app,viewer='viewer-1',expired=false){
  f.localStorage.setItem('torbox-trakt-client-id-v1',f.clientId);
  app.credentials.set(viewer,{client_id:f.clientId,access_token:'old-token',refresh_token:'old-refresh',expires_at:expired?0:Date.now()+86400000});
  app.setPreferences(viewer,{enabled:true,importHistory:true});
}
const response=value=>({ok:true,status:200,json:async()=>value});
test('100 simultaneous expired requests share one refresh and retain both viewer credentials',async()=>{
  const f=fixture(),app=new f.TraktIntegration();authorize(f,app,'viewer-1',true);authorize(f,app,'viewer-2');
  const results=await Promise.all(Array.from({length:100},()=>app.ensureToken('viewer-1')));
  assert.equal(results.length,100);assert.ok(results.every(x=>x==='new-token'));
  assert.equal(f.calls.filter(x=>x.url.endsWith('/oauth/token')).length,1);
  assert.equal(app.credentials.get('viewer-2').access_token,'old-token');
});
test('disconnect while token refresh waits cannot restore credentials or send a delayed API call',async()=>{
  const f=fixture(),app=new f.TraktIntegration();authorize(f,app,'viewer-1',true);
  const gate=deferred(),started=deferred();let requests=0;
  f.context.fetch=async url=>{if(url.endsWith('/oauth/token')){started.resolve();return gate.promise;}if(url.endsWith('/oauth/revoke'))return response({});requests++;return response([]);};
  const request=app.request('viewer-1','/sync/playback');const rejected=assert.rejects(request);
  await started.promise;await app.disconnect();
  gate.resolve(response({access_token:'rotated',refresh_token:'rotated-refresh'}));await rejected;
  assert.equal(app.credentials.has('viewer-1'),false);assert.equal(f.tokens.has('viewer-1'),false);assert.equal(requests,0);
});
test('old account history response cannot enter a newly connected account cache',async()=>{
  const f=fixture(),app=new f.TraktIntegration();authorize(f,app);
  const gate=deferred(),started=deferred();let n=0;
  f.context.fetch=async url=>{if(url.includes('/sync/')){if(++n===2)started.resolve();await gate.promise;return response([]);}return response({});};
  const old=app.syncHistory('viewer-1');await started.promise;await app.disconnect();authorize(f,app);
  const newRows={watched:[{title:'New account only'}],playback:[],updatedAt:42};app.remote.set('viewer-1',newRows);
  gate.resolve();await old;assert.equal(app.remote.get('viewer-1'),newRows);
});
test('mismatched episode response is rejected before any scrobble',async()=>{
  const f=fixture(),app=new f.TraktIntegration();authorize(f,app);const calls=[];
  f.context.fetch=async url=>{calls.push(url);return response({season:3,number:8,ids:{trakt:54321}});};
  app.playing({viewer:'viewer-1',playbackContext:{current:{type:'series',id:'tt0903747',season:1,episode:2}},video:{currentTime:30,duration:60}});
  await app.requests;assert.equal(calls.length,1);assert.match(app.message,/identify/);
});
test('100 queued old-account scrobbles are discarded after disconnect and reconnect',async()=>{
  const f=fixture(),app=new f.TraktIntegration();authorize(f,app);
  const gate=deferred();app.requests=gate.promise;
  for(let i=0;i<100;i++)app.playing({viewer:'viewer-1',playbackContext:{current:{type:'movie',id:'tt0133093'}},video:{currentTime:i+1,duration:600}});
  await app.disconnect();authorize(f,app);gate.resolve();await app.requests;
  assert.equal(f.calls.filter(x=>x.url.includes('/scrobble/')).length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, isCarStreamApiAction, CARSTREAM_API_ACTIONS, isTrustedDirectMediaUrl } from '../public/runtime-core.js';
const origin = 'http://192.168.43.1:8787', id = 'a'.repeat(43);
const memory = () => { const values=new Map();return { getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k),flush:async()=>{} }; };
const local = extra => createRuntime({mode:'carstream',pageOrigin:origin,apiOrigin:'https://torbox-web-player-key.onrender.com',...extra});
test('normal Internet runtime keeps split-origin API, direct media and bearer behavior',()=>{
  const storage=memory();const r=createRuntime({pageOrigin:'https://to-shreds.github.io',apiOrigin:'https://torbox-web-player-key.onrender.com',secureContext:true,sessionStorage:storage,localStorage:storage});
  assert.equal(r.apiUrl('/api/session'),'https://torbox-web-player-key.onrender.com/api/session');
  assert.equal(r.apiMode(),'cors');assert.equal(r.credentialsMode(),'omit');
  assert.equal(r.mediaUrl('https://store.tb-cdn.io/video?token=fixture'),'https://store.tb-cdn.io/video?token=fixture');
  assert.equal(r.setSessionToken(id),true);assert.equal(r.getSessionToken(),id);r.clearSessionToken();assert.equal(r.getSessionToken(),'');
  assert.equal(r.applicationStorage(),storage);assert.equal(r.parentPinService(),null);assert.equal(r.capabilities.driveSharing,true);
});
test('CarStream ignores remote API configuration and uses local credentials only',()=>{
  const storage=memory();storage.setItem('torbox-web-session',id);const r=local({sessionStorage:storage});
  assert.equal(r.apiUrl('/api/discover/catalog?q=Elena%20of%20Avalor'),origin+'/tw/api/discover/catalog?q=Elena%20of%20Avalor');
  assert.equal(r.apiMode(),'same-origin');assert.equal(r.credentialsMode(),'same-origin');
  assert.equal(r.getSessionToken(),'');assert.equal(r.setSessionToken(id),false);
});
test('every supported local API action is bounded to the same origin',()=>{
  const r=local();for(const [path,methods] of Object.entries(CARSTREAM_API_ACTIONS)){
    assert.equal(new URL(r.apiUrl(path)).origin,origin);
    for(const method of methods)assert.equal(isCarStreamApiAction(path,method),true);
    assert.equal(isCarStreamApiAction(path,'DELETE'),false);
  }
});
test('local runtime refuses external, owner, library, credential and arbitrary proxy API routes',()=>{
  const r=local();for(const value of ['https://evil.test/api/session','//evil.test/api/session','/api/session#secret','/api/session\\x','/api/../api/session','/api/%73ession','/api/owner/diagnostics','/api/library','/api/login','/api/drive/config','/api/proxy?url=https://evil.test'])assert.throws(()=>r.apiUrl(value),value);
});
test('opaque media and artwork remain local; raw signed URLs cannot become proxy arguments',()=>{
  const r=local();assert.equal(r.mediaUrl('/media/'+id),origin+'/media/'+id);assert.equal(r.imageUrl('/image/'+id),origin+'/image/'+id);assert.equal(r.imageUrl(''),'');
  for(const value of ['https://store.tb-cdn.io/file?token=secret','//evil.test/media/'+id,'/media/'+id+'?token=secret','/media/'+id+'#secret','/media/'+id+'\\','/media/short','/image/'+id])assert.throws(()=>r.mediaUrl(value),value);
  for(const value of ['https://image.tmdb.org/poster.jpg','/image/'+id+'?url=https://evil.test','/media/'+id])assert.throws(()=>r.imageUrl(value),value);
  assert.equal(r.isTrustedPlaybackUrl('/media/'+id),true);assert.equal(r.isTrustedPlaybackUrl('https://store.tb-cdn.io/file?token=secret'),false);
  assert.equal(isTrustedDirectMediaUrl('https://store.tb-cdn.io/file?token=fixture'),true);
});
test('local runtime cannot silently fall back to origin-scoped storage or Web Crypto PIN',async()=>{
  const r=local({localStorage:memory()});assert.throws(()=>r.applicationStorage(),/Phone profile/);assert.throws(()=>r.parentPinService(),/Phone Parent PIN/);
  assert.throws(()=>r.installServices({storage:memory()}),/both required/);
  const storage=memory(),parentPin={hasPin:()=>true,verifyPin:async pin=>pin==='1234',setPin:async()=>true};
  r.installServices({storage,parentPin});assert.equal(r.applicationStorage(),storage);assert.equal(r.parentPinService(),parentPin);assert.equal(await r.parentPinService().verifyPin('1234'),true);
  assert.throws(()=>r.installServices({storage,parentPin}),/already installed/);
});
test('LAN HTTP capabilities disable install, service worker, Drive, credential vault and wake lock',()=>{
  const c=local().capabilities;for(const flag of ['serviceWorker','installApp','driveSharing','credentialVault','screenWakeLock'])assert.equal(c[flag],false,flag);
  for(const flag of ['phoneCredentials','phonePersistence','phoneParentPin'])assert.equal(c[flag],true,flag);
  assert.equal(Object.isFrozen(c),true);
});
test('unknown runtime and malformed local prefixes fail closed',()=>{
  assert.throws(()=>createRuntime({mode:'accident'}));for(const apiPrefix of ['https://evil.test','//evil','/../evil','/tw?x'])assert.throws(()=>local({apiPrefix}));
});
test('normal browser storage availability is checked at use time, as before',()=>{
  let storage=null;const r=createRuntime({localStorage:()=>storage,sessionStorage:()=>storage});
  assert.equal(r.applicationStorage(),null);assert.equal(r.setSessionToken(id),false);storage=memory();
  assert.equal(r.applicationStorage(),storage);assert.equal(r.setSessionToken(id),true);assert.equal(r.getSessionToken(),id);
});
test('a rejected phone state write remains a rejected application checkpoint',async()=>{
  const r=local(),storage=memory();storage.flush=async()=>{throw new Error('Phone rejected stale or unauthorized state.');};
  r.installServices({storage,parentPin:{hasPin:()=>true,verifyPin:async()=>false,setPin:async()=>false}});
  await assert.rejects(()=>r.flushState(),/Phone rejected/);
});

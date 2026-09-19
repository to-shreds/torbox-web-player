import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// A separate Node test worker simulates LAN HTTP without Web Crypto or usable browser storage.
globalThis.location={origin:'http://192.168.43.1:8787'};
globalThis.document={querySelector:selector=>selector==='meta[name="player-runtime"]'?{content:'carstream'}:null};
const browserStorage={getItem(){throw new Error('Browser storage must not be used.');},setItem(){throw new Error('Browser storage must not be used.');}};
globalThis.localStorage=browserStorage;
const runtime=await import('../public/runtime.js');
const parental=await import('../public/parental-controls.js');
const history=await import('../public/history.js');
const watchlist=await import('../public/watchlist.js');
const settings=await import('../public/settings.js');
const values=new Map();let pin='1234',verified=false,verificationCalls=0;
const store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),flush:async()=>{}};
const parentPin={hasPin:()=>true,verifyPin:async value=>{verificationCalls++;verified=value===pin;return verified;},setPin:async value=>{if(!verified)throw new Error('Current PIN required.');pin=value;verified=false;return true;}};
test('local application cannot initialize before phone profile and PIN services are ready',()=>{
  assert.throws(()=>runtime.assertRuntimeReady(),/Phone profile/);assert.throws(()=>parental.hasParentPin(),/Phone profile/);
  runtime.installRuntimeServices({storage:store,parentPin});assert.doesNotThrow(()=>runtime.assertRuntimeReady());
});
test('PIN verification and change are delegated; the browser never derives or persists a PIN',async()=>{
  const unavailableCrypto=new Proxy({},{get(){throw new Error('Web Crypto was used on LAN HTTP.');}});
  assert.equal(parental.hasParentPin(),true);assert.equal(await parental.verifyParentPin('0000',undefined,unavailableCrypto),false);
  await assert.rejects(()=>parental.setParentPin('4321',undefined,unavailableCrypto),/Current PIN/);
  assert.equal(await parental.verifyParentPin('1234',undefined,unavailableCrypto),true);await parental.setParentPin('4321',undefined,unavailableCrypto);
  assert.equal(await parental.verifyParentPin('4321',undefined,unavailableCrypto),true);assert.equal(verificationCalls,3);
  assert.ok(!JSON.stringify([...values]).includes('4321'));
});
test('unchanged canonical Kid Mode accounting uses the injected phone storage',()=>{
  const context={current:{type:'series',id:'tt1234567',season:1,episode:1}};
  parental.updateKidProfile('viewer-1',{enabled:true,episodeLimit:1,resetMode:'manual'});
  const result=parental.consumeKidPlayback('viewer-1',context,120,600);assert.equal(result.newlyCharged,true);assert.equal(result.profile.episodesUsed,1);
  assert.equal(parental.canStartKidPlayback('viewer-1',context).allowed,true);
  assert.equal(parental.canStartKidPlayback('viewer-1',{current:{...context.current,episode:2}}).allowed,false);
  assert.equal(parental.getKidProfile('viewer-1').enabled,true);assert.equal(parental.getKidProfile('viewer-2').enabled,false);
  assert.ok(values.has('torbox-parental-controls-v1'));
});
test('resume, My List and settings use phone storage and stable local artwork references',()=>{
  const poster='/image/'+'a'.repeat(43),context={current:{type:'movie',id:'tt1234567'},title:'Fixture movie',poster};
  history.recordRecent(context,90,600);assert.equal(history.listRecent()[0].poster,poster);assert.equal(history.listRecent()[0].position,90);
  watchlist.toggleWatchlist('viewer-1',{type:'movie',id:'tt1234567',name:'Fixture',poster});assert.equal(watchlist.listWatchlist('viewer-1')[0].poster,poster);
  settings.saveSettings({resumeRewindSeconds:15});assert.equal(settings.getSettings().resumeRewindSeconds,15);
  assert.equal(runtime.storedImageReference('https://image.tmdb.org/remote.jpg'),'');
});
test('the UI gates secure-context and sharing controls through capabilities',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(app,/assertRuntimeReady\(\)/);assert.match(app,/runtimeCapabilities\.serviceWorker&&/);assert.match(app,/runtimeCapabilities\.screenWakeLock/);
  assert.match(app,/driveTest: runtimeCapabilities\.driveSharing \? openDriveTest : null/);assert.match(html,/data-runtime-capability="driveSharing"/);
  assert.match(app,/img\.src = imageUrl\(item\.poster\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const start=app.includes('// Playback wake lock ownership')?app.indexOf('// Playback wake lock ownership'):app.indexOf('async function releaseWakeLock()');
const block=app.slice(start,app.indexOf('function armSleepTimer',start));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Sentinel {
  released=false; releases=0; listeners=[];
  constructor({deferRelease=false}={}){this.done=deferRelease?deferred():null;}
  addEventListener(name,callback){assert.equal(name,'release');this.listeners.push(callback);}
  emit(){this.released=true;for(const callback of this.listeners.splice(0))callback();}
  async release(){this.releases++;this.released=true;if(this.done)await this.done.promise;this.emit();}
}
function fixture(){
  const requests=[];
  const scope={active:{video:{paused:false,ended:false}},settings:{keepAwake:true},document:{visibilityState:'visible'},pip:false};
  scope.getSettings=()=>scope.settings;scope.playerIsPiP=()=>scope.pip;
  scope.navigator={wakeLock:{request:type=>{assert.equal(type,'screen');const request=deferred();requests.push(request);return request.promise;}}};
  vm.runInNewContext((block.includes('let wakeLock=')?'':'let wakeLock=null;')+block+';globalThis.api={acquireWakeLock,releaseWakeLock,refreshWakeLockForPlayback};',scope);
  return {...scope,scope,requests,api:scope.api};
}
test('100 simultaneous playing and presentation notifications share one wake-lock request',async()=>{
  const f=fixture(),calls=Array.from({length:100},()=>f.api.acquireWakeLock());
  const sentinel=new Sentinel();for(const request of f.requests)request.resolve(sentinel);
  assert.ok((await Promise.all(calls)).every(Boolean));assert.equal(f.requests.length,1);
});
test('a pending acquisition is released when playback pauses before the browser grants it',async()=>{
  const f=fixture(),pending=f.api.acquireWakeLock();f.scope.active.video.paused=true;
  await f.api.releaseWakeLock();const sentinel=new Sentinel();f.requests[0].resolve(sentinel);
  assert.equal(await pending,false);assert.equal(sentinel.releases,1);
});
test('a replaced playback cannot adopt its late wake lock',async()=>{
  const f=fixture(),pending=f.api.acquireWakeLock();f.scope.active={video:{paused:false,ended:false}};
  const sentinel=new Sentinel();f.requests[0].resolve(sentinel);assert.equal(await pending,false);assert.equal(sentinel.releases,1);
});
test('disabling keep-awake before acquisition resolves releases the late sentinel',async()=>{
  const f=fixture(),pending=f.api.acquireWakeLock();f.scope.settings.keepAwake=false;
  const sentinel=new Sentinel();f.requests[0].resolve(sentinel);assert.equal(await pending,false);assert.equal(sentinel.releases,1);
});
test('an old release completion and event cannot erase the current playback lock',async()=>{
  const f=fixture(),first=f.api.acquireWakeLock(),old=new Sentinel({deferRelease:true});f.requests[0].resolve(old);await first;
  const releasing=f.api.releaseWakeLock(),second=f.api.acquireWakeLock(),current=new Sentinel();f.requests[1].resolve(current);await second;
  old.done.resolve();await releasing;const third=f.api.acquireWakeLock();
  if(f.requests[2])f.requests[2].resolve(new Sentinel());await third;
  assert.equal(f.requests.length,2);assert.equal(current.releases,0);
});
test('a canceled pending request does not clear or duplicate a newer pending acquisition',async()=>{
  const f=fixture(),first=f.api.acquireWakeLock();await f.api.releaseWakeLock();const second=f.api.acquireWakeLock();
  const old=new Sentinel();f.requests[0].resolve(old);await first;
  const shared=f.api.acquireWakeLock();for(const request of f.requests.slice(1))request.resolve(new Sentinel());await Promise.all([second,shared]);
  assert.equal(f.requests.length,2);assert.equal(old.releases,1);
});
test('a stopped or stale playback notification cannot release the active playback lock',async()=>{
  const f=fixture(),current=new Sentinel(),first=f.api.acquireWakeLock();f.requests[0].resolve(current);await first;
  assert.equal(await f.api.refreshWakeLockForPlayback({video:{paused:true,ended:false}}),false);
  assert.equal(current.releases,0);
});
test('turning keep-awake off releases a held sentinel on refresh',async()=>{
  const f=fixture(),current=new Sentinel(),first=f.api.acquireWakeLock();f.requests[0].resolve(current);await first;
  f.scope.settings.keepAwake=false;assert.equal(await f.api.refreshWakeLockForPlayback(),false);assert.equal(current.releases,1);
});
test('a rejected browser request can be retried on the next playback event',async()=>{
  const f=fixture(),first=f.api.acquireWakeLock();f.requests[0].reject(new Error('Browser denied'));assert.equal(await first,false);
  const second=f.api.acquireWakeLock();f.requests[1].resolve(new Sentinel());assert.equal(await second,true);
});
test('hidden non-PiP playback is ineligible while browser PiP policy denial stays nonfatal',async()=>{
  const f=fixture();f.scope.document.visibilityState='hidden';assert.equal(await f.api.acquireWakeLock(),false);assert.equal(f.requests.length,0);
  f.scope.pip=true;const requested=f.api.acquireWakeLock();f.requests[0].reject(new Error('Hidden document denied'));assert.equal(await requested,false);
});
test('browser automatic release permits later visible playback acquisition',async()=>{
  const f=fixture(),first=f.api.acquireWakeLock(),sentinel=new Sentinel();f.requests[0].resolve(sentinel);await first;sentinel.emit();
  const second=f.api.refreshWakeLockForPlayback();f.requests[1].resolve(new Sentinel());assert.equal(await second,true);
});
test('a completed episode cannot overwrite new playback UI after its delayed wake-lock release',async()=>{
  const start=app.indexOf("listen('ended', async () => {");
  const ended=app.slice(start,app.indexOf("listen('error',",start));
  const release=deferred(),updates=[];
  const context={healthyTimer:null};
  const scope={active:context,context,clearTimeout,listen:(event,handler)=>{assert.equal(event,'ended');scope.onEnded=handler;},tickKidUsage(){},trakt:{stopped(){}},clearBuffer(){},hidePauseCard(){},saveProgress(){},markPlaybackCompleted(){},setPlaybackHealth(){},releaseWakeLock:()=>release.promise,queuedNext:()=>null,hideUpNextCard:()=>updates.push('hide'),text:()=>updates.push('text')};
  vm.runInNewContext(ended,scope);
  const pending=scope.onEnded();scope.active={video:{paused:false}};release.resolve();await pending;
  assert.deepEqual(updates,[]);
});

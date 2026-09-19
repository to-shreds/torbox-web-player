import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasParentPin,setParentPin,verifyParentPin,getKidProfile,updateKidProfile,
  resetKidAllowance,grantKidExtension,canStartKidPlayback,consumeKidPlayback,
  formatKidUsage
} from '../public/parental-controls.js';

class Store{
  constructor(){this.map=new Map()}
  getItem(key){return this.map.has(key)?this.map.get(key):null}
  setItem(key,value){this.map.set(key,String(value))}
  removeItem(key){this.map.delete(key)}
}
const movie=id=>({current:{type:'movie',id}});
const episode=(id='tt1234567',season=1,number=1)=>({current:{type:'series',id,season,episode:number}});
const day1=new Date(2026,8,19,12,0,0).getTime();
const day2=new Date(2026,8,20,12,0,0).getTime();

test('Parent PIN is derived, never stored in plaintext, and verifies',async()=>{
  const store=new Store();
  assert.equal(hasParentPin(store,day1),false);
  await setParentPin('2468',store,globalThis.crypto,day1);
  assert.equal(hasParentPin(store,day1),true);
  assert.equal(await verifyParentPin('2468',store,globalThis.crypto,day1),true);
  assert.equal(await verifyParentPin('1357',store,globalThis.crypto,day1),false);
  const raw=store.getItem('torbox-parental-controls-v1');
  assert.ok(raw);
  assert.equal(raw.includes('2468'),false);
  assert.match(raw,/"salt":"[0-9a-f]{32}"/);
  assert.match(raw,/"hash":"[0-9a-f]{64}"/);
});

test('daily allowance resets across calendar days but manual allowance persists',()=>{
  const daily=new Store();
  updateKidProfile('viewer-1',{enabled:true,timeLimitMinutes:90,resetMode:'daily'},daily,day1);
  consumeKidPlayback('viewer-1',movie('tt1234567'),600,7200,daily,day1);
  assert.equal(Math.floor(getKidProfile('viewer-1',daily,day1).usedSeconds),600);
  assert.equal(getKidProfile('viewer-1',daily,day2).usedSeconds,0);

  const manual=new Store();
  updateKidProfile('viewer-1',{enabled:true,timeLimitMinutes:90,resetMode:'manual'},manual,day1);
  consumeKidPlayback('viewer-1',movie('tt1234567'),600,7200,manual,day1);
  assert.equal(Math.floor(getKidProfile('viewer-1',manual,day2).usedSeconds),600);
});

test('episode is charged after 5 minutes or 20 percent, whichever comes first',()=>{
  const store=new Store();
  updateKidProfile('viewer-1',{enabled:true,episodeLimit:1,resetMode:'manual'},store,day1);
  const first=episode('tt1234567',1,1),second=episode('tt1234567',1,2);
  consumeKidPlayback('viewer-1',first,239,1200,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).episodesUsed,0);
  consumeKidPlayback('viewer-1',first,1,1200,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).episodesUsed,1);
  assert.equal(canStartKidPlayback('viewer-1',first,store,day1).allowed,true);
  const blocked=canStartKidPlayback('viewer-1',second,store,day1);
  assert.equal(blocked.allowed,false);
  assert.equal(blocked.reason,'episodes');
});

test('long episodes charge at five actual watched minutes',()=>{
  const store=new Store();
  updateKidProfile('viewer-1',{enabled:true,episodeLimit:2,resetMode:'manual'},store,day1);
  const row=episode('tt1234567',2,1);
  consumeKidPlayback('viewer-1',row,299,3600,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).episodesUsed,0);
  consumeKidPlayback('viewer-1',row,1,3600,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).episodesUsed,1);
});

test('movie is charged after ten actual watched minutes and the same movie remains resumable',()=>{
  const store=new Store();
  updateKidProfile('viewer-1',{enabled:true,movieLimit:1,resetMode:'manual'},store,day1);
  const first=movie('tt7654321'),second=movie('tt7654322');
  consumeKidPlayback('viewer-1',first,599,7200,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).moviesUsed,0);
  consumeKidPlayback('viewer-1',first,1,7200,store,day1);
  assert.equal(getKidProfile('viewer-1',store,day1).moviesUsed,1);
  assert.equal(canStartKidPlayback('viewer-1',first,store,day1).allowed,true);
  assert.equal(canStartKidPlayback('viewer-1',second,store,day1).reason,'movies');
});

test('time allowance stops immediately and parent extensions restore access',()=>{
  const store=new Store(),context=movie('tt7654321');
  updateKidProfile('viewer-1',{enabled:true,timeLimitMinutes:1,resetMode:'manual'},store,day1);
  const result=consumeKidPlayback('viewer-1',context,60,7200,store,day1);
  assert.equal(result.timeBlocked,true);
  assert.equal(canStartKidPlayback('viewer-1',context,store,day1).reason,'time');
  grantKidExtension('viewer-1',{minutes:15},store,day1);
  assert.equal(canStartKidPlayback('viewer-1',context,store,day1).allowed,true);
  assert.match(formatKidUsage(getKidProfile('viewer-1',store,day1)),/1 \/ 16 min/);
});

test('episode and movie extensions only expand their own allowance',()=>{
  const store=new Store();
  updateKidProfile('viewer-1',{enabled:true,episodeLimit:1,movieLimit:1,resetMode:'manual'},store,day1);
  const ep1=episode('tt1234567',1,1),ep2=episode('tt1234567',1,2);
  consumeKidPlayback('viewer-1',ep1,300,3600,store,day1);
  assert.equal(canStartKidPlayback('viewer-1',ep2,store,day1).allowed,false);
  grantKidExtension('viewer-1',{episodes:1},store,day1);
  assert.equal(canStartKidPlayback('viewer-1',ep2,store,day1).allowed,true);
  assert.equal(getKidProfile('viewer-1',store,day1).bonusMovies,0);
});

test('manual reset clears usage, charged content, and temporary extensions',()=>{
  const store=new Store();
  updateKidProfile('viewer-2',{enabled:true,timeLimitMinutes:60,episodeLimit:1,resetMode:'manual'},store,day1);
  consumeKidPlayback('viewer-2',episode('tt1234567',1,1),300,1800,store,day1);
  grantKidExtension('viewer-2',{minutes:30,episodes:1},store,day1);
  const reset=resetKidAllowance('viewer-2',store,day1);
  assert.equal(reset.usedSeconds,0);
  assert.equal(reset.episodesUsed,0);
  assert.equal(reset.bonusSeconds,0);
  assert.equal(reset.bonusEpisodes,0);
  assert.deepEqual(reset.charged,[]);
});

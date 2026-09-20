import test from 'node:test';
import assert from 'node:assert/strict';
import { applySourceMemory, clearSourceMemory, getTitleQuality, rememberSourceSuccess, setAudioFeedback, setSourceBad, setTitleQuality, sourceMemory } from '../public/source-memory.js';
import { listSearchHistory, recordSearch, removeSearch } from '../public/search-history.js';
import { recommendSource } from '../public/discover.js';
function memoryStore(){const map=new Map();return{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
const target={type:'series',id:'tt0182576',season:2,episode:3};
const source=(hash,extra={})=>({id:hash,hash,filename:`Show.S02E03.720p.WEB-DL-${extra.group||'GOOD'}`,provider:'fixture',resolution:'720p',cached:true,browserFriendly:true,audioRisk:false,videoRisk:false,score:0,size:700*1024**2,...extra});
test('per-title quality is stored at show/movie level',()=>{const store=memoryStore();assert.equal(getTitleQuality(target,store),'');setTitleQuality(target,'480p',store);assert.equal(getTitleQuality({type:'series',id:target.id,season:9,episode:9},store),'480p');});
test('successful and audio-confirmed sources earn local recommendation preference',()=>{
  const store=memoryStore(),a=source('a'.repeat(40)),b=source('b'.repeat(40),{score:40,group:'OTHER'});
  rememberSourceSuccess(target,a,store);setAudioFeedback(target,a,'good',store);
  const decorated=applySourceMemory(target,[a,b],store);assert.ok(decorated[0].memoryBonus>decorated[1].memoryBonus);
  assert.equal(recommendSource(decorated,'series','720p','balanced').hash,a.hash);
});
test('manual bad source and no-sound feedback remove a source from automatic recommendation',()=>{
  const store=memoryStore(),a=source('a'.repeat(40)),b=source('b'.repeat(40));
  setSourceBad(target,a,true,store);let rows=applySourceMemory(target,[a,b],store);assert.equal(recommendSource(rows,'series','720p','balanced').hash,b.hash);
  setSourceBad(target,a,false,store);setAudioFeedback(target,a,'bad',store);rows=applySourceMemory(target,[a,b],store);assert.equal(sourceMemory(target,a,store).audio,'bad');assert.equal(recommendSource(rows,'series','720p','balanced').hash,b.hash);
  clearSourceMemory(store);assert.equal(sourceMemory(target,a,store).audio,'unknown');
});
test('search history is per viewer, deduplicated, and individually removable',()=>{
  const store=memoryStore();recordSearch('viewer-1','Dune',store);recordSearch('viewer-1','dune',store);recordSearch('viewer-1','Animorphs',store);recordSearch('viewer-2','Bluey',store);
  assert.equal(listSearchHistory('viewer-1',store).length,2);assert.equal(listSearchHistory('viewer-2',store)[0].query,'Bluey');
  removeSearch('viewer-1','Animorphs',store);assert.equal(listSearchHistory('viewer-1',store).some(row=>row.query==='Animorphs'),false);
});

test('source audio and bad-source learning is isolated to the exact file variant',()=>{
  const store=memoryStore(),hash='c'.repeat(40);
  const one=source(hash,{filename:'Show.S02E03.720p.AAC-one.mkv',fileIdx:0,group:'ONE'});
  const two=source(hash,{filename:'Show.S02E03.720p.AAC-two.mkv',fileIdx:1,group:'TWO'});
  setAudioFeedback(target,one,'bad',store);
  assert.equal(sourceMemory(target,one,store).audio,'bad');
  assert.equal(sourceMemory(target,one,store).bad,true);
  assert.equal(sourceMemory(target,two,store).audio,'unknown');
  assert.equal(sourceMemory(target,two,store).bad,false);
  setAudioFeedback(target,two,'good',store);
  rememberSourceSuccess(target,two,store);
  assert.equal(sourceMemory(target,two,store).audio,'good');
  assert.equal(sourceMemory(target,one,store).audio,'bad');
});

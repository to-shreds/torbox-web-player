import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackAudioCheck } from '../public/playback-lifecycle.js';
import { applySourceMemory, noteAudioDecodeFailure, setAudioFeedback } from '../public/source-memory.js';
const video = overrides => ({currentTime:0,playbackRate:1,paused:false,ended:false,seeking:false,readyState:4,muted:false,volume:1,webkitAudioDecodedByteCount:0,...overrides});
function advance(check,v,seconds,visible=true){for(let tick=0;tick<=seconds*4;tick++){v.currentTime=tick/4;check.sample(v,tick*250,visible);}return check.state;}
test('advancing video without audio decoding fails after the grace period',()=>{const check=new PlaybackAudioCheck(),v=video();assert.equal(advance(check,v,4.5),'unknown');assert.equal(check.sample({...v,currentTime:5},5000),'missing');});
test('decoded bytes validate a quiet AAC scene without inspecting audio amplitude',()=>{const check=new PlaybackAudioCheck(),v=video({webkitAudioDecodedByteCount:128});assert.equal(advance(check,v,12),'decoded');});
for(const [name,overrides,visible] of [['paused',{paused:true},true],['muted',{muted:true},true],['zero volume',{volume:0},true],['seeking',{seeking:true},true],['buffering',{readyState:2},true],['background',{},false],['counter unavailable',{webkitAudioDecodedByteCount:undefined},true],['invalid counter',{webkitAudioDecodedByteCount:NaN},true]])test(`${name} never proves missing audio`,()=>assert.equal(advance(new PlaybackAudioCheck(),video(overrides),12,visible),'unknown'));
test('seek jumps and stalled long gaps do not exhaust the grace period',()=>{const check=new PlaybackAudioCheck(),v=video();check.sample(v,0);v.currentTime=100;check.sample(v,250);v.currentTime=110;assert.equal(check.sample(v,30000),'unknown');assert.equal(check.elapsed,0);});
for(const interval of [2000,4000])test(`repeated ${interval / 1000}-second callbacks still detect advancing video with no decoded audio`,()=>{
  const check=new PlaybackAudioCheck(),v=video({playbackRate:1.5});
  check.sample(v,0);
  for(let tick=1;tick<=4;tick++){
    v.currentTime=tick*interval/1000*v.playbackRate;
    const state=check.sample(v,tick*interval);
    assert.equal(state,tick<4?'unknown':'missing');
  }
});
test('one delayed callback cannot consume the entire audio grace period',()=>{
  const check=new PlaybackAudioCheck(),v=video();check.sample(v,0);v.currentTime=5;
  assert.equal(check.sample(v,5000),'unknown');assert.ok(check.elapsed<=1.5);
});
test('throttled observations ignore seek jumps and long suspension before counting new playback',()=>{
  const check=new PlaybackAudioCheck(),v=video();check.sample(v,0);
  v.currentTime=6;check.sample(v,2000);
  v.currentTime=100;check.sample(v,32000);
  assert.equal(check.elapsed,0);assert.equal(check.state,'unknown');
  v.currentTime=102;assert.equal(check.sample(v,34000),'unknown');
  assert.ok(check.elapsed>0&&check.elapsed<=1.5);
});
for(const [name,overrides,visible] of [['paused',{paused:true},true],['seeking',{seeking:true},true],['buffering',{readyState:2},true],['hidden',{},false],['muted',{muted:true},true]])test(`throttled ${name} transitions do not count inactive time`,()=>{
  const check=new PlaybackAudioCheck(),v=video();check.sample(v,0);
  check.sample({...v,currentTime:2,...overrides},2000,visible);
  v.currentTime=4;check.sample(v,4000);
  assert.equal(check.elapsed,0);assert.equal(check.state,'unknown');
  v.currentTime=6;assert.equal(check.sample(v,6000),'unknown');
  assert.ok(check.elapsed>0&&check.elapsed<=1.5);
});
test('late decoded audio supersedes a provisional missing verdict',()=>{const check=new PlaybackAudioCheck(),v=video();advance(check,v,6);v.webkitAudioDecodedByteCount=1024;assert.equal(check.sample(v,6100),'decoded');});
test('automatic no-decoder observation avoids a source only in this session and does not write feedback',()=>{const target={type:'series',id:'tt33043892'},source={hash:'a'.repeat(40)},writes=[];const store={getItem:()=>null,setItem:(...args)=>writes.push(args)};noteAudioDecodeFailure(target,source);assert.equal(applySourceMemory(target,[source],store)[0].memoryAudio,'bad');assert.deepEqual(writes,[]);setAudioFeedback(target,source,'good',store);assert.equal(writes.length,1);assert.equal(applySourceMemory(target,[source],store)[0].memoryAudio,'unknown');});

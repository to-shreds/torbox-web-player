import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePartyIdentity,normalizePartyMedia,normalizePartySnapshot,partyUpdateIsNewer,createPartyClock,partyTargetTime,partyDriftCorrection} from '../public/watch-party-core.js';

const epoch = 1792026000000;
const identity = {kind:'torrent',hash:'a'.repeat(40),path:'Show/Season 1/Episode 01.mkv',size:1073741824};
const media = {identity,target:{type:'series',id:'tt1234567',season:1,episode:1},title:'Example Show',fileTitle:'Episode 01.mkv',duration:1800};
const member = {present:true,ready:true,buffering:false,position:20};
function state(overrides = {}) { return {phase:'playing',playing:true,position:20,at:epoch,rate:1,wantsPlay:true,reason:'',...overrides}; }
function snapshot(overrides = {}) { return {serverTime:epoch+100,room:{id:'abcdefghijklmnop',role:'host',revision:1,expiresAt:epoch+3600000,media,state:state(),members:{host:{...member},guest:{...member}},...overrides}}; }
function clone(value) { return structuredClone(value); }

test('party identities retain exact file path and size and strip private source fields',() => {
  assert.deepEqual(normalizePartyIdentity({...identity,hash:identity.hash.toUpperCase(),path:'./Show\\Season 1\\Episode 01.mkv',url:'https://private.invalid/?token=secret'}),identity);
  const input = {...media,url:'https://private.invalid/?apikey=secret',torboxKey:'secret'};
  const clean = normalizePartyMedia(input);
  assert.deepEqual(clean,media); assert.notEqual(clean.identity,input.identity);
  const lower = normalizePartyIdentity({...identity,path:identity.path.toLowerCase()});
  assert.notEqual(lower.path,identity.path,'File identity remains case-sensitive.');
  assert.notEqual(normalizePartyIdentity({...identity,size:identity.size+1}).size,identity.size);
});

test('party media validation rejects ambiguous paths, unrelated providers, malformed targets and impossible durations',() => {
  for (const path of ['', '/etc/passwd','C:\\Windows\\a.mkv','//host/file.mkv','a/../b.mkv','a/./b.mkv','a//b.mkv','a/','a\u0000.mkv','a'.repeat(2049)]) assert.throws(() => normalizePartyIdentity({...identity,path}),/invalid/);
  for (const hash of ['', 'a'.repeat(39), 'a'.repeat(64), 'x'.repeat(40), 'a'.repeat(40)+'?token=secret']) assert.throws(() => normalizePartyIdentity({...identity,hash}),/invalid/);
  for (const size of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'100']) assert.throws(() => normalizePartyIdentity({...identity,size}),/invalid/);
  assert.throws(() => normalizePartyIdentity({...identity,kind:'web'}));
  for (const duration of [0,-1,NaN,Infinity,86401,'1800']) assert.throws(() => normalizePartyMedia({...media,duration}),/invalid/);
  for (const target of [{type:'series',id:'tt1234567',season:-1,episode:1},{type:'series',id:'tt1234567',season:1,episode:0},{type:'series',id:'tt1234567',season:1,episode:10000},{type:'movie',id:'tt1234567',season:1},{type:'tv',id:'tt1234567',season:1,episode:1},{type:'movie',id:123},{type:'movie',id:'https://example.org/movie'}]) assert.throws(() => normalizePartyMedia({...media,target}),/invalid/);
  assert.deepEqual(normalizePartyMedia({...media,target:{type:'series',id:'tt12345',season:0,episode:1}}).target,{type:'series',id:'tt12345',season:0,episode:1});
  for (const title of ['','a'.repeat(301),'Hidden\nTitle']) assert.throws(() => normalizePartyMedia({...media,title}));
});

test('snapshot normalization requires bounded authoritative state and safe membership and removes tokens',() => {
  const input = snapshot(); input.room.joinToken='secret'; input.room.members.host.secret='secret';
  const clean = normalizePartySnapshot(input);
  assert.deepEqual(clean,snapshot()); assert.notEqual(clean.room,input.room);
  for (const change of [{revision:0},{revision:1.5},{id:'short'},{role:'owner'},{expiresAt:Infinity},{members:{host:member}},{state:state({position:1801})},{state:state({rate:2})},{state:state({phase:'paused'})},{state:state({wantsPlay:false})}]) assert.throws(() => normalizePartySnapshot(snapshot(change)),/invalid/);
  for (const bad of [null,[],{serverTime:NaN,room:snapshot().room},{serverTime:epoch,room:{...snapshot().room,members:{host:{...member,position:'20'},guest:null}}}]) assert.throws(() => normalizePartySnapshot(bad),/invalid/);
  assert.equal(normalizePartySnapshot(snapshot({members:{host:member,guest:null}})).room.members.guest,null);
});

test('updates reject stale revisions, another session and equal-revision anchor mutation',() => {
  const previous = snapshot();
  assert.equal(partyUpdateIsNewer(previous),true);
  assert.equal(partyUpdateIsNewer(previous,previous),false);
  assert.equal(partyUpdateIsNewer({...previous,serverTime:epoch+200},previous),true);
  assert.equal(partyUpdateIsNewer({...previous,serverTime:epoch+50},previous),false);
  assert.equal(partyUpdateIsNewer({...snapshot({revision:2}),serverTime:previous.serverTime},previous),true,'A command may advance revision within the same server millisecond.');
  assert.equal(partyUpdateIsNewer({...snapshot({revision:2}),serverTime:epoch+50},previous),false);
  for (const change of [{id:'ponmlkjihgfedcba'},{role:'guest'},{state:state({position:21})},{state:state({at:epoch+1})},{state:state({reason:'mutated'})},{media:{...media,identity:{...identity,size:identity.size+1}}}]) assert.equal(partyUpdateIsNewer({...snapshot(change),serverTime:epoch+200},previous),false);
  const scheduled = {...snapshot({state:state({phase:'scheduled',at:epoch+2000})}),serverTime:epoch+100};
  const playing = {...snapshot({state:state({at:epoch+2000})}),serverTime:epoch+2100};
  assert.equal(partyUpdateIsNewer(playing,scheduled),true);
  assert.equal(partyUpdateIsNewer({...scheduled,serverTime:epoch+2200},playing),false);
  assert.equal(partyUpdateIsNewer(null,previous),false);
});

test('clock uses monotonic midpoints and quickest recent RTT samples instead of delayed polls',() => {
  let now = 1000;
  const clock = createPartyClock({now:() => now});
  assert.equal(clock.now(),null); assert.equal(clock.stats().ready,false);
  assert.equal(clock.sample({sentAt:1000,receivedAt:1040,serverTime:epoch+1020}),true);
  now = 1040; assert.equal(clock.now(),epoch+1040); assert.equal(clock.stats().uncertaintyMs,20);
  assert.equal(clock.sample({sentAt:1100,receivedAt:1140,serverTime:epoch+1122}),true);
  assert.equal(clock.sample({sentAt:1200,receivedAt:2200,serverTime:epoch+2000}),true);
  now = 2200;
  assert.equal(clock.now(),epoch+2201,'The long delayed response does not drag the clock 300ms forward.');
  assert.equal(clock.stats().rttMs,40); assert.equal(clock.stats().samples,2); assert.equal(clock.stats().uncertaintyMs,21);
  // A wall-clock adjustment cannot enter the API: only monotonic timestamps are used.
  const realDateNow = Date.now;
  try { Date.now = () => 0; now = 2300; assert.equal(clock.now(),epoch+2301); }
  finally { Date.now = realDateNow; }
});

test('clock rejects bad or out-of-order measurements and expires samples until renewed',() => {
  let now = 0;
  const clock = createPartyClock({now:() => now,maxSamples:3});
  for (const sample of [{sentAt:20,receivedAt:10,serverTime:epoch},{sentAt:0,receivedAt:10001,serverTime:epoch},{sentAt:NaN,receivedAt:20,serverTime:epoch},{sentAt:0,receivedAt:20,serverTime:Infinity}]) assert.equal(clock.sample(sample),false);
  clock.sample({sentAt:0,receivedAt:20,serverTime:epoch+10}); now=20;
  assert.equal(clock.sample({sentAt:0,receivedAt:10,serverTime:epoch+5}),false);
  assert.equal(clock.now(),epoch+20);
  now=30021; assert.equal(clock.now(),null); assert.equal(clock.stats().ready,false);
  clock.sample({sentAt:30021,receivedAt:30041,serverTime:epoch+30031}); now=30041;
  assert.equal(clock.now(),epoch+30041); assert.equal(clock.stats().samples,1);
  clock.reset(); assert.equal(clock.now(),null);
  assert.throws(() => createPartyClock({maxSamples:0}));
});

test('timeline keeps both guests parked until the scheduled server instant and clamps the ending',() => {
  const scheduled = state({phase:'scheduled',position:50,at:epoch+2000});
  assert.equal(partyTargetTime(scheduled,epoch),50);
  assert.equal(partyTargetTime(scheduled,epoch+2000),50);
  assert.equal(partyTargetTime(scheduled,epoch+2300),50.3);
  assert.equal(partyTargetTime(state({position:1799}),epoch+10000,{duration:1800}),1800);
  assert.equal(partyTargetTime(state({phase:'paused',playing:false,wantsPlay:false,position:123}),epoch+10000),123);
  const hold = partyDriftCorrection({state:scheduled,serverNow:epoch,currentTime:0,duration:1800});
  assert.deepEqual(hold,{target:50,drift:50,timeToStartMs:2000,shouldPlay:false,seekTo:50,playbackRate:1,reason:'scheduled'});
  assert.equal(partyDriftCorrection({state:scheduled,serverNow:epoch+2000,currentTime:50,duration:1800}).shouldPlay,true);
});

test('sync correction seeks large drift, nudges smaller drift and restores normal rate within tolerance',() => {
  function correct(currentTime) { return partyDriftCorrection({state:state(),serverNow:epoch,currentTime,duration:1800}); }
  assert.equal(correct(19).seekTo,20); assert.equal(correct(21).seekTo,20);
  assert.equal(correct(19.4).seekTo,null); assert.equal(correct(19.4).playbackRate,1.05);
  assert.equal(correct(20.6).playbackRate,0.95);
  assert.equal(correct(19.85).playbackRate,1.03);
  assert.equal(correct(20.15).playbackRate,0.97);
  assert.equal(correct(19.9).reason,'in-sync'); assert.equal(correct(19.9).playbackRate,1);
  const paused = partyDriftCorrection({state:state({phase:'paused',playing:false,wantsPlay:false}),serverNow:epoch,currentTime:19.8,duration:1800});
  assert.equal(paused.shouldPlay,false); assert.equal(paused.seekTo,20); assert.equal(paused.playbackRate,1);
});

test('loading, autoplay, buffering and seeking gates never recommend playback or additional seeks',() => {
  for (const [flag,reason] of [['ready','loading'],['autoplayBlocked','autoplay-blocked'],['buffering','buffering'],['seeking','seeking']]) {
    const correction = partyDriftCorrection({state:state(),serverNow:epoch,currentTime:0,duration:1800,[flag]:flag !== 'ready'});
    assert.equal(correction.shouldPlay,false); assert.equal(correction.seekTo,null); assert.equal(correction.playbackRate,1); assert.equal(correction.reason,reason);
  }
  assert.equal(partyDriftCorrection({state:state({position:1799}),serverNow:epoch+2000,currentTime:1799,duration:1800}).reason,'ended');
  assert.throws(() => partyDriftCorrection({state:state(),serverNow:epoch,currentTime:NaN}));
  assert.throws(() => partyTargetTime(state(),NaN));
});

test('a tolerated decoder duration difference clamps the ending without weakening room validation',() => {
  const ended = state({phase:'ended',playing:false,wantsPlay:false,position:120,reason:'Finished.'});
  const room = snapshot({media:{...media,duration:120},state:ended,members:{host:{...member,position:120},guest:{...member,position:119.5}}});
  assert.equal(normalizePartySnapshot(room).room.state.position,120);
  assert.equal(partyTargetTime(ended,epoch+1000,{duration:119.5}),119.5);
  const short = partyDriftCorrection({state:ended,serverNow:epoch+1000,currentTime:119,duration:119.5});
  assert.equal(short.target,119.5); assert.equal(short.seekTo,119.5);
  assert.equal(short.shouldPlay,false); assert.equal(short.reason,'ended');
  const arrived = partyDriftCorrection({state:ended,serverNow:epoch+1000,currentTime:119.5,duration:119.5});
  assert.equal(arrived.seekTo,null); assert.equal(arrived.shouldPlay,false);
  const playingEnd = partyDriftCorrection({state:state({position:119.75}),serverNow:epoch+1000,currentTime:119.5,duration:119.5});
  assert.equal(playingEnd.shouldPlay,false); assert.equal(playingEnd.reason,'ended');
  assert.throws(() => normalizePartySnapshot({...room,room:{...room.room,state:{...ended,position:120.01}}}),/invalid/);
  assert.throws(() => partyTargetTime({...ended,position:86401},epoch,{duration:119.5}),/invalid/);
});

test('two clocks with unequal poll delays converge to the shared timeline after start, seek and pause',() => {
  const clockA = createPartyClock(), clockB = createPartyClock();
  clockA.sample({sentAt:1000,receivedAt:1040,serverTime:epoch+1020});
  clockB.sample({sentAt:6000,receivedAt:6120,serverTime:epoch+1060});
  // Clock B's performance origin is five seconds ahead; it still estimates the
  // same server time. Run actual correction recommendations against media-time
  // models, including one slightly slow decoder and a 450ms initial drift.
  let room = state({phase:'scheduled',position:10,at:epoch+2000});
  const players = [{clock:clockA,origin:0,time:10,rate:1,playing:false,decoder:1},{clock:clockB,origin:5000,time:9.55,rate:1,playing:false,decoder:0.999}];
  for (let elapsed=1200;elapsed<=21000;elapsed+=100) {
    if (elapsed === 10000) room=state({position:700,at:epoch+elapsed});
    if (elapsed === 17000) room=state({phase:'paused',playing:false,wantsPlay:false,position:707,at:epoch+elapsed});
    for (const player of players) {
      const correction=partyDriftCorrection({state:room,serverNow:player.clock.now(elapsed+player.origin),currentTime:player.time,duration:1800});
      if (correction.seekTo !== null) player.time=correction.seekTo;
      player.rate=correction.playbackRate; player.playing=correction.shouldPlay;
      if (player.playing) player.time += 0.1*player.rate*player.decoder;
      if (elapsed < 2000) assert.equal(player.playing,false);
    }
  }
  assert.ok(Math.abs(players[0].time-players[1].time) < 0.12);
  assert.ok(Math.abs(players[0].time-707) < 0.12);
  assert.ok(players.every(player => !player.playing && player.rate === 1));
});

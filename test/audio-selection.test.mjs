import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceHints, normalizeSources } from '../public/source-client.js';
import { preferredSource, recommendAutomaticSource } from '../public/discover.js';
import { normalizeIndexRows } from '../lib/source-lookup.mjs';
import { Discovery } from '../lib/discovery.mjs';

const H1='a'.repeat(40), H2='b'.repeat(40), ID='tt1160419';

test('H.264 plus AAC is strongly preferred for browser playback', () => {
  const friendly=sourceHints({videoCodec:'H264',audioCodecs:['AAC'],resolution:'1080p'});
  const risky=sourceHints({videoCodec:'H264',audioCodecs:['EAC3'],resolution:'1080p'});
  assert.equal(friendly.browserFriendly,true); assert.equal(friendly.audioRisk,false);
  assert.equal(risky.browserFriendly,false); assert.equal(risky.audioRisk,true);
  assert.ok(friendly.score > risky.score + 100);
});

test('Dolby and DTS names are recognized as possible silent-audio risks', () => {
  for (const audio of ['E-AC-3','AC3','DDP','Dolby Digital Plus','Dolby Atmos','DTS-HD','TrueHD']) {
    const h=sourceHints({videoCodec:'H264',audioCodecs:[audio]});
    assert.equal(h.audioRisk,true, audio); assert.ok(/silent/i.test(h.hint));
  }
});

test('Zilean structured codec metadata survives normalization', () => {
  const [s]=normalizeIndexRows([{info_hash:H1,imdb_id:ID,raw_title:'Fixture',resolution:'1080p',codec:'H264',audio:['AAC']}],{type:'movie',id:ID});
  assert.equal(s.videoCodec,'H264'); assert.deepEqual(s.audioCodecs,['AAC']); assert.equal(s.resolution,'1080p'); assert.equal(s.browserFriendly,true);
});

test('source normalization retains safe structured codec fields only', () => {
  const [s]=normalizeSources([{hash:H1,title:'Fixture',videoCodec:'H264',audioCodecs:['AAC','private\ntext'],resolution:'1080p',secret:'sentinel'}]);
  assert.equal(s.videoCodec,'H264'); assert.equal(s.audioCodecs.length,2); assert.ok(!JSON.stringify(s).includes('sentinel'));
});

test('preferred source chooses cached browser-friendly audio over cached Dolby audio', () => {
  const list=[
    {id:'dolby',cached:true,audioRisk:true,browserFriendly:false},
    {id:'aac',cached:true,audioRisk:false,browserFriendly:true},
    {id:'unknown',cached:true,audioRisk:false,browserFriendly:false}
  ];
  assert.equal(preferredSource(list).id,'aac');
});


test('known H.264/AAC beats cached codec-unknown audio', () => {
  const list=[
    {id:'unknown-cached',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,resolution:'720p',score:200,size:500*1024**2},
    {id:'aac-uncached',cached:false,audioRisk:false,videoRisk:false,browserFriendly:true,resolution:'720p',score:0,size:600*1024**2}
  ];
  assert.equal(preferredSource(list).id,'aac-uncached');
});

test('preferred source chooses browser-friendly source even when it needs preparation', () => {
  const list=[
    {id:'risky',cached:true,audioRisk:true,browserFriendly:false},
    {id:'aac',cached:false,audioRisk:false,browserFriendly:true}
  ];
  assert.equal(preferredSource(list).id,'aac');
});

test('registration compatibility outranks cache convenience', async () => {
  const catalog={meta:async()=>({id:ID,type:'movie',name:'Fixture',episodes:[]})};
  const gateway={cached:async()=>({[H1]:true,[H2]:false})};
  const d=new Discovery({catalog,gateway});
  const result=await d.register({target:{type:'movie',id:ID},sources:[
    {hash:H1,title:'Dolby',videoCodec:'H264',audioCodecs:['EAC3'],resolution:'1080p'},
    {hash:H2,title:'AAC',videoCodec:'H264',audioCodecs:['AAC'],resolution:'1080p'}
  ]},'s');
  assert.equal(result.sources[0].title,'AAC'); assert.equal(result.sources[0].browserFriendly,true);
});

test('ready risky source is identified before silent playback', async () => {
  const item={id:7,hash:H1,name:'Fixture',download_finished:true,download_present:true,files:[{id:2,name:'Fixture.mp4',size:100,mimetype:'video/mp4'}]};
  const catalog={meta:async()=>({id:ID,type:'movie',name:'Fixture',episodes:[]})};
  const gateway={cached:async()=>({[H1]:true}),find:async()=>item,item:async()=>item,create:async()=>7};
  const d=new Discovery({catalog,gateway});
  const registered=await d.register({target:{type:'movie',id:ID},sources:[{hash:H1,title:'Dolby',videoCodec:'H264',audioCodecs:['EAC3']}]},'s');
  const status=await d.prepare(registered.sources[0].id,'s');
  assert.equal(status.state,'ready'); assert.equal(status.compatibility.audioRisk,true); assert.ok(/silently/i.test(status.message));
});

test('automatic playback refuses codec-unknown and known-risk audio when no H.264/AAC source is available', () => {
  const list=[
    {id:'unknown',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,resolution:'720p',score:500,size:400*1024**2},
    {id:'dolby',cached:true,audioRisk:true,videoRisk:false,browserFriendly:false,resolution:'720p',score:900,size:350*1024**2}
  ];
  assert.equal(recommendAutomaticSource(list,'movie','auto'),null);
});
test('automatic playback accepts a locally sound-confirmed source with incomplete provider codec metadata', () => {
  const source={id:'confirmed',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,memoryAudio:'good',resolution:'720p',score:0,size:500*1024**2};
  assert.equal(recommendAutomaticSource([source],'movie','auto')?.id,'confirmed');
});
test('Chrome decoded-audio watchdog is wired to no-sound recovery', async () => {
  const {readFile}=await import('node:fs/promises');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(app,/webkitAudioDecodedByteCount/);
  assert.match(app,/audio_decode_watchdog/);
  assert.match(app,/rejectCurrentSource\('audio'\)/);
});

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


test('a cached risk-free source beats an uncached H.264/AAC source', () => {
  // Physical Android evidence: cached sources play, uncached sources sit in "Preparing" because
  // TorBox has to download them first. Preferring an uncached source for better expected audio
  // trades working playback for a codec guess, so cached availability is screened first and audio
  // preference decides within it. Known-risky audio is still excluded from every cached tier.
  const list=[
    {id:'unknown-cached',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,resolution:'720p',score:200,size:500*1024**2},
    {id:'aac-uncached',cached:false,audioRisk:false,videoRisk:false,browserFriendly:true,resolution:'720p',score:0,size:600*1024**2}
  ];
  assert.equal(preferredSource(list).id,'unknown-cached');
});
test('cached availability never outranks known-risky audio', () => {
  const list=[
    {id:'dolby-cached',cached:true,audioRisk:true,videoRisk:false,browserFriendly:false,resolution:'720p',score:900,size:400*1024**2},
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

test('automatic playback falls back to codec-unknown audio before known-risk audio', () => {
  const list=[
    {id:'unknown',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,resolution:'720p',score:500,size:400*1024**2},
    {id:'dolby',cached:true,audioRisk:true,videoRisk:false,browserFriendly:false,resolution:'720p',score:900,size:350*1024**2}
  ];
  assert.equal(recommendAutomaticSource(list,'movie','auto')?.id,'unknown');
});

test('automatic playback takes a cached codec-unknown source over an uncached browser-friendly one', () => {
  // Observed live: the cache check reported 7 cached sources and Play still started a download,
  // because the codec-confidence tiers were applied before cache availability and a browser-friendly
  // uncached source won the first tier outright.
  const list=[
    {id:'cached-unknown',cached:true,audioRisk:false,videoRisk:false,browserFriendly:false,resolution:'720p',score:0,size:400*1024**2},
    {id:'uncached-aac',cached:false,audioRisk:false,videoRisk:false,browserFriendly:true,resolution:'720p',score:400,size:450*1024**2}
  ];
  assert.equal(recommendAutomaticSource(list,'series','auto')?.id,'cached-unknown');
});
test('automatic playback still refuses a cached known-risk source in favour of an uncached safe one', () => {
  const list=[
    {id:'cached-dolby',cached:true,audioRisk:true,videoRisk:false,browserFriendly:false,resolution:'720p',score:900,size:400*1024**2},
    {id:'uncached-aac',cached:false,audioRisk:false,videoRisk:false,browserFriendly:true,resolution:'720p',score:0,size:450*1024**2}
  ];
  assert.equal(recommendAutomaticSource(list,'series','auto')?.id,'uncached-aac');
});
test('automatic playback keeps one-tap behavior even when only a known-risk source remains', () => {
  const risky={id:'dolby-only',cached:true,audioRisk:true,videoRisk:false,browserFriendly:false,resolution:'720p',score:100,size:400*1024**2};
  assert.equal(recommendAutomaticSource([risky],'movie','auto')?.id,'dolby-only');
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
  // The probe is armed once, when playback starts. A stream that has not advanced four seconds of
  // media time inside the probe window used to abandon the check permanently, so a slow start meant
  // a Dolby/DTS source played silently forever with no automatic recovery. It must re-arm, and it
  // must be bounded so a stalled stream cannot loop.
  assert.match(app,/audioProbeTries/);
  assert.match(app,/if\(advanced<4\)\{[^}]*armAudioProbe\(\);return;\}/);
});

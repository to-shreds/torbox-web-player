import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { audioCodecHints, sourceHints, preparedSourceCompatibility } from '../public/source-client.js';
import { normalizeStremioStreams } from '../lib/source-lookup.mjs';
import { Discovery } from '../lib/discovery.mjs';
import { recommendSource, automaticCachedSourceOrder, recoverySourceOrder, validatePreparedSource, isAutomaticCandidateFailure, selectAutomaticVideoFile } from '../public/discover.js';

const target={type:'series',id:'tt33043892',season:1,episode:2};
function source(hash,filename,extra={}){
  const value={hash:hash.repeat(40),filename,title:filename,cached:true,cachedBrowserPlayable:true,languages:[],...extra};
  return {...value,...sourceHints(value)};
}

for(const [tag,codec,risk] of [['DDP5.1','EAC3',true],['DD5.1','AC3',true],['EAC3.5.1','EAC3',true],['DTS5.1','DTS',true],['TrueHD7.1','TrueHD',true],['AAC2.0','AAC',false],['DD+5.1','EAC3',true]]){
  test(`audio codec ${tag} survives attached channel notation`,()=>{
    const filename=`Dexter.Resurrection.S01E02.H264.${tag}.mkv`;
    const [row]=normalizeStremioStreams({streams:[{infoHash:'a'.repeat(40),behaviorHints:{filename},title:filename}]},target,'Fixture');
    assert.ok(row.audioCodecs.includes(codec));
    assert.equal(row.audioRisk,risk);
    assert.equal(sourceHints({filename}).audioRisk,risk);
  });
}
test('codec-like fragments in ordinary words do not attest sound',()=>{
  assert.deepEqual(audioCodecHints('aaccurate ddpeople truehddrive opuscular surrounddd5.1'),[]);
});
test('confirmed device sound outranks an English label with unknown audio',()=>{
  const confirmed=source('a','Episode.H264.mp4',{memoryAudio:'good',languages:[]});
  const english=source('b','Episode.H264.mkv',{languages:['en'],score:100000});
  assert.equal(recommendSource([english,confirmed],'series','auto','balanced').hash,confirmed.hash);
});
test('compatible AAC outranks English-only unknown-audio MKV',()=>{
  const aac=source('a','Episode.H264.AAC2.0.mp4');
  const english=source('b','Episode.H264.mkv',{languages:['en']});
  assert.equal(recommendSource([english,aac],'series','auto','balanced').hash,aac.hash);
});
test('automatic selection omits known codec risks and known foreign-only audio',()=>{
  const aac=source('a','Episode.H264.AAC.mp4');
  const dolby=source('b','Episode.H264.DDP5.1.mkv',{languages:['en']});
  const hevc=source('c','Episode.HEVC.AAC.mkv',{languages:['en']});
  const foreign=source('d','Episode.H264.AAC.mp4',{languages:['fr']});
  assert.deepEqual(automaticCachedSourceOrder([dolby,hevc,foreign,aac],'series','auto','balanced').map(row=>row.hash),[aac.hash]);
});
test('audio recovery checks compatible or user-confirmed sound before unknown metadata',()=>{
  const current=source('a','Current.H264.mkv');
  const unknown=source('b','Other.H264.mkv',{languages:['en']});
  const aac=source('c','Alternative.H264.AAC.mp4');
  const confirmed=source('d','Confirmed.H264.mkv',{memoryAudio:'good'});
  const context={sourceInfo:current,current:target,audioRecovery:true};
  assert.deepEqual(recoverySourceOrder([current,unknown,aac,confirmed],context,'series','balanced').map(row=>row.hash),[confirmed.hash,aac.hash,unknown.hash]);
});
test('audio recovery checks compatible 1080p sound before unknown 720p audio',()=>{
  const current=source('a','Current.720p.H264.mkv');
  const unknown=source('b','Other.720p.H264.mkv');
  const aac=source('c','Alternative.1080p.H264.AAC.mp4');
  const context={sourceInfo:current,current:target,resolution:'720p',audioRecovery:true};
  assert.deepEqual(recoverySourceOrder([current,unknown,aac],context,'series','balanced').map(row=>row.hash),[aac.hash,unknown.hash]);
});
test('prepared file Dolby metadata overrides an unknown or misleading AAC provider description',()=>{
  const row=source('a','Episode.H264.AAC.mkv');
  const result={file:{title:'Episode.H264.DDP5.1.mkv'},compatibility:{audioRisk:false}};
  const compatibility=preparedSourceCompatibility(row,result.file,result.compatibility);
  assert.equal(compatibility.audioRisk,true);assert.equal(compatibility.audioCompatible,false);
  assert.throws(()=>validatePreparedSource(row,result,{unattended:true}),error=>error.code==='BROWSER_AUDIO_UNSUPPORTED'&&isAutomaticCandidateFailure(error));
  assert.equal(validatePreparedSource(row,result).audioRisk,true,'manual choice retains truthful risk evidence');
});
test('prepared metadata retains provider codec risks even when actual filename is generic',()=>{
  const row=source('a','Episode.H264.DDP5.1.mkv');
  assert.equal(preparedSourceCompatibility(row,{title:'Episode.mkv'}).audioRisk,true);
  assert.throws(()=>validatePreparedSource(source('b','Episode.H264.AAC.mkv'),{file:{title:'Episode.mkv'},compatibility:{audioRisk:true}},{unattended:true}),{code:'BROWSER_AUDIO_UNSUPPORTED'});
});
test('a stale ready result cannot bypass actual-file container or video risks',()=>{
  const row=source('a','Episode.H264.AAC.mp4');
  assert.throws(()=>validatePreparedSource(row,{file:{title:'Episode.H264.AAC.avi'}},{unattended:true}),{code:'BROWSER_CONTAINER_UNSUPPORTED'});
  assert.throws(()=>validatePreparedSource(row,{file:{title:'Episode.HEVC.AAC.mp4'}},{unattended:true}),{code:'BROWSER_VIDEO_UNSUPPORTED'});
});
test('prepared audio recovery requires positive evidence and does not mistake container for sound',()=>{
  const row=source('a','Episode.H264.mkv');
  assert.throws(()=>validatePreparedSource(row,{file:{title:'Episode.mkv'}},{unattended:true,requireCompatibleAudio:true}),{code:'AUDIO_COMPATIBILITY_UNCONFIRMED'});
  assert.equal(validatePreparedSource(row,{file:{title:'Episode.H264.AAC2.0.mkv'}},{unattended:true,requireCompatibleAudio:true}).audioCompatible,true);
});
test('file selection chooses an AAC MKV over a Dolby MP4 or unknown-audio MP4',()=>{
  const dolby={id:'dolby',title:'Episode.H264.DDP5.1.mp4'};
  const unknown={id:'unknown',title:'Episode.H264.mp4'};
  const aac={id:'aac',title:'Episode.H264.AAC2.0.mkv'};
  assert.equal(selectAutomaticVideoFile([dolby,unknown,aac]).id,'aac');
  assert.equal(selectAutomaticVideoFile([dolby]),null);
});
test('real saved provider metadata no longer admits codec-risk sources into automatic order',async()=>{
  const raw=JSON.parse(await readFile(new URL('./fixtures/dexter-resurrection-s01e02-streams.json',import.meta.url)));
  const rows=normalizeStremioStreams(raw,raw.target,raw.provider).map(row=>({...row,cached:true,cachedBrowserPlayable:true}));
  const order=automaticCachedSourceOrder(rows,'series','auto','balanced');
  assert.ok(order.length>0);assert.ok(order.every(row=>!row.audioRisk&&!row.videoRisk));
  const known=rows.filter(row=>sourceHints(row).audioCompatible&&!row.videoRisk&&(!row.languages.length||row.languages.includes('en')));
  if(known.length)assert.equal(sourceHints(order[0]).audioCompatible,true);
});
test('TorBox selected filename adds audio risk before frontend playback',async()=>{
  const hash='a'.repeat(40),filename='Dexter.Resurrection.S01E02.H264.mkv';
  const discovery=new Discovery({catalog:{meta:async()=>({...target,name:'Dexter: Resurrection',year:'2025',episodes:[{season:1,episode:2,released:'2025-07-18'}]})},gateway:{
    cached:async()=>({[hash]:{cached:true,files:[{name:filename}]}}),find:async()=>null,create:async()=>42,
    item:async()=>({id:42,hash,name:'Dexter Resurrection',download_finished:true,download_present:true,files:[{id:7,name:'Dexter.Resurrection.S01E02.H264.DDP5.1.mkv',mimetype:'video/x-matroska',size:100}]})
  }});
  const registered=await discovery.register({target,sources:[{infoHash:hash,filename}]},'owner');
  const result=await discovery.prepare(registered.sources[0].id,'owner',true);
  assert.equal(result.state,'ready');assert.equal(result.compatibility.audioRisk,true);
  assert.ok(result.compatibility.audioCodecs.includes('EAC3'));
  assert.match(result.message,/may play silently/);
});

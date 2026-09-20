import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { automaticPreparedFile, autoNextSourceOrder, episodeQueue } from '../public/discover.js';

const source=(id,extra={})=>({
  id,
  hash:(id.repeat(40)).slice(0,40),
  title:id,
  cached:true,
  browserFriendly:true,
  audioRisk:false,
  videoRisk:false,
  resolution:'720p',
  score:0,
  size:500*1024**2,
  ...extra
});

test('auto-next queue advances to the next released episode',()=>{
  const meta={id:'tt1234567',episodes:[
    {season:1,episode:1,name:'One',released:'2026-01-01T00:00:00Z'},
    {season:1,episode:2,name:'Two',released:'2026-01-02T00:00:00Z'},
    {season:1,episode:3,name:'Three',released:'2027-01-01T00:00:00Z'}
  ]};
  const queue=episodeQueue(meta,{type:'series',id:meta.id,season:1,episode:1},Date.parse('2026-09-19T00:00:00Z'));
  assert.deepEqual(queue.map(x=>[x.season,x.episode]),[[1,2]]);
});

test('unattended pack selection deterministically chooses the largest matching episode file',()=>{
  const picked=automaticPreparedFile([
    {id:'torrents:1:2',title:'Show.S01E02.sample.mp4',size:120*1024**2},
    {id:'torrents:1:3',title:'Show.S01E02.mp4',size:720*1024**2},
    {id:'torrents:1:4',title:'Show.S01E02.alt.mp4',size:650*1024**2}
  ]);
  assert.equal(picked.id,'torrents:1:3');
});

test('auto-next never silently falls back to known-risk audio',()=>{
  const safe=source('s',{resolution:'720p',browserFriendly:true,audioRisk:false,score:10});
  const risky=source('r',{resolution:'720p',browserFriendly:false,audioRisk:true,score:200});
  const ordered=autoNextSourceOrder([risky,safe],'720p','balanced');
  assert.equal(ordered[0].id,'s');
  assert.equal(ordered.some(row=>row.id==='r'),false);
});

test('auto-next falls back from a fixed quality to other available qualities',()=>{
  const preferred=source('a',{resolution:'1080p',size:900*1024**2});
  const fallback=source('b',{resolution:'720p',size:500*1024**2});
  const ordered=autoNextSourceOrder([fallback,preferred],'1080p','balanced');
  assert.equal(ordered[0].id,'a');
  assert.ok(ordered.some(row=>row.id==='b'));
});

test('ended playback schedules auto-next and playNext retries ranked sources instead of rejecting audio-risk outright',async()=>{
  const [app,discover]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/discover.js',import.meta.url),'utf8')
  ]);
  assert.match(app,/video\.addEventListener\('ended',[\s\S]*scheduleNextEpisode\(context\)/);
  assert.match(discover,/const candidates=autoNextSourceOrder\(registered\.sources,context\.resolution\|\|'auto'\)/);
  assert.match(discover,/for\(const source of candidates\)/);
  assert.match(discover,/if\(moved\)return true/);
  assert.doesNotMatch(discover,/if\(!best\|\|best\.audioRisk\)return false/);
  assert.doesNotMatch(discover,/unattended&&result\.files\.length!==1/);
});

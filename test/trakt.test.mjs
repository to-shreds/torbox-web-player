import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { traktMedia, traktScrobbleObject, normalizeTraktHistory, normalizeTraktPlayback, mergeContinueWatching } from '../public/trakt.js';
const show='tt0903747',film='tt0133093';
const watched=[
  {type:'episode',watched_at:'2026-10-18T14:00:00Z',show:{title:'Show A',ids:{imdb:show}},episode:{season:2,number:3,title:'Episode 3'}},
  {type:'episode',watched_at:'2026-10-17T14:00:00Z',show:{title:'Show A',ids:{imdb:show}},episode:{season:2,number:3,title:'Episode 3'}},
  {type:'movie',watched_at:'2026-10-16T14:00:00Z',movie:{title:'Movie A',ids:{imdb:film}}}
];
test('movie and show identity require exact IMDb and S/E, never guess episodes',()=>{
  assert.deepEqual(traktMedia({current:{type:'movie',id:film}}),{type:'movie',id:film});
  assert.deepEqual(traktMedia({current:{type:'series',id:show,season:2,episode:3}}),{type:'series',id:show,season:2,episode:3});
  assert.equal(traktMedia({current:{type:'series',id:show,season:2}}),null);
  assert.equal(traktMedia({current:{type:'series',id:'not-imdb',season:2,episode:3}}),null);
  assert.equal(traktMedia({current:{type:'series',id:show,season:2,episode:0}}),null);
});
test('scrobbles identify specific Trakt episode, not show IMDb ID',()=>{
  const ep={type:'series',id:show,season:2,episode:3};
  assert.equal(traktScrobbleObject(ep),null);
  assert.deepEqual(traktScrobbleObject(ep,{ids:{trakt:123456}}),{episode:{ids:{trakt:123456}}});
  assert.deepEqual(traktScrobbleObject({type:'movie',id:film}),{movie:{ids:{imdb:film}}});
});
test('watched history drops duplicate plays, invalid IDs and missing timestamps',()=>{
  const result=normalizeTraktHistory([...watched,{type:'movie',movie:{title:'Other',ids:{imdb:'bad'}},watched_at:'2026-10-15T14:00:00Z'}]);
  assert.equal(result.length,2);
  assert.equal(result[0].key,'series:'+show+':2:3');
  assert.equal(result[0].updatedAt,Date.parse('2026-10-18T14:00:00Z'));
  assert.equal(result[0].completed,true);
  assert.equal(result[1].key,'movie:'+film);
});
test('remote in-progress records remain distinct from completed watches',()=>{
  const result=normalizeTraktPlayback([
    {type:'episode',progress:45.5,paused_at:'2026-10-19T14:00:00Z',show:{title:'Show A',ids:{imdb:show}},episode:{season:2,number:3}},
    {type:'movie',progress:100,paused_at:'2026-10-19T10:00:00Z',movie:{title:'Movie A',ids:{imdb:film}}},
    {type:'movie',progress:0,paused_at:'2026-10-19T10:00:00Z',movie:{title:'Movie A',ids:{imdb:film}}}
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].traktPercent,45.5);
  assert.equal(result[0].position,0);
  assert.equal(result[0].duration,0);
  assert.equal(result[0].completed,false);
});
test('remote progress never replaces the exact same local progress record',()=>{
  const local={key:'series:'+show+':2:3',id:show,type:'series',season:2,episode:3,position:450,duration:900,updatedAt:10,completed:false};
  const remote={...local,updatedAt:20,traktPercent:80,position:0,duration:0};
  assert.deepEqual(mergeContinueWatching([local],[remote],6),[local]);
});
test('remote playback can supplement local titles, with no duplicate show cards',()=>{
  const local={key:'movie:'+film,id:film,type:'movie',position:150,duration:1000,updatedAt:10,completed:false};
  const remote={key:'series:'+show+':2:3',id:show,type:'series',season:2,episode:3,traktPercent:50,updatedAt:20,completed:false};
  assert.deepEqual(mergeContinueWatching([local],[remote],6),[remote,local]);
});
test('Trakt cannot start without explicit user authorization, and stays outside Render/media transport',async()=>{
  const [trakt,html,app,sw]=await Promise.all([
    readFile(new URL('../public/trakt.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/sw.js',import.meta.url),'utf8')
  ]);
  assert.ok(trakt.includes('code_challenge_method'));
  assert.ok(trakt.includes('code_verifier'));
  assert.ok(trakt.includes("'/scrobble/'+action"));
  assert.ok(trakt.includes('sessionStorage.setItem(PENDING_KEY'));
  assert.ok(trakt.includes('loadTraktCredentials'));
  assert.ok(!trakt.includes('/api/trakt'));
  assert.ok(html.includes('id="trakt-scrobble-toggle"'));
  assert.ok(html.includes('id="trakt-connect"'));
  assert.ok(html.includes('https://api.trakt.tv; media-src'));
  assert.ok(app.includes('trakt.playing(context)'));
  assert.ok(app.includes('trakt.stopped(context,true)'));
  assert.ok(sw.includes('trakt-vault.js?v='));
});
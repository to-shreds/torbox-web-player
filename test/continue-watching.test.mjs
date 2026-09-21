import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { continueWatchingItems, recordRecent, removeRecentTitle, listRecent } from '../public/history.js';

const row=(key,extra={})=>({
  key,type:key.startsWith('series:')?'series':'movie',
  id:key.split(':')[1],season:key.startsWith('series:')?Number(key.split(':')[2]):null,
  episode:key.startsWith('series:')?Number(key.split(':')[3]):null,
  title:'Fixture',episodeName:'Episode',poster:'',resolution:'auto',
  position:100,duration:1000,completed:false,updatedAt:1,...extra
});

test('Continue Watching keeps only the newest entry for each show',()=>{
  const rows=[
    row('series:tt1111111:1:1',{updatedAt:10,episodeName:'Older'}),
    row('series:tt1111111:1:2',{updatedAt:30,episodeName:'Newest'}),
    row('series:tt2222222:2:1',{updatedAt:20,episodeName:'Other'})
  ];
  assert.deepEqual(continueWatchingItems(rows,10).map(x=>x.episodeName),['Newest','Other']);
});

test('a completed newest episode suppresses older unfinished episodes from the same show',()=>{
  const rows=[
    row('series:tt1111111:1:1',{updatedAt:10,completed:false}),
    row('series:tt1111111:1:2',{updatedAt:30,completed:true}),
    row('movie:tt3333333',{updatedAt:20,completed:false,title:'Movie'})
  ];
  const result=continueWatchingItems(rows,10);
  assert.deepEqual(result.map(x=>x.key),['movie:tt3333333']);
});

test('Continue Watching remains bounded after show-level deduplication',()=>{
  const rows=[
    row('series:tt1111111:1:2',{updatedAt:50}),
    row('series:tt2222222:1:2',{updatedAt:40}),
    row('series:tt3333333:1:2',{updatedAt:30})
  ];
  assert.equal(continueWatchingItems(rows,2).length,2);
});

test('Continue Watching UI never offers finished-title mode and supports long-press title navigation',async()=>{
  const [html,app,discover]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/discover.js',import.meta.url),'utf8')
  ]);
  assert.ok(!html.includes('setting-show-completed-recent'));
  assert.ok(!app.includes('showCompletedRecent'));
  assert.ok(app.includes('continueWatchingItems(listRecent(),settings.recentLimit)'));
  assert.ok(app.includes('discoveryUI.openHistoryTitle(item)'));
  assert.ok(discover.includes('async function openHistoryTitle(entry)'));
  assert.ok(discover.includes('renderEpisodes(currentMeta,preferredSeason)'));
  assert.ok(discover.includes('seasons.includes(preferredSeason)'));
});
test('removing a show-level Continue Watching card removes every stored episode for that show',()=>{
  const map=new Map(),store={getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
  const context=(id,season,episode)=>({title:'Fixture',episodeName:'Episode',poster:'',resolution:'auto',current:{type:'series',id,season,episode}});
  recordRecent(context('tt1111111',1,1),100,1000,{store});
  recordRecent(context('tt1111111',1,2),100,1000,{store});
  recordRecent(context('tt2222222',1,1),100,1000,{store});
  assert.equal(removeRecentTitle({type:'series',id:'tt1111111'},store),true);
  assert.deepEqual(listRecent(store).map(x=>x.id),['tt2222222']);
});
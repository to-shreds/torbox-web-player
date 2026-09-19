import test from 'node:test';
import assert from 'node:assert/strict';
import { recentKey, normalizeRecent, resumePosition, recordRecent, listRecent, clearRecent, formatResumeTime } from '../public/history.js';
function memoryStore(){const map=new Map();return{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};}
const context={title:'Family Guy',poster:'https://images.metahub.space/poster/x',resolution:'720p',episodeName:'Death Has a Shadow',current:{type:'series',id:'tt0182576',season:1,episode:1}};
test('canonical recent key follows movie or exact episode identity',()=>{assert.equal(recentKey(context),'series:tt0182576:1:1');assert.equal(recentKey({current:{type:'movie',id:'tt1254207'}}),'movie:tt1254207');});
test('recent playback survives source changes because it is not keyed to TorBox file id',()=>{const store=memoryStore();recordRecent(context,321,1320,{store});const [row]=listRecent(store);assert.equal(row.position,321);assert.equal(row.title,'Family Guy');assert.equal(row.episode,1);});
test('completed or nearly-finished content restarts while interrupted content resumes',()=>{assert.equal(resumePosition(normalizeRecent({key:'movie:tt1254207',title:'X',position:50,duration:100})),50);assert.equal(resumePosition(normalizeRecent({key:'movie:tt1254207',title:'X',position:95,duration:100})),0);assert.equal(resumePosition(normalizeRecent({key:'movie:tt1254207',title:'X',position:50,duration:100,completed:true})),0);});
test('recent history is bounded and clearable',()=>{const store=memoryStore();for(let i=0;i<30;i++)recordRecent({title:'M'+i,current:{type:'movie',id:'tt'+String(1000000+i)}},i,100,{store});assert.equal(listRecent(store).length,20);clearRecent(store);assert.equal(listRecent(store).length,0);});
test('resume time formatting is compact',()=>{assert.equal(formatResumeTime(65),'1:05');assert.equal(formatResumeTime(3661),'1:01:01');});

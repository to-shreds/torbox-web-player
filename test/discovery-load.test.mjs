import test from 'node:test';
import assert from 'node:assert/strict';
import { Discovery } from '../lib/discovery.mjs';

test('simultaneous source registrations cannot overrun capacity while availability is pending',async()=>{
  let release,entered=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const service=new Discovery({now:()=>10000,catalog:{meta:async()=>({id:'tt1234567',type:'movie',name:'Fixture',year:'2024',episodes:[]})},gateway:{cached:async()=>{entered++;await pending;return{};}}});
  for(let i=0;i<1990;i++)service.tickets.set('old-'+i,{until:20000});
  const input={target:{type:'movie',id:'tt1234567'},sources:Array.from({length:8},(_,i)=>({hash:(i+1).toString(16).padStart(40,'0'),title:'Fixture.2024.720p.H264.AAC.mp4'}))};
  const results=Promise.allSettled([service.register(input,'one'),service.register(input,'two')]);
  while(entered<2)await new Promise(resolve=>setImmediate(resolve));
  release();const settled=await results;
  assert.equal(settled.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(settled.find(row=>row.status==='rejected').reason.code,'SOURCE_CAPACITY');
  assert.equal(service.tickets.size,1998);
});

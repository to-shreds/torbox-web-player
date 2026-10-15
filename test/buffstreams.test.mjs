import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUFFSTREAMS_BASE,BUFFSTREAMS_HELPER,buffstreamsBase,cleanBuffstreamsCatalog,buffstreamsPlayerUrl,requestBuffstreams} from '../public/buffstreams.js';

const source='https://mybuffstreams.plus/home6';
const eventUrl='https://mybuffstreams.plus/nfl/team-a-team-b/123';
const event=()=>({id:'nfl:123',title:'Team A vs Team B',sport:'NFL',eventUrl,live:true,sourceTime:'7:00 PM'});
const catalog=()=>({source,fetchedAt:new Date().toISOString(),events:[event()],adapter:'buffstreams-v1'});
const player=()=>({eventUrl,playerUrl:'https://gooz.aapmains.net/new-stream-embed/123',playback:'source-page'});
const jsonResponse=(data,options={})=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'},...options});

test('source migration accepts public DNS domains and normalizes their root',()=>{
  assert.equal(DEFAULT_BUFFSTREAMS_BASE,'https://mybuffstreams.plus');
  for(const value of ['mybuffstreams.plus',' https://MYBUFFSTREAMS.plus/ ','https://mybuffstreams.plus/nflstreams2','https://mybuffstreams.plus:443'])assert.equal(buffstreamsBase(value),DEFAULT_BUFFSTREAMS_BASE);
  assert.equal(buffstreamsBase('https://new-source.example/home6'),'https://new-source.example');
  assert.equal(buffstreamsBase('https://www.buffstreams.example/nhlstreams2'),'https://www.buffstreams.example');
});

test('source URLs reject credentials, queries, fragments, private/IP hosts and malformed DNS',()=>{
  for(const value of ['',null,undefined,'http://mybuffstreams.plus','javascript:alert(1)','data:text/html,test','https://user:password@mybuffstreams.plus','https://@mybuffstreams.plus','https://mybuffstreams.plus?key=private','https://mybuffstreams.plus?','https://mybuffstreams.plus/#','https://mybuffstreams.plus:444','https://127.0.0.1','https://127.1','https://2130706433','https://[::1]','https://localhost','https://source.local','https://source.internal','https://source.test','https://source.lan','https://mybuffstreams','https://-buffstreams.example','https://buffstreams-.example','https://buffstreams..example','https://buffstreams_test.example','https://mybuffstreams.plus.','https://mybuffstreams.plus\\@evil.example'])assert.throws(()=>buffstreamsBase(value),undefined,String(value));
});

test('catalog preserves effective source and returns only whitelisted metadata',()=>{
  const raw=catalog();raw.score='secret';Object.assign(raw.events[0],{score:'secret',description:'secret',html:'<script>bad()</script>',artwork:'secret'});
  assert.deepEqual(cleanBuffstreamsCatalog(raw),{source,fetchedAt:raw.fetchedAt,events:[event()]});
});

test('catalog supports domain migration, preseason categories and named events',()=>{
  const raw=catalog();raw.source='https://new-source.example/home6';
  raw.events=[{id:'nfl-preseason:123',title:'Team A vs Team B',sport:'NFL',eventUrl:'https://new-source.example/nfl-preseason/a-b/123',live:false,sourceTime:''},{id:'mma:0123456789abcdef',title:'UFC Fight Night',sport:'MMA',eventUrl:'https://new-source.example/title-game/mma/ufc-fight-night-live-streams-links',live:false,sourceTime:''}];
  assert.equal(cleanBuffstreamsCatalog(raw).events.length,2);
});

test('malformed, empty, duplicate and foreign catalogs cannot replace a working list',()=>{
  const mutations=[r=>{r.events=[];},r=>{r.events.push({...r.events[0]});},r=>{r.events[0].eventUrl='https://foreign.example/nfl/a-b/123';},r=>{r.events[0].eventUrl='https://mybuffstreams.plus/nflstreams2';},r=>{r.events[0].eventUrl='https://mybuffstreams.plus/nfl/a-b/123?token=x';},r=>{r.events[0].eventUrl='https://mybuffstreams.plus/unknown/a-b/123';},r=>{r.events[0].id='nfl:456';},r=>{r.events[0].sport='Soccer';},r=>{r.events[0].live='true';},r=>{r.events[0].title=' ';},r=>{r.events[0].title='a'.repeat(181);},r=>{r.events[0].title='<img src=x>';},r=>{delete r.events[0].sourceTime;},r=>{r.fetchedAt='garbage';},r=>{r.fetchedAt='2026-02-30T00:00:00Z';},r=>{r.fetchedAt=new Date(Date.now()+600000).toISOString();},r=>{r.events=Array.from({length:301},()=>event());}];
  for(const mutate of mutations){const raw=catalog();mutate(raw);assert.throws(()=>cleanBuffstreamsCatalog(raw));}
});

test('score and result titles are omitted without discarding clean events',()=>{
  for(const title of ['Team A vs Team B 3-2','Team A 3 vs Team B 2','Team A defeats Team B','Team A victory over Team B','Team A vs Team B (Final)','Team A vs Team B Highlights']){
    const raw=catalog();raw.events.push({...event(),id:'nfl:456',eventUrl:eventUrl.replace('/123','/456'),title});
    assert.deepEqual(cleanBuffstreamsCatalog(raw).events,[event()]);
    raw.events.shift();assert.throws(()=>cleanBuffstreamsCatalog(raw),/spoiler-free/);
  }
  const raw=catalog();raw.events[0].sourceTime='Final: 3-2';assert.equal(cleanBuffstreamsCatalog(raw).events[0].sourceTime,'');
  const scheduled=catalog();scheduled.events[0]={...event(),id:'soccer:123',sport:'Soccer',title:'Melbourne Victory vs Sydney FC',eventUrl:'https://mybuffstreams.plus/soccer/melbourne-sydney/123'};assert.equal(cleanBuffstreamsCatalog(scheduled).events.length,1);
});

test('only matching direct player responses can open a tab',()=>{
  assert.equal(buffstreamsPlayerUrl(player(),eventUrl),'https://gooz.aapmains.net/new-stream-embed/123');
  for(const bad of [{...player(),eventUrl:eventUrl.replace('/123','/456')},{...player(),playback:'event-page'},...['javascript:alert(1)',eventUrl,source,'https://mybuffstreams.plus/nflstreams2','https://gooz.aapmains.net.evil.example/new-stream-embed/123','https://other.example/new-stream-embed/123','https://gooz.aapmains.net/new-stream-embed/123?token=x','https://gooz.aapmains.net/new-stream-embed/123#x','https://user@gooz.aapmains.net/new-stream-embed/123','https://gooz.aapmains.net:444/new-stream-embed/123','https://gooz.aapmains.net/new-stream-embed/name'].map(playerUrl=>({...player(),playerUrl}))])assert.throws(()=>buffstreamsPlayerUrl(bad,eventUrl));
});

test('transport posts whitelisted metadata only to the fixed helper',async()=>{
  const calls=[],controller=new AbortController();
  const fetchFn=async(url,options)=>{calls.push({url,options});return jsonResponse(catalog());};
  await requestBuffstreams('catalog',{source,helper:'https://evil.example',token:'private'},{signal:controller.signal,fetchFn});
  await requestBuffstreams('player',{source,eventUrl,media:'private'},{fetchFn});
  assert.deepEqual(calls.map(c=>c.url),[BUFFSTREAMS_HELPER+'/api/catalog',BUFFSTREAMS_HELPER+'/api/player']);
  assert.deepEqual(JSON.parse(calls[0].options.body),{source});assert.deepEqual(JSON.parse(calls[1].options.body),{source,eventUrl});
  assert.equal(calls[0].options.signal,controller.signal);
  for(const {options} of calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.method,'POST');}
  await assert.rejects(requestBuffstreams('proxy',{source},{fetchFn}));
  await assert.rejects(requestBuffstreams('player',{source,eventUrl:'https://foreign.example/nfl/a-b/123'},{fetchFn}));
  assert.equal(calls.length,2);
});

test('transport rejects non-JSON, malformed and oversized response bodies',async()=>{
  const responses=[()=>new Response('<html>source</html>',{headers:{'Content-Type':'text/html'}}),()=>new Response('{invalid',{headers:{'Content-Type':'application/json'}}),()=>jsonResponse([]),()=>jsonResponse(catalog(),{headers:{'Content-Type':'application/json','Content-Length':String(256*1024+1)}}),()=>jsonResponse({padding:'x'.repeat(256*1024)}),()=>jsonResponse({padding:'☃'.repeat(100000)})];
  for(const makeResponse of responses)await assert.rejects(requestBuffstreams('catalog',{source},{fetchFn:async()=>makeResponse()}));
});

test('transport errors are bounded and cancellation propagates',async()=>{
  await assert.rejects(requestBuffstreams('catalog',{source},{fetchFn:async()=>jsonResponse({error:'x'.repeat(900)},{status:422})}),error=>error.status===422&&error.message.length===300);
  const controller=new AbortController();controller.abort();
  await assert.rejects(requestBuffstreams('catalog',{source},{signal:controller.signal,fetchFn:async(_url,{signal})=>{signal.throwIfAborted();}}),error=>error.name==='AbortError');
});

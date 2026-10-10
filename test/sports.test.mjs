import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sportsMediaUrl,cleanSportsCatalog,resolveSportsSource,replayResume,SPORTS_MEDIA_HOSTS} from '../public/sports-core.js';
const raw=JSON.parse(await readFile(new URL('../public/sports-catalog.json',import.meta.url),'utf8'));
test('bundled sports includes four anonymous live feeds and sixteen full padel replays',()=>{
  const catalog=cleanSportsCatalog(raw);
  assert.equal(catalog.items.filter(x=>x.kind==='live').length,4);
  assert.equal(catalog.items.filter(x=>x.kind==='replay').length,16);
  assert.ok(catalog.items.some(x=>x.kind==='live'&&x.sport==='tennis'));
  for(const item of catalog.items){assert.equal('description' in item,false);assert.equal('poster' in item,false);for(const s of item.sources)assert.ok(s.type==='redbull'||sportsMediaUrl(s.url));}
});
test('sports rejects untrusted hosts, credentials, lookalikes, ports and cleartext',()=>{
  for(const host of SPORTS_MEDIA_HOSTS)assert.ok(sportsMediaUrl(`https://${host}/test.m3u8`));
  for(const url of ['http://play.redbull.com/a','https://play.redbull.com.evil.test/a','https://evilplay.redbull.com/a','https://play.redbull.com:444/a','https://user:password@play.redbull.com/a','https://api.torbox.app/a','https://127.0.0.1/a'])assert.throws(()=>sportsMediaUrl(url));
});
test('replay resolver sends public identity only and refuses geo-blocked media',async()=>{
  const source=raw.items.find(x=>x.kind==='replay').sources[0];let called=0;
  const url=await resolveSportsSource(source,{fetchFn:async(u,options)=>{
    called++;assert.equal(new URL(u).hostname,'api-player.redbull.com');assert.equal(new URL(u).searchParams.get('videoId'),source.videoId);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});
    return Response.json({videoUrl:'https://play.redbull.com/full.m3u8',playabilityErrors:[],description:'RESULT SPOILER'});
  }});
  assert.equal(called,1);assert.equal(url,'https://play.redbull.com/full.m3u8');
  await assert.rejects(resolveSportsSource(source,{fetchFn:async()=>Response.json({videoUrl:url,playabilityErrors:['GEO_BLOCKED']})}),/location/);
  await assert.rejects(resolveSportsSource(source,{fetchFn:async()=>Response.json({videoUrl:'https://evil.test/full.m3u8'})}),/Unverified/);
});
test('catalog discards invalid entries and result-bearing fields rather than exposing them',()=>{
  const row={...raw.items[0],description:'Winner and score',poster:'winner.jpg',score:'6-0'};
  const result=cleanSportsCatalog({items:[row,row,{...row,id:'other',sources:[{type:'hls',url:'https://evil.test/a'}]}]}).items;
  assert.equal(result.length,1);assert.equal(JSON.stringify(result).includes('Winner'),false);assert.equal(JSON.stringify(result).includes('6-0'),false);
});
test('replay resume rewinds five seconds and excludes finished or invalid positions',()=>{
  assert.equal(replayResume(60,200),55);for(const [p,d] of [[NaN,100],[90,100],[100,100],[-10,200],[5,200],[60,0]])assert.equal(replayResume(p,d),0);
});
test('sports assets are independent of movie credentials and startup',async()=>{
  const [boot,html,sw]=await Promise.all(['boot.js','index.html','sw.js'].map(name=>readFile(new URL('../public/'+name,import.meta.url),'utf8')));
  assert.ok(boot.indexOf('import(`./sports.js')<boot.indexOf('warmBackend();'));
  for(const host of SPORTS_MEDIA_HOSTS)assert.ok(html.includes('https://'+host));
  assert.ok(html.includes("media-src 'self' blob:"));assert.ok(html.includes("script-src 'self'"));assert.ok(sw.includes('./sports-catalog.json?v=${BUILD}'));
});

import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';
import {decryptEncryptedTransfer} from '../../public/device-transfer.js';

let browser, fixture;
const first = {id:'tt0133093',type:'movie',name:'Fixture Matrix',year:'1999',runtime:'136 min',genres:['Action','Sci-Fi'],description:'A programmer discovers a hidden world and has to decide what to believe.',poster:'',episodes:[],imdbRating:8.7,trailers:[{ytId:'FVI84Dfx2-I'}]};
const second = {id:'tt0114709',type:'movie',name:'Fixture Toy Story',year:'1995',runtime:'81 min',genres:['Animation','Family'],description:'Two toys learn to work together to find their way home.',poster:'',episodes:[],imdbRating:8.3,trailers:[]};
const related = {id:'tt0234215',type:'movie',name:'Fixture Related Movie',year:'2003',runtime:'138 min',genres:['Action','Sci-Fi'],description:'Another adventure in the same sort of world.',poster:'',episodes:[],imdbRating:7.2,trailers:[]};
const otherRelated = {...related,id:'tt0242653',name:'Fixture Other Related Movie'};
const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const json = (route,value,status=200) => route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)});
const ratingResponse = (meta,score='88%') => ({Response:'True',imdbID:meta.id,Type:meta.type,Ratings:[{Source:'Rotten Tomatoes',Value:score}]});
const wikiResponse = () => ({results:{bindings:[{
  item:{type:'uri',value:'http://www.wikidata.org/entity/Q83495'},
  imdb:{type:'literal',value:first.id},
  score:{type:'literal',value:'83%'},
  source:{type:'uri',value:'http://www.wikidata.org/entity/Q105584'},
  method:{type:'uri',value:'http://www.wikidata.org/entity/Q108403393'},
  recordedAt:{type:'literal',datatype:'http://www.w3.org/2001/XMLSchema#dateTime',value:'2026-01-16T00:00:00Z'},
  rt:{type:'literal',value:'m/matrix'},
  rank:{type:'uri',value:'http://wikiba.se/ontology#NormalRank'}
}]}});

before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  fixture=await startFixture(4228);
});
after(async()=>{await browser?.close();await fixture?.close();});

async function pageFor(t,{viewport={width:412,height:915},key='',movies=[first,second],omdb,similar,wiki}={}) {
  Object.assign(fixture.control,{playbackCalls:0,mediaFetches:0,creates:0,lookupCalls:0,prepareCalls:0});
  const context=await browser.newContext({viewport,isMobile:viewport.width<620,hasTouch:viewport.width<620,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],requests={omdb:[],wiki:[],similar:[],meta:[],youtube:[]};
  const all=new Map([...movies,related,otherRelated].map(meta=>[meta.id,meta]));
  page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({token,key})=>{
    sessionStorage.setItem('torbox-web-session',token);
    if(key)localStorage.setItem('torbox-omdb-key-v1',key);
  },{token:fixture.session(),key});
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/api/discover/catalog?**',route=>json(route,{metas:movies,nextSkip:null,feed:'popular',requestedFeed:'popular',fallback:false}));
  await context.route('**/api/discover/meta?**',route=>{
    const id=new URL(route.request().url()).searchParams.get('id');requests.meta.push(id);
    return json(route,{meta:all.get(id)||first});
  });
  // Details prewarming stays local and cannot touch a real account or media.
  await context.route('**/api/discover/lookup?**',route=>json(route,{sources:[],complete:true}));
  await context.route('**/api/discover/similar?**',route=>{
    const id=new URL(route.request().url()).searchParams.get('id');requests.similar.push(id);
    return similar?similar(route,id):json(route,{metas:[]});
  });
  await context.route('https://www.omdbapi.com/**',route=>{
    const id=new URL(route.request().url()).searchParams.get('i');requests.omdb.push(id);
    return omdb?omdb(route,id):json(route,ratingResponse(all.get(id)||first));
  });
  await context.route('https://query.wikidata.org/**',route=>{
    requests.wiki.push(route.request().url());
    return wiki?wiki(route):json(route,{results:{bindings:[]}});
  });
  await context.route('https://www.youtube.com/**',route=>{
    requests.youtube.push(route.request().url());
    return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Trailer destination fixture</title>'});
  });
  t.after(async()=>{
    await context.close();assert.deepEqual(errors,[]);
    assert.equal(fixture.control.playbackCalls,0);
    assert.equal(fixture.control.mediaFetches,0);
    assert.equal(fixture.control.creates,0);
  });
  return {page,context,requests};
}
async function home(page) {
  await page.goto(fixture.origin);
  await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-grid .poster-card').first().waitFor();
}
async function openTitle(page,meta=first) {
  await page.locator('#catalog-grid .poster-card').filter({has:page.locator('strong',{hasText:meta.name})}).click();
  await page.locator('#detail-title').filter({hasText:meta.name}).waitFor();
  await page.locator('#episode-area button').filter({hasText:/^Play$/}).waitFor();
}
async function frames(page) {await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}
async function showSimilar(page) {await page.locator('#title-similar').scrollIntoViewIfNeeded();}

test('full synopsis and long heading remain readable at 320px, 412px and desktop widths', {timeout:30000}, async t=>{
  const description=('This synopsis must remain readable from beginning to end, including its final line. ').repeat(8)+'Visible final sentence.';
  const long={...first,name:'A Very Long Movie Title With Several Words AndOneUnbrokenTitleSegmentThatMustWrap',description};
  for(const viewport of [{width:320,height:720},{width:412,height:915},{width:1280,height:900}]) {
    const {page,context}=await pageFor(t,{viewport,movies:[long,second]});
    await home(page);await openTitle(page,long);
    assert.equal(await page.locator('.title-description').textContent(),description);
    const measurements=await page.evaluate(()=>{
      const dialog=document.querySelector('#title-dialog'),text=document.querySelector('.title-description'),heading=document.querySelector('#detail-title'),close=document.querySelector('#close-title');
      const bounds=element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,width:rect.width,height:rect.height};};
      return {dialog:bounds(dialog),text:bounds(text),heading:bounds(heading),close:bounds(close),viewport:innerWidth,dialogOverflow:dialog.scrollWidth-dialog.clientWidth,textOverflow:text.scrollHeight-text.clientHeight,headingOverflow:heading.scrollHeight-heading.clientHeight,lineClamp:getComputedStyle(text).webkitLineClamp};
    });
    assert.ok(measurements.dialog.left>=-1&&measurements.dialog.right<=viewport.width+1,JSON.stringify(measurements));
    assert.ok(measurements.dialogOverflow<=1,JSON.stringify(measurements));
    assert.ok(measurements.textOverflow<=1&&measurements.headingOverflow<=1,JSON.stringify(measurements));
    assert.ok(!['1','2','3'].includes(measurements.lineClamp),'synopsis must not be silently clamped');
    for(const element of [measurements.text,measurements.heading,measurements.close]) assert.ok(element.left>=measurements.dialog.left&&element.right<=measurements.dialog.right+1,JSON.stringify(measurements));
    await page.locator('#episode-area button').filter({hasText:/^Play$/}).scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#episode-area button').filter({hasText:/^Play$/}).isEnabled(),true);
    await context.close();
  }
});

test('trailers open a safe direct link or exact title/year search only after a deliberate click', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t);
  await home(page);await openTitle(page);await frames(page);
  const trailer=page.locator('.trailer-link');
  assert.equal(await trailer.getAttribute('href'),'https://www.youtube.com/watch?v=FVI84Dfx2-I');
  assert.equal(await trailer.getAttribute('target'),'_blank');
  assert.equal(await trailer.getAttribute('rel'),'noopener noreferrer');
  assert.equal(await trailer.getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(await page.locator('iframe[src*="youtube"]').count(),0);
  assert.equal(requests.youtube.length,0);
  const popupPromise=page.waitForEvent('popup');await trailer.click();const popup=await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(popup.url(),'https://www.youtube.com/watch?v=FVI84Dfx2-I');await popup.close();
  assert.equal(requests.youtube.length,1);
  await page.locator('#close-title').click();await openTitle(page,second);
  const fallback=new URL(await page.locator('.trailer-link').getAttribute('href'));
  assert.equal(fallback.origin,'https://www.youtube.com');assert.equal(fallback.pathname,'/results');
  assert.equal(fallback.searchParams.get('search_query'),'Fixture Toy Story 1995 official trailer');
  assert.equal(requests.youtube.length,1,'preparing a fallback link must not fetch YouTube');
});

test('similar posters exclude the original, duplicates and wrong media types, and open exact details', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t,{similar:(route,id)=>json(route,{metas:id===first.id?[first,related,related,{...otherRelated,type:'series'},otherRelated]:[]})});
  await home(page);await openTitle(page);await showSimilar(page);
  await page.locator('#title-similar .poster-card').first().waitFor();
  assert.deepEqual(await page.locator('#title-similar .poster-card > strong').allTextContents(),[related.name,otherRelated.name]);
  await page.locator('#title-similar .poster-card').first().click();
  await page.locator('#detail-title').filter({hasText:related.name}).waitFor();
  assert.equal(requests.meta.at(-1),related.id);
  await page.locator('#close-title').click();await openTitle(page);await showSimilar(page);
  await page.locator('#title-similar .poster-card').first().waitFor();
  assert.equal(requests.similar.filter(id=>id===first.id).length,1,'reopening uses the cached list');
});

test('delayed and failed extras leave details and Play available, and similar titles can be retried', {timeout:30000}, async t=>{
  const similarGate=deferred(),ratingGate=deferred(),similarStarted=deferred(),ratingStarted=deferred();let similarCalls=0;
  const {page}=await pageFor(t,{key:'testkey1',similar:async(route)=>{
    similarCalls++;if(similarCalls>1)return json(route,{metas:[related]});
    similarStarted.resolve();await similarGate.promise;try{await json(route,{error:'Unavailable'},503);}catch{}
  },omdb:async(route)=>{ratingStarted.resolve();await ratingGate.promise;try{await route.abort('failed');}catch{}}});
  t.after(()=>{similarGate.resolve();ratingGate.resolve();});
  await home(page);await openTitle(page);await showSimilar(page);
  await Promise.all([similarStarted.promise,ratingStarted.promise]);
  assert.equal(await page.locator('.title-description').textContent(),first.description);
  assert.equal(await page.locator('#episode-area button').filter({hasText:/^Play$/}).isEnabled(),true);
  assert.equal(await page.locator('.trailer-link').isVisible(),true);
  assert.equal(await page.locator('#detail-message').textContent(),'');
  similarGate.resolve();ratingGate.resolve();
  const retry=page.locator('#title-similar button').filter({hasText:'Try again'});await retry.waitFor();
  assert.equal(await page.locator('#episode-area button').filter({hasText:/^Play$/}).isEnabled(),true);
  await retry.click();await page.locator('#title-similar .poster-card').first().waitFor();
  assert.equal(await page.locator('#title-similar .poster-card > strong').textContent(),related.name);
});

test('late responses for a closed title cannot overwrite the next title rating or similar list', {timeout:30000}, async t=>{
  const gate=deferred(),oldSimilar=deferred(),oldRating=deferred(),similarFinished=deferred(),ratingFinished=deferred();
  const {page}=await pageFor(t,{key:'testkey1',similar:async(route,id)=>{
    if(id!==first.id)return json(route,{metas:[otherRelated]});
    oldSimilar.resolve();await gate.promise;try{await json(route,{metas:[related]});}catch{}finally{similarFinished.resolve();}
  },omdb:async(route,id)=>{
    if(id!==first.id)return json(route,ratingResponse(second,'99%'));
    oldRating.resolve();await gate.promise;try{await json(route,ratingResponse(first,'12%'));}catch{}finally{ratingFinished.resolve();}
  }});
  t.after(()=>gate.resolve());
  await home(page);await openTitle(page);await showSimilar(page);await Promise.all([oldSimilar.promise,oldRating.promise]);
  await page.locator('#close-title').click();await openTitle(page,second);await showSimilar(page);
  await page.locator('.title-ratings').filter({hasText:'Rotten Tomatoes 99%'}).waitFor();
  await page.locator('#title-similar .poster-card').first().waitFor();
  gate.resolve();await Promise.all([similarFinished.promise,ratingFinished.promise]);await frames(page);
  assert.equal(await page.locator('#detail-title').textContent(),second.name);
  assert.match(await page.locator('.title-ratings').textContent(),/Rotten Tomatoes 99%/);
  assert.doesNotMatch(await page.locator('.title-ratings').textContent(),/12%/);
  assert.deepEqual(await page.locator('#title-similar .poster-card > strong').allTextContents(),[otherRelated.name]);
});

test('home starts without ratings requests and reuses a details score on its poster and after reload', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t,{key:'testkey1'});
  await home(page);await frames(page);
  assert.equal(requests.omdb.length,0);assert.equal(requests.wiki.length,0);
  await openTitle(page);await page.locator('.title-ratings').filter({hasText:'Rotten Tomatoes 88%'}).waitFor();
  await page.locator('#close-title').click();
  assert.equal(await page.locator('#catalog-grid .poster-card').first().locator('.poster-rating').textContent(),'RT 88%');
  assert.equal(requests.omdb.length,1);assert.equal(requests.wiki.length,0);
  await home(page);await frames(page);
  assert.equal(await page.locator('#catalog-grid .poster-card').first().locator('.poster-rating').textContent(),'RT 88%');
  assert.equal(requests.omdb.length,1);assert.equal(requests.wiki.length,0);
  await openTitle(page);await page.locator('.title-ratings').filter({hasText:'Rotten Tomatoes 88%'}).waitFor();await frames(page);
  assert.equal(requests.omdb.length,1,'cached details must not spend another OMDb request');
});

test('the optional key saves through Settings, stays outside the actual encrypted setup transfer and can be removed', {timeout:30000}, async t=>{
  const {page,context}=await pageFor(t);let transferred;
  await context.route('**/api/owner/unlock',route=>json(route,{ok:true}));
  await context.route('**/api/setup-transfer',route=>{transferred=route.request().postDataJSON();return json(route,{expiresAt:new Date(Date.now()+600000).toISOString()});});
  await home(page);await page.locator('#open-settings').click();
  assert.equal(await page.locator('#setting-omdb-key').getAttribute('type'),'password');
  await page.locator('#setting-omdb-key').fill('omdbkey77');
  await page.locator('#settings-form button[type=submit]').click();await page.locator('#settings-message').filter({hasText:'Saved.'}).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('torbox-omdb-key-v1')),'omdbkey77');
  assert.equal((await page.evaluate(()=>localStorage.getItem('torbox-settings-v1'))).includes('omdbkey77'),false);
  await page.locator('#close-settings').click();await openTitle(page);
  await page.locator('.title-ratings').filter({hasText:'Rotten Tomatoes 88%'}).waitFor();await page.locator('#close-title').click();
  await page.locator('#open-settings').click();await page.locator('#transfer-create').click();
  await page.locator('#transfer-api-key').fill('fixture-master-key');await page.locator('#transfer-key-continue').click();
  await page.locator('#transfer-result').waitFor({state:'visible'});
  const code=await page.locator('#transfer-code').inputValue();
  const payload=await decryptEncryptedTransfer(code,transferred.envelope,{cryptoObj:webcrypto});
  assert.equal(payload.apiKey,'fixture-master-key');
  assert.equal(JSON.stringify(payload).includes('omdbkey77'),false);
  assert.equal(Object.keys(payload.state).some(key=>/omdb|title-ratings/.test(key)),false);
  await page.locator('#setting-omdb-key').fill('');await page.locator('#settings-form button[type=submit]').click();
  await page.locator('#close-settings').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('torbox-omdb-key-v1')),null);
  assert.equal(await page.locator('#catalog-grid .poster-rating').count(),0,'removing the optional key removes cached OMDb badges');
});

test('Kid Mode keeps the new external links and similar-title browsing out of movie details', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t);
  await home(page);await page.locator('#open-settings').click();await page.locator('#parent-pin-change').click();
  await page.locator('#parent-pin-new').fill('1234');await page.locator('#parent-pin-confirm').fill('1234');
  await page.locator('#parent-pin-change-form button[type=submit]').click();
  await page.locator('#parent-pin-change-dialog').waitFor({state:'hidden'});
  await page.locator('#setting-kid-mode').check();await page.locator('#settings-form button[type=submit]').click();
  await page.waitForFunction(()=>document.body.classList.contains('kid-mode'));
  await page.locator('#close-settings').click();await openTitle(page);await frames(page);
  assert.equal(await page.locator('#episode-area button').filter({hasText:/^Play$/}).isEnabled(),true);
  assert.equal(await page.locator('#title-dialog .trailer-link').count(),0);
  assert.equal(await page.locator('#title-dialog a[target="_blank"]:visible').count(),0);
  assert.equal(await page.locator('#title-similar').isVisible(),false);
  assert.equal(requests.similar.length,0);
});

test('keyless scores clearly show their recorded date and source, then reuse that dated poster badge', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t,{wiki:route=>json(route,wikiResponse())});
  await home(page);await frames(page);assert.equal(requests.wiki.length,0);
  await openTitle(page);await page.locator('.title-ratings').filter({hasText:'Rotten Tomatoes 83%'}).waitFor();
  assert.match(await page.locator('.title-ratings').textContent(),/Recorded Jan 16, 2026 · via Wikidata/);
  assert.equal(await page.locator('.title-ratings a').filter({hasText:'Rotten Tomatoes'}).getAttribute('href'),'https://www.rottentomatoes.com/m/matrix');
  await page.locator('#close-title').click();
  assert.equal(await page.locator('#catalog-grid .poster-card').first().locator('.poster-rating').textContent(),'RT 83% · Jan 2026');
  await home(page);await frames(page);
  assert.equal(requests.wiki.length,1);assert.equal(requests.omdb.length,0);
  assert.equal(await page.locator('#catalog-grid .poster-card').first().locator('.poster-rating').textContent(),'RT 83% · Jan 2026');
});

test('missing scores stay unlabeled as scores and an empty similar list does not disable movie actions', {timeout:30000}, async t=>{
  const {page,requests}=await pageFor(t);
  await home(page);await openTitle(page);await showSimilar(page);
  await page.locator('#title-similar .similar-status').filter({hasText:'No similar titles are available'}).waitFor();
  await frames(page);
  assert.match(await page.locator('.title-ratings').textContent(),/IMDb 8\.7\/10/);
  assert.equal(await page.locator('.title-ratings a').filter({hasText:'Rotten Tomatoes'}).textContent(),'Rotten Tomatoes ↗');
  assert.equal(await page.locator('#catalog-grid .poster-rating').count(),0);
  assert.equal(await page.locator('#episode-area button').filter({hasText:/^Play$/}).isEnabled(),true);
  assert.equal(requests.omdb.length,0);
});

import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

const defaultBase='https://mybuffstreams.plus';
const helperOrigin='https://sports-desk-links.onrender.com';
const playerUrl='https://gooz.aapmains.net/new-stream-embed/123';
const baseKey='tw-buffstreams-base',stateKey='tw-buffstreams-state-v1';
let browser,fixture;
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function catalogFor(base=defaultBase,{fetchedAt=new Date().toISOString()}={}){
  return {source:base+'/home6',fetchedAt,adapter:'buffstreams-v1',events:[
    {id:'nfl:123',title:'Fixture Bears vs Fixture Lions',sport:'NFL',eventUrl:base+'/nfl/fixture-bears-vs-fixture-lions/123',live:true,sourceTime:'11:00',score:'9-1',description:'WINNER SPOILER'},
    {id:'nfl:124',title:'Fixture Owls vs Fixture Foxes',sport:'NFL',eventUrl:base+'/nfl/fixture-owls-vs-fixture-foxes/124',live:false,sourceTime:'18:00'},
    {id:'nhl:125',title:'Fixture Sabres vs Fixture Bruins',sport:'Hockey',eventUrl:base+'/nhl/fixture-sabres-vs-fixture-bruins/125',live:true,sourceTime:'19:00'}
  ]};
}
before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  fixture=await startFixture(4187);
});
after(async()=>{await browser?.close();await fixture?.close();});

async function buffstreamsPage(t,{savedState,enter=true,bundleGate,traceDeskTimer=false}={}){
  Object.assign(fixture.control,{playbackCalls:0,logins:0,mediaFetches:0});
  const context=await browser.newContext({viewport:{width:1000,height:760},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[],requests=[],providerRequests=[],helperRequests=[];
  const control={catalogResponse:null,playerResponse:null,catalogGate:null,playerGate:null};
  page.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>requests.push(request.url()));
  t.after(async()=>{
    bundleGate?.resolve();control.catalogGate?.resolve();control.playerGate?.resolve();
    await context.close();assert.deepEqual(errors,[]);
  });
  if(traceDeskTimer)await context.addInitScript(()=>{
    const schedule=window.setInterval.bind(window),clear=window.clearInterval.bind(window),active=new Set();
    window.__buffstreamsDeskIntervalCount=()=>active.size;
    window.setInterval=(callback,delay,...args)=>{const id=schedule(callback,delay,...args);if(Number(delay)===30000)active.add(id);return id;};
    window.clearInterval=id=>{active.delete(id);return clear(id);};
  });
  if(savedState)await context.addInitScript(({key,baseKey,state})=>{
    if(!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(state));localStorage.setItem(baseKey,new URL(state.source).origin);}
  },{key:stateKey,baseKey,state:savedState});
  await context.addCookies([{name:'private-helper-cookie',value:'fixture-private-cookie',domain:'sports-desk-links.onrender.com',path:'/',secure:true}]);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===fixture.origin){
      if(bundleGate&&url.pathname==='/sports-catalog.json'){bundleGate.started.resolve();await bundleGate.promise;}
      try{return await route.continue();}catch(error){if(!/closed|disposed|handled|aborted|cancel/i.test(error.message))throw error;return;}
    }
    if(url.origin===helperOrigin){
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
      let body={};try{body=request.postDataJSON()||{};}catch{}
      const source=url.searchParams.get('source')||body.source;
      const eventUrl=url.searchParams.get('eventUrl')||body.eventUrl;
      const row={url:request.url(),source,eventUrl,headers:await request.allHeaders()};helperRequests.push(row);
      let response;
      if(url.pathname==='/api/catalog'){
        const gate=control.catalogGate;gate?.started?.resolve(row);if(gate)await gate.promise;
        response=control.catalogResponse||{json:catalogFor(new URL(source).origin)};
      }else if(url.pathname==='/api/player'){
        const gate=control.playerGate;gate?.started?.resolve(row);if(gate)await gate.promise;
        response=control.playerResponse||{json:{playerUrl,eventUrl,playback:'source-page'}};
      }else return route.abort();
      try{return await route.fulfill({status:response.status||200,json:response.json,headers});}
      catch(error){if(!/closed|disposed|handled|aborted|cancel/i.test(error.message))throw error;return;}
    }
    providerRequests.push({url:request.url(),headers:await request.allHeaders()});
    if(url.href===playerUrl)return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="referrer" content="no-referrer"><title>Fixture direct player</title><p>Local intercepted player</p>'});
    return route.abort();
  });
  await context.route('**/api/session',()=>{}); // Deliberately hung private service.
  await page.goto(fixture.origin+'/?torbox_key=private-fixture-key&token=private-token#sports');
  if(bundleGate)await page.waitForSelector('#sports-panel');else await page.waitForSelector('#sports-grid .sports-card');
  if(enter){await page.locator('[data-sports-mode="buffstreams"]').click();await page.waitForSelector('#buffstreams-events .buffstreams-game');}
  return {context,page,requests,providerRequests,helperRequests,control};
}
const games=view=>view.page.locator('#buffstreams-events .buffstreams-game');
const helpers=(view,path)=>view.helperRequests.filter(row=>new URL(row.url).pathname===path);
async function state(view){return view.page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),stateKey);}
async function openAddressSettings(page){
  const settings=page.locator('.buffstreams-settings');
  if(!await settings.evaluate(element=>element.open))await settings.locator('summary').click();
}
function assertAnonymous(view){
  for(const request of [...view.helperRequests,...view.providerRequests]){
    assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);
    assert.equal(request.url.includes('private-fixture-key'),false);assert.equal(request.url.includes('private-token'),false);
  }
}
async function startWatch(view,id='nfl:123'){
  const [popup]=await Promise.all([view.context.waitForEvent('page'),view.page.locator(`[data-buffstreams-watch="${id}"]`).click()]);
  return popup;
}
function gate(){return {...deferred(),started:deferred()};}

test('Buffstreams lists games and filters them locally while the private service is hung',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);
  assert.equal(await view.page.locator('#buffstreams-message').getAttribute('role'),'status');
  assert.equal(await view.page.locator('#buffstreams-search').getAttribute('type'),'search');
  assert.equal(await games(view).count(),3);
  assert.match(await view.page.locator('#buffstreams-count').textContent(),/3/);
  assert.ok((await view.page.locator('#buffstreams-updated').textContent()).trim());
  const content=await view.page.locator('#buffstreams-events').textContent();
  assert.equal(content.includes('WINNER SPOILER'),false);assert.equal(content.includes('9-1'),false);
  const calls=helpers(view,'/api/catalog').length;
  await view.page.locator('#buffstreams-search').fill('Bears');assert.equal(await games(view).count(),1);
  await view.page.locator('#buffstreams-search').fill('');await view.page.locator('#buffstreams-sport').selectOption('NFL');assert.equal(await games(view).count(),2);
  await view.page.locator('#buffstreams-live-only').check();assert.equal(await games(view).count(),1);
  await view.page.locator('#buffstreams-sport').selectOption('Hockey');assert.equal(await games(view).count(),1);
  assert.match(await games(view).textContent(),/Fixture Sabres vs Fixture Bruins/);
  await view.page.locator('#buffstreams-search').fill('no matching fixture');assert.equal(await games(view).count(),0);
  assert.equal(helpers(view,'/api/catalog').length,calls);assert.equal(helpers(view,'/api/player').length,0);
  assert.equal(view.providerRequests.length,0);assertAnonymous(view);
  assert.equal(view.requests.filter(url=>new URL(url).origin===fixture.origin&&/^\/(?:api\/|healthz)/.test(new URL(url).pathname)).length,0);
  assert.equal(fixture.control.logins,0);assert.equal(fixture.control.playbackCalls,0);assert.equal(fixture.control.mediaFetches,0);
});

test('Watch opens its own waiting page and navigates only that tab to the resolved direct player',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t),original=view.page.url();view.control.playerGate=gate();
  const popup=await startWatch(view);
  await view.control.playerGate.started.promise;
  await popup.waitForURL(url=>url.origin===fixture.origin&&url.pathname==='/buffstreams-opening.html');
  await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.evaluate(()=>window.opener===null),true);
  assert.equal(await view.page.locator('#buffstreams-cancel').isVisible(),true);
  view.control.playerGate.resolve();
  await popup.waitForURL(playerUrl);await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.evaluate(()=>window.opener===null),true);assert.equal(view.page.url(),original);
  assert.equal(helpers(view,'/api/player').length,1);
  assert.equal(helpers(view,'/api/player')[0].source,defaultBase+'/home6');
  assert.equal(helpers(view,'/api/player')[0].eventUrl,catalogFor().events[0].eventUrl);
  assert.deepEqual(view.providerRequests.map(row=>row.url),[playerUrl]);
  assert.equal(view.providerRequests[0].headers.referer,undefined);
  assert.equal(new URL(view.providerRequests[0].url).search,'');assert.equal(new URL(view.providerRequests[0].url).hash,'');
  assertAnonymous(view);await popup.close();
});

test('a blocked popup still resolves the player and offers a protected direct-player link',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);await view.page.evaluate(()=>{window.open=()=>null;});
  await view.page.locator('[data-buffstreams-watch="nfl:123"]').click();
  const link=view.page.locator('#buffstreams-open-player');await link.waitFor({state:'visible'});
  assert.equal(await link.getAttribute('href'),playerUrl);assert.equal(await link.getAttribute('target'),'_blank');
  const rel=new Set((await link.getAttribute('rel')).split(/\s+/));assert.ok(rel.has('noopener'));assert.ok(rel.has('noreferrer'));
  assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');assert.equal(helpers(view,'/api/player').length,1);
  const [popup]=await Promise.all([view.context.waitForEvent('page'),link.click()]);await popup.waitForURL(playerUrl);await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.evaluate(()=>window.opener===null),true);assert.equal(view.providerRequests[0].headers.referer,undefined);
  assert.deepEqual(view.providerRequests.map(row=>row.url),[playerUrl]);await popup.close();
});

test('a failed player lookup closes its waiting tab and does not fall back to the provider website',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);view.control.playerGate=gate();view.control.playerResponse={status:503,json:{error:'Fixture player unavailable'}};
  const popup=await startWatch(view);await view.control.playerGate.started.promise;
  const closed=popup.waitForEvent('close');view.control.playerGate.resolve();await closed;
  assert.equal(await view.page.locator('#buffstreams-open-player').isVisible(),false);
  assert.ok((await view.page.locator('#buffstreams-message').textContent()).trim());
  assert.equal(view.providerRequests.length,0);assert.equal(await games(view).count(),3);
});

test('a replacement address is checked before saving and failed refreshes preserve the working catalog',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t),newBase='https://new-buffstreams.example';await openAddressSettings(view.page);
  view.control.catalogResponse={status:503,json:{error:'Fixture replacement unavailable'}};
  await view.page.locator('#buffstreams-address').fill(newBase);await view.page.locator('#buffstreams-save').click();
  await view.page.waitForFunction(()=>document.getElementById('buffstreams-cancel').hidden);
  assert.equal((await state(view)).source,defaultBase+'/home6');assert.equal(await games(view).count(),3);
  const malformed=catalogFor(newBase);malformed.events[0].eventUrl='https://other-provider.example/nfl/fixture-bears-vs-fixture-lions/123';
  view.control.catalogResponse={json:malformed};
  await view.page.locator('#buffstreams-address').fill(newBase);await view.page.locator('#buffstreams-save').click();
  await view.page.waitForFunction(()=>document.getElementById('buffstreams-cancel').hidden);
  assert.equal((await state(view)).source,defaultBase+'/home6');assert.equal(await games(view).count(),3);
  view.control.catalogResponse=null;
  await view.page.locator('#buffstreams-address').fill(newBase+'/home6');await view.page.locator('#buffstreams-save').click();
  await view.page.waitForFunction(({key,source})=>JSON.parse(localStorage.getItem(key)||'{}').source===source,{key:stateKey,source:newBase+'/home6'});
  assert.equal(await view.page.evaluate(key=>localStorage.getItem(key),baseKey),newBase);
  assert.equal((await state(view)).catalog.events[0].eventUrl,newBase+'/nfl/fixture-bears-vs-fixture-lions/123');
  view.control.catalogResponse={status:503,json:{error:'Fixture refresh unavailable'}};
  await view.page.locator('#buffstreams-refresh').click();await view.page.waitForFunction(()=>document.getElementById('buffstreams-cancel').hidden);
  assert.equal((await state(view)).source,newBase+'/home6');assert.equal(await games(view).count(),3);
  const calls=helpers(view,'/api/catalog').length;
  await view.page.locator('#buffstreams-address').fill('https://example.com?key=private');await view.page.locator('#buffstreams-save').click();
  assert.equal(helpers(view,'/api/catalog').length,calls);assert.equal((await state(view)).source,newBase+'/home6');
  view.control.catalogResponse=null;await view.page.locator('#buffstreams-reset').click();
  await view.page.waitForFunction(({key,source})=>JSON.parse(localStorage.getItem(key)||'{}').source===source,{key:stateKey,source:defaultBase+'/home6'});
  assert.equal(await view.page.evaluate(key=>localStorage.getItem(key),baseKey),defaultBase);
});

test('canceling an address check discards a late result and leaves the saved games untouched',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);await openAddressSettings(view.page);view.control.catalogGate=gate();
  await view.page.locator('#buffstreams-address').fill('https://new-buffstreams.example');await view.page.locator('#buffstreams-save').click();
  await view.control.catalogGate.started.promise;await view.page.locator('#buffstreams-cancel').click();
  view.control.catalogGate.resolve();await view.page.waitForTimeout(150);
  assert.equal((await state(view)).source,defaultBase+'/home6');assert.equal(await games(view).count(),3);
  assert.equal((await state(view)).catalog.events[0].eventUrl,catalogFor().events[0].eventUrl);
  assert.equal(await view.page.locator('#buffstreams-cancel').isVisible(),false);assert.equal(view.providerRequests.length,0);
});

test('leaving Buffstreams cancels a pending player and keeps existing Sports counts unchanged',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);view.control.playerGate=gate();const popup=await startWatch(view);await view.control.playerGate.started.promise;
  const closed=popup.waitForEvent('close');await view.page.locator('[data-sports-mode="replay"]').click();await closed;
  view.control.playerGate.resolve();await view.page.waitForTimeout(150);
  assert.equal(await view.page.locator('#buffstreams-panel').isVisible(),false);assert.equal(await view.page.locator('#sports-grid .sports-card').count(),157);
  assert.equal(await view.page.locator('#sports-live-count').textContent(),'(36)');assert.equal(await view.page.locator('#sports-replay-count').textContent(),'(157)');
  assert.equal(view.providerRequests.length,0);
  await view.page.locator('[data-sports-mode="live"]').click();assert.equal(await view.page.locator('#sports-grid .sports-card').count(),36);
});

test('a delayed bundled Sports response cannot restart Buffstreams after switching to Movies',{timeout:25000},async t=>{
  const bundleGate=gate(),view=await buffstreamsPage(t,{enter:false,bundleGate,traceDeskTimer:true});
  await bundleGate.started.promise;view.control.catalogGate=gate();
  await view.page.locator('[data-sports-mode="buffstreams"]').click();await view.control.catalogGate.started.promise;
  assert.equal(await view.page.evaluate(()=>window.__buffstreamsDeskIntervalCount()),1);
  await view.page.locator('#open-cinema').click();
  assert.equal(await view.page.locator('#sports-panel').isVisible(),false);
  assert.equal(await view.page.evaluate(()=>window.__buffstreamsDeskIntervalCount()),0);
  const calls=helpers(view,'/api/catalog').length;
  view.control.catalogGate.resolve();bundleGate.resolve();
  await view.page.waitForFunction(()=>document.getElementById('sports-live-count').textContent==='(36)');
  await view.page.waitForTimeout(150);
  assert.equal(await view.page.locator('#sports-panel').isVisible(),false);
  assert.equal(await view.page.evaluate(()=>window.__buffstreamsDeskIntervalCount()),0);
  assert.equal(helpers(view,'/api/catalog').length,calls);
  assert.equal(view.providerRequests.length,0);
});

test('cached games and local filters survive reload without presenting stale entries as live',{timeout:25000},async t=>{
  const cached=catalogFor(defaultBase,{fetchedAt:new Date(Date.now()-86400000).toISOString()});
  const savedState={source:cached.source,catalog:cached,search:'Sabres',sport:'Hockey',liveOnly:true};
  const view=await buffstreamsPage(t,{savedState,enter:false});view.control.catalogResponse={status:503,json:{error:'Fixture offline'}};
  await view.page.locator('[data-sports-mode="buffstreams"]').click();await view.page.waitForSelector('#buffstreams-panel');
  await view.page.waitForFunction(()=>document.getElementById('buffstreams-cancel').hidden);
  assert.equal(await games(view).count(),0);assert.equal(await view.page.locator('#buffstreams-search').inputValue(),'Sabres');
  assert.equal(await view.page.locator('#buffstreams-sport').inputValue(),'Hockey');assert.equal(await view.page.locator('#buffstreams-live-only').isChecked(),true);
  assert.match(await view.page.locator('#buffstreams-updated').textContent(),/saved|refresh/i);
  assert.match(await view.page.locator('#buffstreams-events').textContent(),/refresh.*live/i);
  await view.page.locator('#buffstreams-live-only').uncheck();assert.equal(await games(view).count(),1);
  assert.match(await games(view).textContent(),/listed live when saved/i);
  assert.equal((await games(view).textContent()).includes('Live on source'),false);
  await view.page.locator('#buffstreams-search').fill('Bruins');await view.page.reload();await view.page.locator('[data-sports-mode="buffstreams"]').click();await games(view).first().waitFor();
  assert.equal(await view.page.locator('#buffstreams-search').inputValue(),'Bruins');assert.equal(await games(view).count(),1);
  assert.equal(await view.page.locator('#buffstreams-sport').inputValue(),'Hockey');assert.equal(await view.page.locator('#buffstreams-live-only').isChecked(),false);
});

test('Kid Mode guards visible Watch buttons, refresh, address changes and a resolved fallback link',{timeout:25000},async t=>{
  const view=await buffstreamsPage(t);await openAddressSettings(view.page);await view.page.evaluate(()=>{window.open=()=>null;});
  await view.page.locator('[data-buffstreams-watch="nfl:123"]').click();await view.page.locator('#buffstreams-open-player').waitFor({state:'visible'});
  const before=await state(view),calls=view.helperRequests.length;
  await view.page.evaluate(async()=>{const {updateKidProfile}=await import('./parental-controls.js');updateKidProfile('viewer-1',{enabled:true});});
  let popups=0;view.context.on('page',()=>popups++);
  await view.page.locator('#buffstreams-open-player').click();await view.page.locator('[data-buffstreams-watch="nfl:123"]').click();
  await view.page.locator('#buffstreams-refresh').click();await view.page.locator('#buffstreams-address').fill('https://new-buffstreams.example');
  await view.page.locator('#buffstreams-save').click();await view.page.locator('#buffstreams-reset').click();
  assert.equal(popups,0);assert.equal(view.providerRequests.length,0);assert.equal(view.helperRequests.length,calls);assert.deepEqual(await state(view),before);
  assert.match(await view.page.locator('#buffstreams-message').textContent(),/adult viewer/i);
  await view.page.locator('#open-cinema').click();await view.page.locator('#open-sports').click();assert.equal(await view.page.locator('#sports-panel').isVisible(),false);
  assert.match(await view.page.locator('#sports-nav-message').textContent(),/adult viewer/i);
});

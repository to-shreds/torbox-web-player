// Live search regressions with local catalog fixtures. No external services,
// real account data, or media downloads are involved.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { Catalog, CATALOG_SECONDARY, IMDB_SUGGEST_ORIGIN } from '../../lib/catalog.mjs';
import { startFixture } from './fixture.mjs';

let browser, fixture, originalCatalog;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const original={id:'tt0773262',type:'series',name:'Dexter',releaseInfo:'2006–2013',videos:[{id:'tt0773262:1:1',season:1,episode:1,name:'Pilot',released:'2006-10-01'}]};
const newBlood={id:'tt14164730',type:'series',name:'Dexter: New Blood',releaseInfo:'2021',videos:[]};
const resurrection={id:'tt3000001',type:'series',name:'Dexter: Resurrection',releaseInfo:'2025',videos:[]};
const unrelatedMovie={id:'tt3000002',type:'movie',name:'Dexter',releaseInfo:'2025',poster:'https://images.metahub.space/poster/small/tt3000002/img'};
const uiMeta=(name,id)=>({id,type:'series',name,year:'2024',poster:'',episodes:[]});

before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  fixture=await startFixture(4202);originalCatalog=fixture.discovery.catalog;
});
after(async()=>{await browser?.close();await fixture?.close();});

async function pageFor(t){
  fixture.discovery.catalog=originalCatalog;
  Object.assign(fixture.control,{sessionDelay:0,statusDelay:0,lookupDelay:0,cached:true,playbackCalls:0,creates:0});
  fixture.discovery.tickets.clear();fixture.discovery.operations.clear();
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(token=>sessionStorage.setItem('torbox-web-session',token),fixture.session());
  await context.route('https://**/*',route=>route.abort());
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.equal(fixture.control.playbackCalls,0);assert.equal(fixture.control.creates,0);});
  return{page,context};
}
async function home(page){await page.goto(fixture.origin);await page.waitForSelector('#workspace:not([hidden])');await page.locator('#catalog-grid .poster-card').first().waitFor();}
async function names(page){return page.locator('#catalog-grid .poster-card > strong').allTextContents();}
async function waitNames(page,expected){await page.waitForFunction(expected=>{const names=[...document.querySelectorAll('#catalog-grid .poster-card > strong')].map(el=>el.textContent);return expected.every(name=>names.includes(name));},expected);}

test('typing Dexte then Dexter retains the original series despite a fast incomplete backup and a same-name movie',async t=>{
  const {page}=await pageFor(t),queries=[],metadataRequests=[];
  fixture.discovery.catalog=new Catalog({fetchFn:async input=>{
    const url=new URL(input),meta=/\/meta\/(movie|series)\/(tt\d+)\.json$/.exec(url.pathname);
    if(meta){const row=[original,newBlood,resurrection,unrelatedMovie].find(row=>row.id===meta[2]&&row.type===meta[1]);return row?Response.json({meta:row}):Response.json({}, {status:404});}
    if(url.origin===IMDB_SUGGEST_ORIGIN)return Response.json({d:[]});
    const type=url.pathname.includes('/series/')?'series':'movie';
    const query=decodeURIComponent(/search=([^&]+?)(?:\.json|&|$)/.exec(url.pathname)?.[1]||'');
    if(!query)return Response.json({metas:type==='series'?[original]:[unrelatedMovie]});
    if(type==='movie')return Response.json({metas:[unrelatedMovie]});
    if(url.origin===CATALOG_SECONDARY){if(query==='Dexte')await pause(150);return Response.json({metas:[resurrection]});}
    await pause(80);return Response.json({metas:[original,newBlood,resurrection]});
  }});
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/discover/catalog'&&url.searchParams.get('q'))queries.push({q:url.searchParams.get('q'),type:url.searchParams.get('type')});if(url.pathname==='/api/discover/meta')metadataRequests.push(url);});
  await home(page);await page.locator('#search').fill('Dexte');await waitNames(page,['Dexter: New Blood']);
  assert.equal(await page.locator('#catalog-grid .poster-card').filter({hasText:'2006'}).count(),1);
  const exactResponse=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/discover/catalog'&&url.searchParams.get('q')==='Dexter';});
  await page.locator('#search').fill('Dexter');await exactResponse;
  await page.waitForFunction(()=>document.querySelector('#catalog-message').textContent.endsWith('results')&&document.querySelector('#search-results-heading').textContent.includes('“Dexter”'));
  await waitNames(page,['Dexter: New Blood']);
  const originalCard=page.locator('#catalog-grid .poster-card').filter({hasText:'2006'});
  assert.equal(await originalCard.count(),1,'the original series must survive a same-name movie with a more complete poster');
  assert.ok((await names(page)).includes('Dexter: Resurrection'));
  assert.deepEqual(queries.map(row=>row.q),['Dexte','Dexter']);assert.ok(queries.every(row=>row.type==='all'),'live search includes movies and shows regardless of browse filter');
  await originalCard.click();await page.locator('#detail-title').filter({hasText:/^Dexter$/}).waitFor();
  assert.ok(metadataRequests.some(url=>url.searchParams.get('id')==='tt0773262'&&url.searchParams.get('type')==='series'),'opening original series preserves its exact IMDb identity and type');
});

test('input immediately clears old cards and pagination, while Enter runs the latest search once',async t=>{
  const {page,context}=await pageFor(t),queries=[];
  await context.route('**/api/discover/catalog?**',route=>{
    const query=new URL(route.request().url()).searchParams.get('q');if(!query)return route.continue();
    queries.push(query);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({metas:[uiMeta(query==='Dexte'?'Prior query result':'Current query result','tt4000003')],nextSkip:query==='Dexte'?100:null})});
  });
  await home(page);await page.locator('#search').fill('Dexte');await waitNames(page,['Prior query result']);
  assert.equal(await page.locator('#catalog-more').isVisible(),true);
  await page.locator('#search').fill('Dexter');
  const pending=await page.evaluate(()=>({cards:document.querySelectorAll('#catalog-grid .poster-card').length,moreHidden:document.querySelector('#catalog-more').hidden,moreDisabled:document.querySelector('#catalog-more').disabled,status:document.querySelector('#catalog-message').textContent}));
  assert.deepEqual(pending,{cards:0,moreHidden:true,moreDisabled:true,status:'Searching…'});
  await page.locator('#search').press('Enter');await waitNames(page,['Current query result']);await page.waitForTimeout(450);
  assert.deepEqual(queries,['Dexte','Dexter'],'Enter cancels the scheduled debounce request');
});

test('a late Dexte response cannot replace the newer Dexter results',async t=>{
  const {page,context}=await pageFor(t),started=deferred(),release=deferred(),finished=deferred();
  await context.route('**/api/discover/catalog?**',async route=>{
    const query=new URL(route.request().url()).searchParams.get('q');
    if(!query)return route.continue();
    if(query==='Dexte'){
      started.resolve();await release.promise;
      try{await route.fulfill({contentType:'application/json',body:JSON.stringify({metas:[uiMeta('Old partial result','tt4000001')],nextSkip:null})});}finally{finished.resolve();}
      return;
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify({metas:[uiMeta('Dexter','tt0773262'),uiMeta('Dexter: New Blood','tt14164730')],nextSkip:null})});
  });
  await home(page);await page.locator('#search').fill('Dexte');await started.promise;
  await page.locator('#search').fill('Dexter');await waitNames(page,['Dexter','Dexter: New Blood']);
  release.resolve();await finished.promise;await page.waitForTimeout(150);
  assert.deepEqual(await names(page),['Dexter','Dexter: New Blood']);
  assert.equal(await page.locator('#catalog-message').textContent(),'2 results');
  assert.match(await page.locator('#search-results-heading').textContent(),/“Dexter”/);
});

test('clearing a pending search restores browse and ignores its late response',async t=>{
  const {page,context}=await pageFor(t),started=deferred(),release=deferred(),finished=deferred();
  await context.route('**/api/discover/catalog?**',async route=>{
    const query=new URL(route.request().url()).searchParams.get('q');if(!query)return route.continue();
    started.resolve();await release.promise;
    try{await route.fulfill({contentType:'application/json',body:JSON.stringify({metas:[uiMeta('Late search result','tt4000002')],nextSkip:null})});}finally{finished.resolve();}
  });
  await home(page);await page.locator('#search').fill('Dexter');await started.promise;
  await page.locator('#search').fill('');await waitNames(page,['Fixture Show']);
  release.resolve();await finished.promise;await page.waitForTimeout(150);
  assert.deepEqual(await names(page),['Fixture Show']);
  assert.equal(await page.locator('#search-results-heading').isHidden(),true);
  assert.equal(await page.locator('body').evaluate(body=>body.classList.contains('search-mode')),false);
});

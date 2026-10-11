import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

const defaultBase='https://mybuffstreams.plus';
const storageKey='tw-buffstreams-base';
const destinations={all:'/',nfl:'/nflstreams2',cfb:'/cfbstreams2',nhl:'/nhlstreams2'};
let browser,fixture;
before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  fixture=await startFixture(4187);
});
after(async()=>{await browser?.close();await fixture?.close();});

async function buffstreamsPage(t,{savedBase}={}){
  Object.assign(fixture.control,{playbackCalls:0,logins:0,mediaFetches:0});
  const context=await browser.newContext({viewport:{width:1000,height:760},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[],requests=[],providerRequests=[];
  page.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  if(savedBase)await context.addInitScript(({key,base})=>localStorage.setItem(key,base),{key:storageKey,base:savedBase});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===fixture.origin)return route.continue();
    if(url.hostname.includes('buffstreams')){
      providerRequests.push({url:request.url(),headers:await request.allHeaders()});
      return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture provider tab</title><p>Local intercepted provider</p>'});
    }
    return route.abort();
  });
  await context.route('**/api/session',()=>{}); // Deliberately hung private service.
  await page.goto(fixture.origin+'/?torbox_key=private-fixture-key&token=private-token#sports');
  await page.waitForSelector('.sports-card');
  await page.locator('[data-sports-mode="buffstreams"]').click();
  await page.waitForSelector('#buffstreams-panel');
  return {context,page,requests,providerRequests};
}

async function openLink(view,id,base=defaultBase){
  const destination=base+destinations[id];
  const [popup]=await Promise.all([view.context.waitForEvent('page'),view.page.locator(`[data-buffstreams-id="${id}"]`).click()]);
  await popup.waitForURL(destination);await popup.waitForLoadState('domcontentloaded');
  assert.equal(await popup.evaluate(()=>window.opener===null),true);
  assert.equal(popup.url(),destination);
  const request=view.providerRequests.at(-1);
  assert.equal(request.url,destination);
  assert.equal(request.headers.referer,undefined);
  assert.equal(request.headers.authorization,undefined);
  assert.equal(new URL(request.url).search,'');
  assert.equal(new URL(request.url).hash,'');
  assert.equal(request.url.includes('private-fixture-key'),false);
  assert.equal(request.url.includes('private-token'),false);
  await popup.close();
}

async function openAddressSettings(page){
  const settings=page.locator('.buffstreams-settings');
  if(!await settings.evaluate(element=>element.open))await settings.locator('summary').click();
}

test('Buffstreams sport links open separate anonymous tabs while TorBox startup is hung',async t=>{
  const view=await buffstreamsPage(t);
  assert.equal(await view.page.locator('#buffstreams-message').getAttribute('role'),'status');
  assert.deepEqual(await view.page.locator('#buffstreams-links a[data-buffstreams-id]').evaluateAll(links=>links.map(link=>link.dataset.buffstreamsId)),Object.keys(destinations));
  for(const id of Object.keys(destinations)){
    const link=view.page.locator(`[data-buffstreams-id="${id}"]`);
    assert.equal(await link.getAttribute('target'),'_blank');
    assert.deepEqual(new Set((await link.getAttribute('rel')).split(/\s+/)),new Set(['noopener','noreferrer']));
    assert.equal(await link.getAttribute('referrerpolicy'),'no-referrer');
    await openLink(view,id);
  }
  assert.equal(view.providerRequests.length,4);
  assert.equal(view.requests.filter(url=>new URL(url).origin===fixture.origin&&/^\/(?:api\/|healthz)/.test(new URL(url).pathname)).length,0);
  assert.equal(fixture.control.logins,0);assert.equal(fixture.control.playbackCalls,0);assert.equal(fixture.control.mediaFetches,0);
});

test('a new Buffstreams root updates every shortcut, persists reload and can reset to the default',async t=>{
  const view=await buffstreamsPage(t),base='https://new-buffstreams.example';
  await openAddressSettings(view.page);
  await view.page.locator('#buffstreams-address').fill(base+'/watch/game');
  await view.page.locator('#buffstreams-save').click();
  assert.equal(await view.page.evaluate(key=>localStorage.getItem(key),storageKey),base);
  for(const [id,path] of Object.entries(destinations))assert.equal(await view.page.locator(`[data-buffstreams-id="${id}"]`).getAttribute('href'),base+path);
  await view.page.reload();await view.page.locator('[data-sports-mode="buffstreams"]').click();
  assert.equal(await view.page.locator('#buffstreams-address').inputValue(),base);
  await openLink(view,'nfl',base);
  await openAddressSettings(view.page);
  await view.page.locator('#buffstreams-reset').click();
  assert.equal(await view.page.locator('#buffstreams-address').inputValue(),defaultBase);
  await view.page.reload();await view.page.locator('[data-sports-mode="buffstreams"]').click();
  assert.equal(await view.page.locator('[data-buffstreams-id="nhl"]').getAttribute('href'),defaultBase+'/nhlstreams2');
});

test('invalid Buffstreams address edits preserve the last working shortcuts',async t=>{
  const view=await buffstreamsPage(t),base='https://new-buffstreams.example';
  await openAddressSettings(view.page);
  await view.page.locator('#buffstreams-address').fill(base);await view.page.locator('#buffstreams-save').click();
  for(const address of ['https://example.com','https://user:secret@mybuffstreams.plus','https://mybuffstreams.plus?key=private','http://mybuffstreams.plus']){
    await view.page.locator('#buffstreams-address').fill(address);await view.page.locator('#buffstreams-save').click();
    assert.equal(await view.page.locator('[data-buffstreams-id="all"]').getAttribute('href'),base+'/');
    assert.equal(await view.page.evaluate(key=>localStorage.getItem(key),storageKey),base);
    assert.ok((await view.page.locator('#buffstreams-message').textContent()).trim());
  }
  assert.equal(view.providerRequests.length,0);
});

test('Buffstreams mode leaves existing channel and replay counts intact and hides when switching modes',async t=>{
  const view=await buffstreamsPage(t);
  assert.equal(await view.page.locator('#sports-live-count').textContent(),'(36)');
  assert.equal(await view.page.locator('#sports-replay-count').textContent(),'(157)');
  assert.equal(await view.page.locator('#sports-grid').isVisible(),false);
  await view.page.locator('[data-sports-mode="replay"]').click();
  assert.equal(await view.page.locator('#buffstreams-panel').isVisible(),false);
  assert.equal(await view.page.locator('.sports-card').count(),157);
  await view.page.locator('[data-sports-mode="buffstreams"]').click();
  assert.equal(await view.page.locator('#buffstreams-panel').isVisible(),true);
  await view.page.locator('[data-sports-mode="live"]').click();
  assert.equal(await view.page.locator('#buffstreams-panel').isVisible(),false);
  assert.equal(await view.page.locator('.sports-card').count(),36);
  assert.equal(await view.page.locator('#sports-live-count').textContent(),'(36)');
  assert.equal(await view.page.locator('#sports-replay-count').textContent(),'(157)');
});

test('switching into Kid Mode blocks an already visible Buffstreams link and address edits',async t=>{
  const view=await buffstreamsPage(t),base='https://new-buffstreams.example';
  await openAddressSettings(view.page);
  await view.page.locator('#buffstreams-address').fill(base);await view.page.locator('#buffstreams-save').click();
  await view.page.evaluate(async()=>{
    const {updateKidProfile}=await import('./parental-controls.js');
    updateKidProfile('viewer-1',{enabled:true});
  });
  let popups=0;view.context.on('page',()=>popups++);
  for(const id of Object.keys(destinations))await view.page.locator(`[data-buffstreams-id="${id}"]`).click();
  assert.equal(popups,0);assert.equal(view.providerRequests.length,0);
  await view.page.locator('#buffstreams-address').fill('https://other-buffstreams.example');
  await view.page.locator('#buffstreams-save').click();await view.page.locator('#buffstreams-reset').click();
  assert.equal(await view.page.evaluate(key=>localStorage.getItem(key),storageKey),base);
  assert.equal(await view.page.locator('[data-buffstreams-id="nfl"]').getAttribute('href'),base+'/nflstreams2');
  assert.match(await view.page.locator('#buffstreams-message').textContent(),/adult viewer/i);
  await view.page.locator('#open-cinema').click();await view.page.locator('#open-sports').click();
  assert.equal(await view.page.locator('#sports-panel').isVisible(),false);
  assert.match(await view.page.locator('#sports-nav-message').textContent(),/adult viewer/i);
});

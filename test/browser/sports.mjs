import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';
let browser,fixture;
const catalog=JSON.parse(await readFile(new URL('../../public/sports-catalog.json',import.meta.url),'utf8'));
const playlist=await readFile(new URL('../fixtures/sports/playlist.m3u8',import.meta.url));
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});fixture=await startFixture(4181);});
after(async()=>{await browser?.close();await fixture?.close();});
async function sportsPage(t,{blocked=false,slowReplay=false}={}){
  Object.assign(fixture.control,{playbackCalls:0,logins:0,mediaFetches:0});
  const context=await browser.newContext({viewport:{width:1000,height:760},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/api/session',()=>{}); // Deliberately hung private service.
  let mediaRequests=0,apiRequests=0;
  const mediaRoute=async route=>{
    mediaRequests++;const path=new URL(route.request().url()).pathname;
    if(blocked)return route.abort();
    if(path.endsWith('.m3u8'))return route.fulfill({contentType:'application/vnd.apple.mpegurl',body:playlist,headers:{'Access-Control-Allow-Origin':'*'}});
    const file=path.split('/').at(-1);
    if(!/^segment\d+\.ts$/.test(file))return route.abort();
    return route.fulfill({contentType:'video/mp2t',body:await readFile(new URL('../fixtures/sports/'+file,import.meta.url)),headers:{'Access-Control-Allow-Origin':'*'}});
  };
  await context.route('https://amg01444-tennischannel-amg01444c2-lg-us-959.playouts.now.amagi.tv/**',mediaRoute);
  await context.route('https://play.redbull.com/**',mediaRoute);
  await context.route('https://api-player.redbull.com/**',async route=>{apiRequests++;assert.equal(route.request().headers().authorization,undefined);assert.equal(route.request().headers().cookie,undefined);if(slowReplay)await new Promise(r=>setTimeout(r,400));return route.fulfill({json:{videoUrl:'https://play.redbull.com/fixture/playlist.m3u8',playabilityErrors:[],description:'WINNER SPOILER'},headers:{'Access-Control-Allow-Origin':'*'}});});
  await page.goto(fixture.origin);await page.locator('#open-sports').click();await page.waitForSelector('.sports-card');
  return {context,page,mediaRequests:()=>mediaRequests,apiRequests:()=>apiRequests};
}
test('sports opens and plays HLS tennis while private startup is hung, with no TorBox login or media relay',async t=>{
  const {page,mediaRequests}=await sportsPage(t);await page.locator('[data-sports-id="t2"]').click();
  await page.waitForFunction(()=>document.querySelector('#sports-video').currentTime>0);
  assert.ok(mediaRequests()>1);assert.equal(fixture.control.playbackCalls,0);assert.equal(fixture.control.mediaFetches,0);assert.equal(fixture.control.logins,0);
  await page.locator('#close-sports-player').click();assert.equal(await page.locator('#sports-video').getAttribute('src'),null);assert.equal(await page.locator('#sports-panel').isVisible(),true);
});
test('padel full replay resolves anonymously, resumes and starts over without showing result text',async t=>{
  const {page,apiRequests}=await sportsPage(t);const replay=catalog.items.find(x=>x.kind==='replay');
  await page.evaluate(id=>localStorage.setItem('tw-sports-resume:'+id,JSON.stringify({position:20,duration:60})),replay.id);
  await page.locator('[data-sports-mode="replay"]').click();await page.locator('#sports-sport').selectOption('padel');await page.locator(`[data-sports-id="${replay.id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#sports-video').currentTime>=15);assert.equal(apiRequests(),1);assert.equal((await page.locator('#sports-panel').textContent()).includes('WINNER SPOILER'),false);
  await page.locator('#sports-start-over').click();await page.waitForFunction(()=>{const v=document.querySelector('#sports-video');return v.currentTime>0&&v.currentTime<10;});
  assert.equal(await page.locator('#sports-live-edge').isVisible(),false);
});
test('closing a resolving sports replay prevents late media and leaves the catalog usable',async t=>{
  const {page,mediaRequests}=await sportsPage(t,{slowReplay:true});await page.locator('[data-sports-mode="replay"]').click();await page.locator('.sports-card').first().click();await page.locator('#close-sports-player').click();await new Promise(r=>setTimeout(r,700));
  assert.equal(mediaRequests(),0);assert.equal(await page.locator('#sports-player').evaluate(e=>e.open),false);await page.locator('#open-cinema').click();assert.equal(await page.locator('#loading').isVisible(),true);
});
test('failed sports HLS reports retry and remains bounded',async t=>{
  const {page,mediaRequests}=await sportsPage(t,{blocked:true});await page.locator('[data-sports-id="t2"]').click();await page.waitForSelector('#sports-retry:not([hidden])');assert.match(await page.locator('#sports-player-message').textContent(),/unavailable|could not/);assert.ok(mediaRequests()<8);
});
test('Sports requires an adult viewer so it cannot bypass Kid Mode allowances',async t=>{
  const {page}=await sportsPage(t);await page.locator('#open-cinema').click();
  await page.evaluate(async()=>{const {updateKidProfile}=await import('./parental-controls.js?v=release-1.2.1-startup.1');updateKidProfile('viewer-1',{enabled:true});});
  await page.locator('#open-sports').click();assert.equal(await page.locator('#sports-panel').isVisible(),false);assert.match(await page.locator('#sports-nav-message').textContent(),/adult viewer/);
});

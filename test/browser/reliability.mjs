import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { startFixture, target } from './fixture.mjs';
let browser,fixture;
const media=await readFile(new URL('../fixtures/fixture.mp4',import.meta.url));
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});fixture=await startFixture();});
after(async()=>{await browser?.close();await fixture?.close();});
async function pageFor(t,{saved=false,mediaMode='play',speedTimeouts=false,signedIn=true}={}){
  Object.assign(fixture.control,{sessionDelay:0,progressDelay:0,statusDelay:0,lookupDelay:0,cached:true,created:false,creates:0,playbackCalls:0,mediaFetches:0,logins:0});
  fixture.discovery.tickets.clear();fixture.discovery.operations.clear();
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  const token=signedIn?fixture.session():'';
  await page.addInitScript(({token,speedTimeouts})=>{
    if(token)sessionStorage.setItem('torbox-web-session',token);
    if(speedTimeouts){const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===25000?250:ms,...args);}
  },{token,speedTimeouts});
  // Playwright routes only the first URL in a redirect chain. Verify the actual
  // backend's header-only redirect, then stand in for the CDN with our own tiny
  // generated MP4. No test contacts TorBox or sends real video through the app.
  await context.route('**/media/*',async route=>{
    const redirect=await route.fetch({maxRedirects:0});
    assert.equal(redirect.status(),307);
    assert.equal((await redirect.body()).length,0);
    assert.equal(new URL(redirect.headers().location).hostname,'store.tb-cdn.io');
    if(mediaMode==='hang')return;
    if(mediaMode==='fail')return route.abort('failed');
    const range=route.request().headers().range;
    let start=0,end=media.length-1;
    if(range){const match=/bytes=(\d+)-(\d*)/.exec(range);if(match){start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}}
    return route.fulfill({status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
  });
  await context.route('https://**/*',route=>route.abort());
  if(saved){
    // Seed through the real history API once the origin is available, then reload.
    await page.goto(fixture.origin);await page.waitForSelector('#workspace:not([hidden])');
    await page.evaluate(async()=>{const {recordRecent}=await import('./history.js?v=release-1.2.0');recordRecent({current:{type:'series',id:'tt1234567',season:1,episode:1},title:'Fixture Show',episodeName:'One'},40,120);});
  }
  return{page,context,token,errors};
}
async function seriesHome(page){await page.waitForSelector('#workspace:not([hidden])');await page.locator('#catalog-type').selectOption('series');await page.waitForSelector('#catalog-grid button');}
async function home(page){await page.goto(fixture.origin);await seriesHome(page);}
async function playEpisode(page,number=1){
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({hasText:/^Play$/}).nth(number-1).click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
}

test('full UI login, browse, playback and seeking verify the CDN redirect with synthetic media',async t=>{
  const {page}=await pageFor(t,{signedIn:false});await page.goto(fixture.origin);
  await page.locator('#api-key').fill('fixture-master-key');await page.locator('#login-form button[type=submit]').click();
  await seriesHome(page);await playEpisode(page);
  await page.evaluate(()=>{document.querySelector('video').currentTime=30;});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>=30);
  assert.equal(fixture.control.mediaFetches,0);assert.equal(fixture.control.playbackCalls,1);
});

test('catalog renders while a slow TorBox health check is still pending',async t=>{
  const {page}=await pageFor(t);fixture.control.statusDelay=4000;
  const start=performance.now();await home(page);
  assert.ok(performance.now()-start<2500);
});

test('resume keeps the local rewind position and a visible overlay until real playback',async t=>{
  const {page}=await pageFor(t,{saved:true});await home(page);
  await page.locator('#recent-list .recent-card').click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>=30);
  assert.ok(await page.locator('#resume-overlay').isHidden());
  const position=await page.locator('video').evaluate(video=>video.currentTime);assert.ok(position>=30&&position<35);
});

test('canceling Resume during slow source lookup cannot reopen the player',async t=>{
  const {page}=await pageFor(t,{saved:true});fixture.control.lookupDelay=650;await home(page);
  await page.locator('#recent-list .recent-card').click();await page.locator('#cancel-resume').click();
  await page.waitForTimeout(900);
  assert.equal(fixture.control.playbackCalls,0);assert.ok(await page.locator('#resume-overlay').isHidden());assert.equal(await page.locator('#player').evaluate(el=>el.open),false);
});

test('closing a title during a slow Play request prevents late playback',async t=>{
  const {page}=await pageFor(t);fixture.control.lookupDelay=650;await home(page);
  await page.locator('#catalog-grid button').first().click();await page.locator('#episode-area button').filter({hasText:/^Play$/}).first().click();
  await page.locator('#close-title').click();await page.waitForTimeout(900);
  assert.equal(fixture.control.playbackCalls,0);assert.equal(await page.locator('#player').evaluate(el=>el.open),false);
});

test('slow progress saves do not block auto-next and the actual video element survives',async t=>{
  const {page}=await pageFor(t);await home(page);await playEpisode(page);
  fixture.control.progressDelay=6000;
  const oldSource=await page.locator('video').evaluate(video=>video.src);
  await page.locator('video').evaluate(video=>{video.dataset.identity='original';video.currentTime=112;});
  await page.locator('#play-next-now').waitFor({state:'visible'});
  const start=performance.now();await page.locator('#play-next-now').click();
  await page.waitForFunction(old=>{const v=document.querySelector('video');return document.querySelector('#playing-title').textContent.includes('S01E02')&&v?.src!==old&&v.currentTime>0&&v.currentTime<5&&!v.paused;},oldSource);
  assert.ok(performance.now()-start<3000);assert.equal(await page.locator('video').getAttribute('data-identity'),'original');
});

test('an expired background progress session does not stop a playing video',async t=>{
  const {page,token}=await pageFor(t);await home(page);await playEpisode(page);
  fixture.sessions.revoke(fixture.sessions.read(token).id);
  await page.locator('video').evaluate(video=>{video.currentTime=20;});await page.waitForTimeout(400);
  assert.equal(await page.locator('#player').evaluate(el=>el.open),true);assert.ok(await page.locator('#login').isHidden());
  assert.equal(await page.locator('video').evaluate(video=>video.paused),false);
});

test('hung initial media reaches a bounded failure and clears the resume overlay',async t=>{
  const {page}=await pageFor(t,{saved:true,mediaMode:'hang',speedTimeouts:true});await home(page);
  await page.locator('#recent-list .recent-card').click();
  await page.waitForFunction(()=>document.querySelector('#player-message').textContent.includes('did not start'),undefined,{timeout:5000});
  assert.ok(await page.locator('#resume-overlay').isHidden());assert.ok(fixture.control.playbackCalls<=3);
});

test('Resume offers in-app preparation, with no uncached write until explicitly selected',async t=>{
  const {page}=await pageFor(t,{saved:true});fixture.control.cached=false;await home(page);
  await page.locator('#recent-list .recent-card').click();await page.locator('#play-fallback button').first().waitFor();
  assert.equal(fixture.control.creates,0);assert.ok(await page.locator('#resume-overlay').isHidden());
  await page.locator('#play-fallback button').first().click();await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
  assert.equal(fixture.control.creates,1);
});

test('service startup can exceed the old 22-second cutoff without forcing a reload',async t=>{
  const {page}=await pageFor(t);fixture.control.sessionDelay=23000;
  await page.goto(fixture.origin);await page.waitForSelector('#workspace:not([hidden])',{timeout:30000});
  assert.ok(await page.locator('#loading').isHidden());
});

test('rapid episode choices play only the last selected episode',async t=>{
  const {page}=await pageFor(t);fixture.control.lookupDelay=350;await home(page);
  await page.locator('#catalog-grid button').first().click();
  const choices=page.locator('#episode-area .episode-actions button.primary');
  await choices.nth(0).click();await choices.nth(1).click();
  await page.waitForFunction(()=>document.querySelector('video')?.currentTime>0);
  assert.match(await page.locator('#playing-title').textContent(),/S01E02/);
  assert.equal(fixture.control.playbackCalls,1);
});

test('a remembered encrypted key reconnects after a backend session restart',async t=>{
  const {page}=await pageFor(t);await home(page);
  await page.evaluate(async()=>{const {rememberApiKey}=await import('./vault.js?v=release-1.2.0');await rememberApiKey('fixture-master-key');});
  fixture.sessions.revokeAll();
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({hasText:/^Play$/}).first().waitFor();
  assert.equal(fixture.control.logins,1);assert.ok(await page.locator('#login').isHidden());
});

test('startup errors show a working Try again button',async t=>{
  const {page}=await pageFor(t);let fail=true;
  await page.route('**/api/session',route=>fail?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'STARTING',message:'Still starting'})}):route.continue());
  await page.goto(fixture.origin);await page.locator('#startup-retry').waitFor();
  assert.match(await page.locator('#startup-stage').textContent(),/Could not open/);
  fail=false;await page.locator('#startup-retry').click();await page.waitForSelector('#workspace:not([hidden])');
  assert.ok(await page.locator('#loading').isHidden());
});

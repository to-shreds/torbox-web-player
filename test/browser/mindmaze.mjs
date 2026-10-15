import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';
import {MINDMAZE_URL} from '../../public/extra-games-core.js';

const item={id:'mindmaze-encarta',title:'MindMaze (Encarta browser recreation)',platform:'web',hosted:MINDMAZE_URL,controls:'Use the game controls. Closing ends this session.',keys:[],license:'Author-hosted recreation',source:MINDMAZE_URL};
const child='<!doctype html><html><body style="background:#604010;color:white"><h1>Hosted game fixture</h1><button id="play">Play</button><p id="count">0</p><script>let count=0;document.querySelector("#play").onclick=()=>document.querySelector("#count").textContent=String(++count);addEventListener("message",()=>document.body.dataset.received="yes");</script></body></html>';
let browser,fixture;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});fixture=await startFixture(4203);});
after(async()=>{await browser?.close();await fixture?.close();});
async function open(t,{mobile=false}={}){
  // Playwright's serviceWorkers:block injects navigator.serviceWorker reads
  // into opaque sandbox frames, where the platform correctly throws. Block
  // the local worker request instead so page errors remain meaningful.
  const context=await browser.newContext({viewport:mobile?{width:412,height:915}:{width:1100,height:850},isMobile:mobile,hasTouch:mobile}),page=await context.newPage();
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/sw.js*',route=>route.abort());
  await context.route(MINDMAZE_URL,route=>route.fulfill({contentType:'text/html',body:child}));
  await context.route('**/games-catalog.json*',route=>route.fulfill({json:{version:1,items:[]}}));
  await context.route('**/extra-games-catalog.json*',route=>route.fulfill({json:{version:1,items:[item]}}));
  await page.goto(fixture.origin+'/#games');await page.locator('[data-game-id="mindmaze-encarta"]').click();
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='hosted');
  await page.frameLocator('#extra-game-frame').locator('#play').waitFor();
  return{page,context,requests};
}
test('MindMaze uses the exact creator URL in an opaque sandbox and exposes honest hosted controls',async t=>{
  const {page,requests}=await open(t),frame=page.locator('#extra-game-frame');
  assert.equal(await frame.getAttribute('src'),MINDMAZE_URL);assert.equal(await frame.getAttribute('sandbox'),'allow-scripts');assert.equal(await frame.getAttribute('referrerpolicy'),'no-referrer');
  assert.equal(await frame.evaluate(element=>element.contentDocument),null,'sandboxed creator content must not share the parent document');
  for(const id of ['extra-game-pause','extra-game-restart','extra-game-mute','extra-game-touch']) assert.equal(await page.locator('#'+id).isVisible(),false);
  const link=page.locator('#extra-game-hosted-link');assert.equal(await link.isVisible(),true);assert.equal(await link.getAttribute('href'),MINDMAZE_URL);assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  assert.match(await page.locator('#extra-game-message').textContent(),/Author-hosted.*does not save names or progress/);
  await page.frameLocator('#extra-game-frame').locator('#play').click();
  assert.equal(await page.frameLocator('#extra-game-frame').locator('#count').textContent(),'1');
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'hosted','child focus must keep the iframe open');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:document.querySelector('#extra-game-frame').contentWindow,origin:'null',data:{type:'torbox-extra-status',state:'playing',message:'fake',frames:100}})));
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'hosted');
  assert.equal(requests.filter(url=>url.startsWith('https://gorjan.rocks/')).length,1);
  await page.locator('#close-extra-game-player').click();assert.equal(await frame.getAttribute('src'),null);
});
test('leaving the browser window or changing viewer unloads the hosted game instead of pretending to pause',async t=>{
  const {page}=await open(t);
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));});
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='closed');
  assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);assert.match(await page.locator('#games-message').textContent(),/closed.*progress may restart/);
  await page.evaluate(()=>delete document.hasFocus);await page.locator('[data-game-id="mindmaze-encarta"]').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='hosted');
  await page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-2'));
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='closed');assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);
});
test('MindMaze fullscreen preserves its iframe and mobile layouts expose close and full-page controls',async t=>{
  const {page}=await open(t,{mobile:true});
  for(const viewport of [{width:412,height:915},{width:915,height:412}]){
    await page.setViewportSize(viewport);const box=await page.locator('#extra-game-player').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1);
    assert.equal(await page.locator('#extra-game-hosted-link').isVisible(),true);assert.equal(await page.locator('#close-extra-game-player').isVisible(),true);
  }
  await page.frameLocator('#extra-game-frame').locator('#play').click();
  await page.locator('#extra-game-fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===document.documentElement&&document.body.classList.contains('extra-game-fullscreen'));
  assert.equal(await page.frameLocator('#extra-game-frame').locator('#count').textContent(),'1','fullscreen must preserve the existing hosted session');
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'hosted');
  await page.locator('#close-extra-game-player').click();await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);
});

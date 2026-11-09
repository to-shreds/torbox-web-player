import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

const ids=['snake','breakout','pong','invaders','asteroids','flappy','frog','tron','dodge','highway','ski','catch','missiles','jetpack','blocks','merge','sokoban','lights','connect','reversi','peg','slider','flood','match','sudoku','pipes'];
let browser,fixture;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});fixture=await startFixture(4219);});
after(async()=>{await browser?.close();await fixture?.close();});
async function openPage(t,viewport){
 const context=await browser.newContext({viewport,hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage();const errors=[],privateRequests=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(/\/api\/|\/media\/|\/healthz/.test(new URL(r.url()).pathname))privateRequests.push(r.url());});
 t.after(async()=>{await context.close();assert.deepEqual(errors,[],'no browser exceptions');assert.deepEqual(privateRequests,[],'games do not call private services');});
 await page.goto(fixture.origin+'/#games');
 await page.waitForSelector('[data-game-id="retro-snake"]');
 return{page,context};
}
const gameFrame=page=>page.frameLocator('#extra-game-frame');
async function open(page,id){
 await page.locator(`[data-game-id="${id}"]`).click();
 try {
  await page.waitForFunction(()=>document.querySelector('#extra-game-player')?.dataset.state==='playing',null,{timeout:8000});
 } catch (error) {
  const detail=await page.evaluate(()=>{
    const f=document.querySelector('#extra-game-frame'),d=f?.contentDocument;
    return {
      state:document.querySelector('#extra-game-player')?.dataset.state,
      message:document.querySelector('#extra-game-message')?.textContent,
      src:f?.getAttribute('src'),
      frameURL:d?.URL,
      readyState:d?.readyState,
      childText:d?.body?.innerText?.slice(0,400),
      childBoard:!!d?.querySelector('#board'),
      childTitle:d?.title,
      inlineCSP:d?.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content
    };
  });
  console.error('RETRO_FRAME_DIAGNOSTIC',JSON.stringify(detail));
  throw error;
 }
 await gameFrame(page).locator('#play:not([hidden])').waitFor();
 return gameFrame(page);
}
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
 test(`all 26 retro cards open independently with working controls at ${viewport.width}x${viewport.height}`,async t=>{
  const {page}=await openPage(t,viewport);
  assert.equal(await page.locator('[data-game-id^="retro-"]').count(),27,'26 games and the hub');
  for(const id of ids){
   const child=await open(page,'retro-'+id);
   assert(await child.locator('#gameTitle').isVisible(),id);
   assert(await child.locator('#board').isVisible(),id);
   await child.locator('#board').press('ArrowLeft');
   await child.locator('#toVault').click();
   assert(await child.locator('#cards button.tile').count()===26,id+' can return to vault');
   await page.locator('#close-extra-game-player').click();
   await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='closed');
  }
 });
}
test('parent Pause stops child frames; Resume restarts, Restart resets, exit returns to Games',async t=>{
 const {page}=await openPage(t,{width:412,height:915});
 const child=await open(page,'retro-snake');
 await page.waitForFunction(()=>Number(document.querySelector('#extra-game-player')?.dataset.frames)>0);
 await page.locator('#extra-game-pause').click();
 await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused');
 await page.waitForTimeout(160);
 const frozen=await page.locator('#extra-game-player').getAttribute('data-frames');
 await page.waitForTimeout(900);
 assert.equal(await page.locator('#extra-game-player').getAttribute('data-frames'),frozen,'parent pause freezes child frames');
 await page.locator('#extra-game-pause').click();
 await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='playing');
 await page.waitForFunction(before=>Number(document.querySelector('#extra-game-player').dataset.frames)>before,Number(frozen));
 await page.locator('#extra-game-restart').click();
 await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='playing');
 await child.locator('#gameMenu').click();
 await child.locator('#menuArcade').click();
 await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='closed');
 assert.equal(await page.locator('#games-panel').isVisible(),true);
 assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);
});
test('per-viewer local saves and native touch/controller controls remain usable',async t=>{
 const {page}=await openPage(t,{width:390,height:844});
 const child=await open(page,'retro-merge');
 await child.locator('#board').press('ArrowUp');
 const saved=await child.locator('body').evaluate(()=>JSON.parse(localStorage.getItem('torbox.retro.viewer-1.save.merge')));
 assert.equal(saved?.mode,'merge');
 await page.locator('#close-extra-game-player').click();
 const again=await open(page,'retro-merge');
 assert.match(await again.locator('#subhint').innerText(),/Saved game resumed/);
 await again.locator('#gameMenu').click();
 await again.locator('#controller').click();
 await again.locator('#controllerPanel:not([hidden])').waitFor();
 assert(await again.locator('#mapA').isVisible());
 await again.locator('#closeController').click();
 await page.locator('#close-extra-game-player').click();
});
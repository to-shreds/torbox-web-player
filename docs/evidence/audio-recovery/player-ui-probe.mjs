import { chromium } from 'playwright';
import { startFixture } from '../../../test/browser/fixture.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../', import.meta.url)), media=await readFile(root+'/test/fixtures/fixture.mp4');
const fixture=await startFixture(4217), browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/tmp/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
try {
const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage();
await page.addInitScript(token=>{sessionStorage.setItem('torbox-web-session',token);localStorage.setItem('torbox-settings-v1',JSON.stringify({autoNext:false,showPlaybackHealth:false,interfaceMode:'simple'}));},fixture.session());
await context.route('https://**/*',route=>route.abort());
await context.route('**/media/*',async route=>{const response=await route.fetch({maxRedirects:0});if(response.status()!==307)throw new Error('Expected redirect');const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;await route.fulfill({status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});});
await page.goto(fixture.origin);await page.waitForSelector('#workspace:not([hidden])');await page.locator('#catalog-type').selectOption('series');await page.locator('#catalog-grid button').first().click();await page.locator('#episode-area button').filter({hasText:/^Play$/}).first().click();await page.waitForFunction(()=>document.querySelector('#video-slot video')?.webkitAudioDecodedByteCount>0&&document.querySelector('#video-slot video')?.currentTime>.2);
await page.screenshot({path:root+'/docs/evidence/audio-recovery/player-phone.png'});
const normal={buttonVisible:await page.locator('#player-sound-bad').isVisible(),bounds:await page.locator('#player-sound-bad').boundingBox(),healthVisible:await page.locator('#playback-health').isVisible(),state:await page.locator('#video-slot video').evaluate(v=>({audioBytes:v.webkitAudioDecodedByteCount,time:v.currentTime}))};
await page.setViewportSize({width:915,height:412});await page.locator('#toggle-fullscreen').click();await page.waitForFunction(()=>Boolean(document.fullscreenElement));await page.locator('#player-media-shell').dispatchEvent('pointerdown');await page.screenshot({path:root+'/docs/evidence/audio-recovery/player-fullscreen.png'});
const fullscreen={active:await page.evaluate(()=>document.fullscreenElement?.id),buttonVisible:await page.locator('#fullscreen-sound-bad').isVisible(),bounds:await page.locator('#fullscreen-sound-bad').boundingBox()};
const report={normal,fullscreen,limitations:'Desktop Chromium with mobile emulation. Visibility and native playback only; no physical phone or real account.'};console.log(JSON.stringify(report));await writeFile(root+'/docs/evidence/audio-recovery/player-ui.json',JSON.stringify(report,null,2)+'\n');
}finally{await browser.close();await fixture.close();}

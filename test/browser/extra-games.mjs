import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {startFixture} from './fixture.mjs';
const {PNG}=createRequire(import.meta.url)('../../node_modules/playwright-core/lib/utilsBundle.js');

const original = {id:'original-extra',title:'Alpha Original Browser Game',platform:'web',page:'games-web/original-extra/index.html',controls:'Use the game or arrow controls.',keys:[{label:'Left',code:37},{label:'Jump',code:32}],license:'MIT',source:'https://example.org/source'};
const dos = {id:'dos-extra',title:'Zulu Original DOS Fixture',platform:'dos',bundle:'games-data/dos-extra.jsdos',controls:'Keyboard arrows.',keys:[{label:'Up',code:265}],license:'MIT',source:'https://example.org/source'};
const catalog = {version:1,items:[dos,original]};
const mockChild = `<!doctype html><html><body style="background:#1437ee"><button id="child">Original child game</button><p id="keys">0</p><p id="commands">0</p><p id="child-state"></p><p id="child-frames">0</p><script>
let state='paused',frames=0,keys=0,commands=0;
const report=()=>{document.querySelector('#child-state').textContent=state;document.querySelector('#child-frames').textContent=frames;parent.postMessage({type:'torbox-extra-status',state,message:state==='playing'?'Playing original fixture.':'Ready. Press Resume.',frames},location.origin);};
addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin||event.data.type!=='torbox-extra-command')return;commands++;document.querySelector('#commands').textContent=commands;const data=event.data;if(data.command==='resume')state='playing';if(data.command==='pause')state='paused';if(data.command==='close'){state='closed';clearInterval(timer);return;}if(data.command==='key'&&data.pressed){keys++;document.querySelector('#keys').textContent=keys;}report();});
addEventListener('blur',()=>{if(state==='playing'){state='paused';report();}});
const timer=setInterval(()=>{if(state==='playing'){frames++;document.querySelector('#child-frames').textContent=frames;if(frames%5===0)report();}},20);report();
</script></body></html>`;
let browser,fixture;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});fixture=await startFixture(4191);});
after(async()=>{await browser?.close();await fixture?.close();});
async function pageFor(t,{extras=catalog,nes={version:1,items:[]},mobile=false,extraFailure=false}={}) {
  const context=await browser.newContext({viewport:mobile?{width:412,height:915}:{width:1000,height:800},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],requests=[];page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/games-catalog.json*',route=>route.fulfill({json:nes}));
  await context.route('**/extra-games-catalog.json*',route=>extraFailure?route.fulfill({status:503,body:'unavailable'}):route.fulfill({json:extras}));
  await context.route('**/games-web/original-extra/index.html*',route=>route.fulfill({contentType:'text/html',body:mockChild}));
  await context.route('**/dos-player.html?game=dos-extra*',route=>route.fulfill({contentType:'text/html',body:mockChild}));
  await page.goto(fixture.origin+'/#games');await page.waitForSelector('#games-panel:not([hidden])');
  return{context,page,requests};
}
async function openExtra(page,id='original-extra') {
  await page.locator(`[data-game-id="${id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused');
  await page.locator('#extra-game-pause').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='playing');
}
test('extra and NES catalogs combine alphabetically with platform filtering and literal titles',async t=>{
  const nes={version:1,items:[{id:'nes-fixture',title:'Middle NES Fixture',rom:'roms/middle.nes'}]};
  const {page,requests}=await pageFor(t,{nes});await page.waitForFunction(()=>document.querySelectorAll('.games-card').length===3);
  assert.deepEqual(await page.locator('.games-card strong').allTextContents(),['Alpha Original Browser Game','Middle NES Fixture','Zulu Original DOS Fixture']);
  await page.locator('#games-platform').selectOption('dos');assert.equal(await page.locator('.games-card').count(),1);assert.equal(await page.locator('.games-card').getAttribute('data-game-platform'),'dos');
  await page.locator('#games-platform').selectOption('web');assert.equal(await page.locator('.games-card').count(),1);
  await page.locator('#games-platform').selectOption('all');await page.locator('#games-search').fill('Middle');assert.equal(await page.locator('.games-card').count(),1);
  assert.equal(requests.some(url=>/^\/(api\/|healthz|media\/)/.test(new URL(url).pathname)),false);
});
test('an extra catalog outage preserves working NES cards and shows one finite refresh message',async t=>{
  const {page}=await pageFor(t,{extraFailure:true,nes:{version:1,items:[{id:'nes-fixture',title:'NES still available',rom:'roms/middle.nes'}]}});
  await page.waitForSelector('[data-game-id="nes-fixture"]');await page.waitForFunction(()=>/could not load/.test(document.querySelector('#games-extra-message').textContent));
  assert.equal(await page.locator('.games-card').count(),1);assert.match(await page.locator('#games-extra-message').textContent(),/Refresh/);
});
test('child source and origin are enforced, pause and mute do not form message loops',async t=>{
  const {page}=await pageFor(t);await openExtra(page);
  await page.frameLocator('#extra-game-frame').locator('#child').click();await page.waitForTimeout(150);
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'playing','focusing the child must not pause parent gameplay');
  const commandsBefore=Number(await page.frameLocator('#extra-game-frame').locator('#commands').textContent());assert.ok(commandsBefore<10,'initial mute acknowledgment must not cause a loop');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'torbox-extra-status',state:'error',message:'spoofed',frames:1}})));
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'playing');
  await page.locator('#extra-game-mute').click();await page.waitForTimeout(100);assert.equal(await page.locator('#extra-game-mute').getAttribute('aria-pressed'),'true');
  assert.ok(Number(await page.frameLocator('#extra-game-frame').locator('#commands').textContent())-commandsBefore<=2);
  await page.locator('#extra-game-pause').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused');
  // The pause command and the child's final frame-count acknowledgment are
  // asynchronous; allow that acknowledgment before checking stopped frames.
  await page.waitForTimeout(100);const frames=await page.locator('#extra-game-player').getAttribute('data-frames');await page.waitForTimeout(150);assert.equal(await page.locator('#extra-game-player').getAttribute('data-frames'),frames);
  await page.locator('#extra-game-pause').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='playing');
});
test('touch controls deliver exact child key values and restart rejects an older frame source',async t=>{
  const {page}=await pageFor(t);await openExtra(page,'dos-extra');
  const button=page.locator('[data-extra-key="265"]');const bounds=await button.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.waitForTimeout(60);await page.mouse.up();
  assert.equal(await page.frameLocator('#extra-game-frame').locator('#keys').textContent(),'1');
  await page.evaluate(()=>{window.oldExtraSource=document.querySelector('#extra-game-frame').contentWindow;});
  await page.locator('#extra-game-restart').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused');
  await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window.oldExtraSource,origin:location.origin,data:{type:'torbox-extra-status',state:'error',message:'old frame',frames:100}})));
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'paused');assert.equal(await page.locator('#extra-game-player').getAttribute('data-frames'),'0');
});
test('viewer changes close child playback, and leaving Games removes the iframe source',async t=>{
  const {page}=await pageFor(t);await openExtra(page);
  await page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-2'));
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='closed');assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);
  await openExtra(page);await page.locator('#close-extra-game-player').click();await page.locator('#open-sports').click();
  await page.waitForSelector('#sports-panel:not([hidden])');assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'closed');assert.equal(await page.locator('#extra-game-frame').getAttribute('src'),null);
});
test('extra player fits portrait and landscape without horizontal overflow',async t=>{
  const {page}=await pageFor(t,{mobile:true});await openExtra(page);
  for(const viewport of [{width:412,height:915},{width:915,height:412}]) {
    await page.setViewportSize(viewport);await page.waitForTimeout(50);
    const bounds=await page.locator('#extra-game-player').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0);assert.ok(bounds.x+bounds.width<=viewport.width+1);assert.ok(bounds.y+bounds.height<=viewport.height+1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
});
test('focus lost before the child listener is ready preserves pause until explicit Resume',async t=>{
  const {page,context}=await pageFor(t);
  let markStarted, release;
  const started=new Promise(resolve=>{markStarted=resolve;});
  const blocked=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  const autoplayChild=mockChild.replace("let state='paused'","let state='playing'");
  await context.route('**/games-web/original-extra/index.html*',async route=>{markStarted();await blocked;try{await route.fulfill({contentType:'text/html',body:autoplayChild});}catch{}});
  await page.locator('[data-game-id="original-extra"]').click();await started;
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'loading');
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));});
  // The first pause message has no child listener yet. The parent must send
  // it again when this automatically playing game finally reports ready.
  release();
  await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused'&&document.querySelector('#extra-game-frame').contentDocument?.querySelector('#child-state')?.textContent==='paused');
  const child=page.frameLocator('#extra-game-frame');
  const stoppedFrames=await child.locator('#child-frames').textContent();
  const commands=Number(await child.locator('#commands').textContent());
  assert.ok(commands>=1&&commands<=3,'ready must receive one pause plus bounded mute acknowledgment traffic');
  await page.waitForTimeout(180);
  assert.equal(await child.locator('#child-frames').textContent(),stoppedFrames,'the child game itself must stop advancing');
  assert.equal(Number(await child.locator('#commands').textContent()),commands,'pause and mute acknowledgments must not form a loop');
  await page.evaluate(()=>delete document.hasFocus);
  await page.locator('#extra-game-pause').click();
  await page.waitForFunction(old=>document.querySelector('#extra-game-frame').contentDocument?.querySelector('#child-state')?.textContent==='playing'&&Number(document.querySelector('#extra-game-frame').contentDocument.querySelector('#child-frames').textContent)>Number(old),stoppedFrames);
  assert.equal(await page.locator('#extra-game-player').getAttribute('data-state'),'playing');
});
test('extra game fullscreen uses the supported root and preserves controls until close',async t=>{
  const {page}=await pageFor(t);await openExtra(page);
  assert.equal(await page.evaluate(()=>document.fullscreenEnabled),true);
  await page.locator('#extra-game-fullscreen').click();
  await page.waitForFunction(()=>document.fullscreenElement===document.documentElement&&document.body.classList.contains('extra-game-fullscreen'));
  await page.waitForTimeout(250);
  await page.waitForFunction(()=>{const frame=document.querySelector('#extra-game-frame'),box=frame.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===frame;});
  assert.equal(await page.locator('#close-extra-game-player').evaluate(button=>{const box=button.getBoundingClientRect();return document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===button;}),true);
  const geometry=await page.locator('#extra-game-player').evaluate(dialog=>{const box=dialog.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,viewportWidth:innerWidth,viewportHeight:innerHeight};});
  assert.equal(geometry.x,0);assert.equal(geometry.y,0);assert.equal(geometry.width,geometry.viewportWidth);assert.equal(geometry.height,geometry.viewportHeight);
  const frameBox=await page.locator('#extra-game-frame').boundingBox(),painted=PNG.sync.read(await page.screenshot());
  const scale=painted.width/geometry.viewportWidth,at=(Math.floor((frameBox.y+frameBox.height/2)*scale)*painted.width+Math.floor((frameBox.x+frameBox.width/2)*scale))*4;
  assert.deepEqual(Array.from(painted.data.subarray(at,at+4)),[20,55,238,255],'the visible screenshot must contain the child game surface, not a covered modal');
  const touch=page.locator('[data-extra-key="37"]'),bounds=await touch.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=geometry.viewportHeight);
  await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2,{delay:80});
  assert.equal(await page.frameLocator('#extra-game-frame').locator('#keys').textContent(),'1');
  await page.locator('#extra-game-pause').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='paused');
  await page.locator('#extra-game-pause').click();await page.waitForFunction(()=>document.querySelector('#extra-game-player').dataset.state==='playing');
  await page.locator('#extra-game-fullscreen').click();await page.waitForFunction(()=>!document.fullscreenElement&&!document.body.classList.contains('extra-game-fullscreen'));
  assert.equal(await page.locator('#extra-game-player').evaluate(dialog=>dialog.open),true);assert.equal(await page.evaluate(()=>document.body.classList.contains('extra-game-fullscreen')),false);
  await page.locator('#extra-game-fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===document.documentElement);
  await page.locator('#close-extra-game-player').click();await page.waitForFunction(()=>!document.fullscreenElement);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('extra-game-fullscreen')),false);
  await openExtra(page,'dos-extra');assert.equal(await page.evaluate(()=>!!document.fullscreenElement||document.body.classList.contains('extra-game-fullscreen')),false);
});

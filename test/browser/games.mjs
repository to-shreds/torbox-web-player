import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

// Original, generated NROM test program, written here instead of including a
// third-party game. Its 6502 code reads controller A and changes the actual PPU
// backdrop on a rising edge. Save/restore assertions observe rendered pixels.
function makeROM(initialColor=0x16) {
  const code=[],labels=new Map(),fixups=[];
  const emit=(...bytes)=>code.push(...bytes);
  const label=name=>labels.set(name,0x8000+code.length);
  const branch=(opcode,name)=>{emit(opcode,0);fixups.push({offset:code.length-1,name,relative:true});};
  const jump=name=>{emit(0x4c,0,0);fixups.push({offset:code.length-2,name});};
  const lda=value=>emit(0xa9,value),sta=address=>emit(0x8d,address&255,address>>8);
  label('reset');emit(0x78,0xd8,0xa2,0xff,0x9a); // SEI, CLD, LDX, TXS.
  lda(0);sta(0x2000);sta(0x2001);sta(0x4010);sta(0x4015);emit(0x85,0x00); // Previous A.
  lda(initialColor);emit(0x85,0x01); // Saved current color in CPU RAM.
  label('warm1');emit(0x2c,0x02,0x20);branch(0x10,'warm1');
  label('warm2');emit(0x2c,0x02,0x20);branch(0x10,'warm2');
  lda(0x0a);sta(0x2001); // Enable background rendering including left edge.
  label('frame');emit(0x2c,0x02,0x20);branch(0x10,'frame');
  lda(1);sta(0x4016);lda(0);sta(0x4016);
  emit(0xad,0x16,0x40,0x29,1,0x85,0x02); // Poll the real serial controller.
  branch(0xf0,'remember');emit(0xa5,0x00);branch(0xd0,'remember');
  emit(0xa5,0x01,0x49,0x26,0x85,0x01); // Red <-> white on A press.
  label('remember');emit(0xa5,0x02,0x85,0x00);
  lda(0x3f);sta(0x2006);lda(0);sta(0x2006);emit(0xa5,0x01);sta(0x2007);
  lda(0);sta(0x2005);sta(0x2005);jump('frame');
  for(const fix of fixups){
    const destination=labels.get(fix.name);assert.ok(destination);
    if(fix.relative){const displacement=destination-(0x8000+fix.offset+1);assert.ok(displacement>=-128&&displacement<=127);code[fix.offset]=displacement&255;}
    else {code[fix.offset]=destination&255;code[fix.offset+1]=destination>>8;}
  }
  const prg=Buffer.alloc(16384,0xea);prg.set(code);
  for(const offset of [0x3ffa,0x3ffc,0x3ffe]){prg[offset]=0;prg[offset+1]=0x80;}
  return Buffer.concat([Buffer.from([0x4e,0x45,0x53,0x1a,1,1,0,0,0,0,0,0,0,0,0,0]),prg,Buffer.alloc(8192)]);
}
const redROM=makeROM(),greenROM=makeROM(0x1a);
const catalog={version:1,items:[
  {id:'original-red',title:'Original Red Test',rom:'roms/original-red.nes'},
  {id:'original-green',title:'Original Green Test',rom:'roms/original-green.nes'}
]};
let browser,fixture;
before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  fixture=await startFixture(4186);
});
after(async()=>{await browser?.close();await fixture?.close();});
async function gamesPage(t,{mobile=false,catalogBody=catalog,hash='#games',signedIn=false,kid=false,waitForGames=true}={}) {
  const context=await browser.newContext({viewport:mobile?{width:412,height:915}:{width:1000,height:760},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],requests=[];page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[],'Games must not throw uncaught browser errors');});
  await page.addInitScript(({token,kid})=>{
    if(token)sessionStorage.setItem('torbox-web-session',token);
    if(kid)localStorage.setItem('torbox-parental-controls-v1',JSON.stringify({version:1,viewers:{'viewer-1':{enabled:true}}}));
  },{token:signedIn?fixture.session():'',kid});
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/games-catalog.json*',route=>route.fulfill({json:catalogBody}));
  await context.route('**/roms/original-red.nes',route=>route.fulfill({contentType:'application/octet-stream',body:redROM}));
  await context.route('**/roms/original-green.nes',route=>route.fulfill({contentType:'application/octet-stream',body:greenROM}));
  await page.goto(fixture.origin+'/'+hash);if(waitForGames)await page.waitForSelector('#games-panel:not([hidden])');
  return{context,page,requests};
}
function privateCalls(requests){return requests.filter(url=>/^\/(api\/|healthz|media\/)/.test(new URL(url).pathname)||/torbox|tb-cdn/.test(new URL(url).hostname));}
async function openGame(page,id='original-red'){
  await page.locator(`[data-game-id="${id}"]`).click();
  await page.waitForFunction(()=>['playing','paused'].includes(document.querySelector('#games-player')?.dataset.state));
  if(await page.locator('#games-player').getAttribute('data-state')==='paused')await page.locator('#games-pause').click();
  await page.waitForFunction(()=>Number(document.querySelector('#games-canvas')?.dataset.frames)>5);
}
async function pixel(page){return page.locator('#games-canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(128,120,1,1).data));}
async function waitPixel(page,expected){await page.waitForFunction(expected=>{
  const canvas=document.querySelector('#games-canvas');if(!canvas)return false;
  return Array.from(canvas.getContext('2d').getImageData(128,120,1,1).data).every((value,index)=>value===expected[index]);
},expected);}
async function toggleA(page){await page.locator('#games-canvas').focus();await page.keyboard.down('x');await page.waitForTimeout(100);await page.keyboard.up('x');await page.waitForTimeout(100);}

test('anonymous Games executes the original ROM with real PPU output and keyboard input without TorBox calls',async t=>{
  const {page,requests}=await gamesPage(t);await openGame(page);
  const first=await pixel(page);assert.equal(first[3],255);assert.notDeepEqual(first.slice(0,3),[0,0,0]);
  await mkdir('docs/evidence/nes-games',{recursive:true});await page.screenshot({path:'docs/evidence/nes-games/desktop.png'});
  await toggleA(page);const changed=await pixel(page);assert.notDeepEqual(changed,first,'controller A must change the emulated PPU output');
  await page.locator('#games-pause').click();const frames=await page.locator('#games-canvas').getAttribute('data-frames');
  await page.waitForTimeout(150);assert.equal(await page.locator('#games-canvas').getAttribute('data-frames'),frames);
  await page.locator('#games-pause').click();await page.waitForFunction(old=>Number(document.querySelector('#games-canvas').dataset.frames)>Number(old),frames);
  assert.equal(privateCalls(requests).length,0);
});

test('manual save and restore recover emulated CPU and PPU state, and reopening offers the saved state',async t=>{
  const {page,requests}=await gamesPage(t);await openGame(page);const original=await pixel(page);
  await page.locator('#games-save').click();await page.waitForFunction(()=>/saved/i.test(document.querySelector('#games-player-message').textContent));
  await toggleA(page);assert.notDeepEqual(await pixel(page),original);
  await page.locator('#games-load').click();await waitPixel(page,original);
  await page.locator('#close-games-player').click();assert.equal(await page.locator('#games-player').evaluate(dialog=>dialog.open),false);
  await page.reload();await page.locator('[data-game-id="original-red"]').click();
  await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='paused');
  assert.match(await page.locator('#games-pause').textContent(),/resume/i);
  await page.locator('#games-pause').click();await waitPixel(page,original);
  assert.equal(privateCalls(requests).length,0);
});

test('toolbar focus preserves game keys while Enter activates its focused Pause control',async t=>{
  const {page}=await gamesPage(t);await openGame(page);const original=await pixel(page);
  await page.locator('#games-save').focus();await page.keyboard.down('x');await page.waitForTimeout(100);await page.keyboard.up('x');
  await page.waitForTimeout(100);assert.notDeepEqual(await pixel(page),original);
  await page.locator('#games-pause').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');
  await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='playing');
});

test('a delayed manual Load cannot overwrite a newer Start fresh action',async t=>{
  const {page}=await gamesPage(t);await openGame(page);const original=await pixel(page);
  await toggleA(page);await page.locator('#games-save').click();
  await page.waitForFunction(()=>/saved/i.test(document.querySelector('#games-player-message').textContent));
  await toggleA(page);await waitPixel(page,original);
  await page.evaluate(()=>{
    const originalGet=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){
      if(String(key).endsWith(':manual'))this.transaction.testDelayedManual=true;
      return originalGet.call(this,key);
    };
    const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(listener){
      descriptor.set.call(this,function(event){
        if(this.testDelayedManual)window.releaseTestManualLoad=()=>listener.call(this,event);
        else listener.call(this,event);
      });
    }});
  });
  await page.locator('#games-load').click();await page.waitForFunction(()=>typeof window.releaseTestManualLoad==='function');
  await page.locator('#games-start-fresh').click();await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='playing');
  await page.evaluate(()=>window.releaseTestManualLoad());await page.waitForTimeout(150);
  await waitPixel(page,original);assert.equal(await page.locator('#games-player').getAttribute('data-state'),'playing');
});

test('standard controller A reaches the emulator and disconnecting releases the held button',async t=>{
  const {page}=await gamesPage(t);await openGame(page);const original=await pixel(page);
  await page.evaluate(()=>{
    window.testGamepad={id:'Original test controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,touched:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.testGamepad?[window.testGamepad]:[]});
    window.testGamepad.buttons[0]={pressed:true,touched:true,value:1};
  });
  await page.waitForTimeout(120);assert.notDeepEqual(await pixel(page),original);
  await page.evaluate(()=>{window.testGamepad=null;});await page.waitForTimeout(120);
  await page.evaluate(()=>{window.testGamepad={id:'Original test controller',index:0,connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:16},(_,index)=>({pressed:index===0,touched:index===0,value:index===0?1:0}))};});
  await waitPixel(page,original);
});

test('automatic saves stay separate for the two viewers',async t=>{
  const {page}=await gamesPage(t);await openGame(page);const original=await pixel(page);
  await toggleA(page);assert.notDeepEqual(await pixel(page),original);
  await page.locator('#close-games-player').click();await page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-2'));
  await openGame(page);assert.equal(await page.locator('#games-player').getAttribute('data-state'),'playing');await waitPixel(page,original);
});

test('local ROM import renders a game and malformed files report a useful error',async t=>{
  const {page,requests}=await gamesPage(t,{catalogBody:{version:1,items:[]}});
  await page.locator('#games-file').setInputFiles({name:'Original Local Test.nes',mimeType:'application/octet-stream',buffer:redROM});
  await page.waitForFunction(()=>Number(document.querySelector('#games-canvas')?.dataset.frames)>5);
  assert.match(await page.locator('#games-playing-title').textContent(),/Original Local Test/);
  assert.notDeepEqual((await pixel(page)).slice(0,3),[0,0,0]);
  await page.locator('#close-games-player').click();
  await page.locator('#games-file').setInputFiles({name:'broken.nes',mimeType:'application/octet-stream',buffer:Buffer.from('not a NES game')});
  await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='error');
  assert.match(await page.locator('#games-player-message').textContent(),/valid NES header/i);
  assert.equal(Number(await page.locator('#games-canvas').getAttribute('data-frames')),0);
  await page.locator('#close-games-player').click();
  await page.locator('#games-file').setInputFiles({name:'Recovered Local Test.nes',mimeType:'application/octet-stream',buffer:redROM});
  await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='paused');
  await page.locator('#games-pause').click();await page.waitForFunction(()=>Number(document.querySelector('#games-canvas')?.dataset.frames)>5);
  assert.equal(privateCalls(requests).length,0);
});

test('a canceled slow ROM cannot replace a newer game or reopen its closed player',async t=>{
  const {page,context,requests}=await gamesPage(t);let started;
  const pending=new Promise(resolve=>{started=resolve;});let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  await context.route('**/roms/original-red.nes',async route=>{started();await blocked;try{await route.fulfill({body:redROM,contentType:'application/octet-stream'});}catch{}});
  await page.locator('[data-game-id="original-red"]').click();await pending;
  await page.locator('#close-games-player').click();await openGame(page,'original-green');const green=await pixel(page);
  release();await page.waitForTimeout(250);
  assert.match(await page.locator('#games-playing-title').textContent(),/Original Green/);assert.deepEqual(await pixel(page),green);
  await page.locator('#close-games-player').click();await page.waitForTimeout(100);
  assert.equal(await page.locator('#games-player').evaluate(dialog=>dialog.open),false);assert.equal(privateCalls(requests).length,0);
});

test('closing Games releases keyboard interception and switching to Sports stops its emulator',async t=>{
  const {page,requests}=await gamesPage(t);await openGame(page);
  await page.locator('#close-games-player').click();await page.locator('#games-search').fill('');await page.locator('#games-search').press('x');
  assert.equal(await page.locator('#games-search').inputValue(),'x');
  await page.locator('#games-search').fill('');await openGame(page);await page.keyboard.press('Escape');
  assert.equal(await page.locator('#games-player').evaluate(dialog=>dialog.open),false);
  await page.locator('#open-sports').click();await page.waitForSelector('#sports-panel:not([hidden])');
  assert.equal(await page.locator('#games-panel').isVisible(),false);assert.equal(await page.locator('#games-player').evaluate(dialog=>dialog.open),false);
  assert.equal(new URL(page.url()).hash,'#sports');await page.reload();await page.waitForSelector('#sports-panel:not([hidden])');
  assert.equal(await page.locator('#games-panel').isVisible(),false);
  assert.equal(privateCalls(requests).length,0);
});

test('mobile portrait and landscape keep the emulator and touch controls inside the viewport',async t=>{
  const {page,requests}=await gamesPage(t,{mobile:true});await openGame(page);const original=await pixel(page);
  const touchA=page.locator('[data-nes-button="A"]');
  await touchA.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,button:0});await page.waitForTimeout(100);
  await touchA.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true,button:0});await page.waitForTimeout(100);
  assert.notDeepEqual(await pixel(page),original,'touch A must control the real emulated ROM');
  for(const viewport of [{width:412,height:915},{width:915,height:412}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(80);
    const bounds=await page.locator('#games-player').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0);assert.ok(bounds.x+bounds.width<=viewport.width+1);assert.ok(bounds.y+bounds.height<=viewport.height+1);
    const screen=await page.locator('#games-canvas').boundingBox();assert.ok(screen.width>150&&screen.height>140);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'the mobile page must not overflow horizontally');
    await mkdir('docs/evidence/nes-games',{recursive:true});await page.screenshot({path:`docs/evidence/nes-games/${viewport.width<viewport.height?'portrait':'landscape'}.png`});
  }
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/games-landscape.png'});
  assert.equal(privateCalls(requests).length,0);
});

test('unsafe catalog entries never request private APIs or external ROM hosts',async t=>{
  const malicious={version:1,items:[{id:'private',title:'Private API',rom:'api/login'},{id:'external',title:'External ROM',rom:'https://evil.example/game.nes'},{id:'escape',title:'Traversal',rom:'roms/../api/session'},{id:'ok',title:'Original Red Test',rom:'roms/original-red.nes'}]};
  const {page,requests}=await gamesPage(t,{catalogBody:malicious});
  await page.waitForSelector('[data-game-id="ok"]');
  assert.equal(await page.locator('[data-game-id="private"],[data-game-id="external"],[data-game-id="escape"]').count(),0);
  await openGame(page,'ok');assert.equal(privateCalls(requests).length,0);assert.equal(requests.some(url=>url.includes('evil.example')),false);
});

test('direct Games links respect Kid Mode and finish the normal movie startup after denial',async t=>{
  const {page,requests}=await gamesPage(t,{kid:true,waitForGames:false});
  await page.waitForSelector('#login:not([hidden])');assert.equal(await page.locator('#loading').isVisible(),false);
  assert.equal(await page.locator('#games-panel').isVisible(),false);assert.equal(new URL(page.url()).hash,'');
  assert.match(await page.locator('#sports-nav-message').textContent(),/adult viewer/i);
  assert.equal(requests.some(url=>new URL(url).pathname.includes('games-catalog')),false);
});

test('an existing movie fragment still boots Cinema and is preserved when returning from Games',async t=>{
  const {page}=await gamesPage(t,{hash:'#legacy',signedIn:true,waitForGames:false});
  await page.waitForSelector('#workspace:not([hidden])');assert.equal(await page.locator('#games-panel').isVisible(),false);
  await page.locator('#open-games').click();await page.waitForSelector('#games-panel:not([hidden])');
  assert.equal(new URL(page.url()).hash,'#legacy');await page.locator('#open-cinema').click();
  await page.waitForSelector('#workspace:not([hidden])');assert.equal(new URL(page.url()).hash,'#legacy');
  assert.equal(await page.locator('#games-panel').isVisible(),false);
});

test('pending movie auto-next cannot reopen Cinema over Games while presentation exit is delayed',{timeout:25000},async t=>{
  const {page,context}=await gamesPage(t,{hash:'',signedIn:true,waitForGames:false});
  const media=await readFile(new URL('../fixtures/fixture.mp4',import.meta.url));
  await context.route('**/media/*',route=>{
    const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||'');
    const start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
    return route.fulfill({status:range?206:200,body:media.subarray(start,end+1),headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})}});
  });
  await page.waitForSelector('#workspace:not([hidden])');await page.locator('#catalog-type').selectOption('series');
  await page.locator('#catalog-grid button').first().click();await page.locator('#episode-area button').filter({hasText:/^Play$/}).first().click();
  await page.waitForFunction(()=>document.querySelector('#video-slot video')?.currentTime>0);
  const before=fixture.control.playbackCalls;let started,release;
  const pending=new Promise(resolve=>{started=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  await context.route('**/api/discover/meta?**',async route=>{started();await blocked;try{await route.continue();}catch{}});
  await page.evaluate(()=>{
    const video=document.querySelector('#video-slot video');
    window.testPiPActive=true;window.testExitResolvers=[];
    Object.defineProperty(document,'pictureInPictureElement',{configurable:true,get:()=>window.testPiPActive?video:null});
    document.exitPictureInPicture=()=>new Promise(resolve=>window.testExitResolvers.push(resolve));
    video.pause();video.currentTime=112;video.dispatchEvent(new Event('timeupdate'));
  });
  await Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(new Error('The next episode preparation did not start.')),2000))]);
  await page.evaluate(()=>document.querySelector('#play-next-now').click());await page.locator('#close-player').click();
  await page.locator('#open-games').click();await page.waitForSelector('#games-panel:not([hidden])');
  release();await page.waitForTimeout(300);
  assert.equal(await page.locator('#player').evaluate(dialog=>dialog.open),false);assert.equal(fixture.control.playbackCalls,before);
  assert.equal(await page.locator('#video-slot video').evaluate(video=>video.paused),true);
  await openGame(page);assert.equal(await page.locator('#player').evaluate(dialog=>dialog.open),false);
  await page.evaluate(()=>{window.testPiPActive=false;for(const resolve of window.testExitResolvers)resolve();});
  await page.waitForTimeout(100);assert.equal(await page.locator('#player').evaluate(dialog=>dialog.open),false);
});

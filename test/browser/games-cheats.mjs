import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

// Original NROM program: each vblank reads a palette operand from ROM and writes
// it to the actual PPU. Game Genie patches therefore have observable effects
// without depending on a commercial game, a fake canvas, or test-only CPU edits.
function paletteROM(color=0x16){
  const program=[],labels=new Map(),fixes=[];
  const emit=(...bytes)=>program.push(...bytes),label=name=>labels.set(name,0x8000+program.length);
  const lda=value=>emit(0xa9,value),sta=address=>emit(0x8d,address&255,address>>8);
  const branch=(opcode,name)=>{emit(opcode,0);fixes.push({at:program.length-1,name,relative:true});};
  emit(0x78,0xd8,0xa2,0xff,0x9a);lda(0);sta(0x2000);sta(0x2001);sta(0x4010);sta(0x4015);
  label('warm1');emit(0x2c,2,0x20);branch(0x10,'warm1');
  label('warm2');emit(0x2c,2,0x20);branch(0x10,'warm2');
  lda(0x0a);sta(0x2001);label('frame');emit(0x2c,2,0x20);branch(0x10,'frame');
  lda(0x3f);sta(0x2006);lda(0);sta(0x2006);const operand=0x8000+program.length+1;
  lda(color);sta(0x2007);lda(0);sta(0x2005);sta(0x2005);
  emit(0x4c,0,0);fixes.push({at:program.length-2,name:'frame'});
  for(const fix of fixes){const target=labels.get(fix.name);if(fix.relative){const displacement=target-(0x8000+fix.at+1);assert.ok(displacement>=-128&&displacement<=127);program[fix.at]=displacement&255;}else{program[fix.at]=target&255;program[fix.at+1]=target>>8;}}
  const prg=Buffer.alloc(16384,0xea);prg.set(program);for(const at of [0x3ffa,0x3ffc,0x3ffe]){prg[at]=0;prg[at+1]=0x80;}
  return {operand,bytes:Buffer.concat([Buffer.from([0x4e,0x45,0x53,0x1a,1,1,0,0,0,0,0,0,0,0,0,0]),prg,Buffer.alloc(8192)])};
}
const red=paletteROM(),green=paletteROM(0x1a);
const engineScope={};vm.runInNewContext(await readFile(new URL('../../public/vendor/jsnes-2.1.0.min.js',import.meta.url),'utf8'),engineScope);
const genie=new engineScope.jsnes.GameGenie();
const sixWhite=genie.encode(red.operand&0x7fff,0x30);
const eightGreen=genie.encode(red.operand&0x7fff,0x1a,0x16);
const eightWrong=genie.encode(red.operand&0x7fff,0x1a,0x17);
assert.equal(sixWhite.length,6);assert.equal(eightGreen.length,8);
for(const [code,value,key]of [[sixWhite,0x30,undefined],[eightGreen,0x1a,0x16],[eightWrong,0x1a,0x17]]){
  const decoded=genie.decode(code);assert.equal(decoded.addr,red.operand&0x7fff);assert.equal(decoded.value,value);assert.equal(decoded.key,key);
}
const catalog={version:1,items:[{id:'cheat-red',title:'Original Palette Red',rom:'roms/cheat-red.nes'},{id:'cheat-green',title:'Original Palette Green',rom:'roms/cheat-green.nes'}]};
let fixture,browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});fixture=await startFixture(4187);});
after(async()=>{await browser?.close();await fixture?.close();});
async function cheatsPage(t,{mobile=false}={}){
  const context=await browser.newContext({viewport:mobile?{width:412,height:915}:{width:1000,height:760},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.equal(requests.filter(url=>/^\/(api\/|healthz|media\/)/.test(new URL(url).pathname)).length,0);});
  await page.addInitScript(()=>{
    let value;Object.defineProperty(window,'jsnes',{configurable:true,get:()=>value,set:api=>{
      class ObservedNES extends api.NES{constructor(...args){super(...args);window.cheatTestNES=this;}}
      value={...api,NES:ObservedNES};
    }});
  });
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/games-catalog.json*',route=>route.fulfill({json:catalog}));
  await context.route('**/roms/cheat-red.nes',route=>route.fulfill({body:red.bytes,contentType:'application/octet-stream'}));
  await context.route('**/roms/cheat-green.nes',route=>route.fulfill({body:green.bytes,contentType:'application/octet-stream'}));
  await page.goto(fixture.origin+'/#games');await page.waitForSelector('[data-game-id="cheat-red"]');
  return{page,context};
}
async function openGame(page,id='cheat-red'){
  await page.locator(`[data-game-id="${id}"]`).click();await page.waitForFunction(()=>['playing','paused'].includes(document.querySelector('#games-player').dataset.state));
  if(await page.locator('#games-player').getAttribute('data-state')==='paused')await page.locator('#games-pause').click();
  await page.waitForFunction(()=>Number(document.querySelector('#games-canvas').dataset.frames)>5);
}
async function pixel(page){return page.locator('#games-canvas').evaluate(canvas=>Array.from(canvas.getContext('2d').getImageData(128,120,1,1).data));}
async function waitColor(page,color){await page.waitForFunction(expected=>{
  const canvas=document.querySelector('#games-canvas');return Array.from(canvas.getContext('2d').getImageData(128,120,1,1).data).every((value,index)=>value===expected[index]);
},color);}
async function openCheats(page){if(await page.locator('#games-cheats-panel').isHidden())await page.locator('#games-cheats').click();await page.waitForSelector('#games-cheats-panel:not([hidden])');assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');}
async function addCodes(page,codes,name=''){await openCheats(page);await page.locator('#games-cheat-name').fill(name);await page.locator('#games-cheat-codes').fill(codes);await page.locator('#games-cheat-submit').click();}
async function done(page){await page.locator('#games-cheats-done').click();await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='playing');}
const row=(page,code)=>page.locator(`[data-cheat-code="${code}"]`);
async function exportCodes(page){const downloading=page.waitForEvent('download');await page.locator('#games-cheats-export').click();const download=await downloading;return JSON.parse(await readFile(await download.path(),'utf8'));}

test('a six-letter Game Genie code patches the actual ROM read, with master and individual toggles',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);const base=await pixel(page);assert.notDeepEqual(base.slice(0,3),[0,0,0]);
  await addCodes(page,sixWhite.toLowerCase(),'White backdrop');await row(page,sixWhite).waitFor();
  const frames=await page.locator('#games-canvas').getAttribute('data-frames');await page.waitForTimeout(100);assert.equal(await page.locator('#games-canvas').getAttribute('data-frames'),frames);
  await done(page);await waitColor(page,[255,255,255,255]);
  await openCheats(page);await page.locator('#games-cheats-enabled').uncheck();await done(page);await waitColor(page,base);
  await openCheats(page);await page.locator('#games-cheats-enabled').check();await row(page,sixWhite).locator('.games-cheat-enabled').uncheck();await done(page);await waitColor(page,base);
  await openCheats(page);await row(page,sixWhite).locator('.games-cheat-enabled').check();await done(page);await waitColor(page,[255,255,255,255]);
});

test('eight-letter compare codes apply only to matching ROM bytes, and editing and removing use the new code',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);const base=await pixel(page);
  await addCodes(page,eightWrong,'Wrong compare');await row(page,eightWrong).waitFor();await done(page);await waitColor(page,base);
  await openCheats(page);await row(page,eightWrong).locator('.games-cheat-edit').click();await page.locator('#games-cheat-codes').fill(eightGreen);await page.locator('#games-cheat-name').fill('Matching compare');await page.locator('#games-cheat-submit').click();
  await row(page,eightGreen).waitFor();assert.equal(await row(page,eightWrong).count(),0);await done(page);await waitColor(page,[0,171,0,255]);const patched=await pixel(page);assert.notDeepEqual(patched,base);
  await openCheats(page);await row(page,eightGreen).locator('.games-cheat-edit').click();await page.locator('#games-cheat-codes').fill(sixWhite);await page.locator('#games-cheat-cancel-edit').click();assert.equal(await row(page,eightGreen).count(),1);
  await row(page,eightGreen).locator('.games-cheat-remove').click();assert.equal(await row(page,eightGreen).count(),0);await done(page);await waitColor(page,base);
});

test('bulk addition and portable JSON import/export preserve the list and reject bad input atomically',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);await addCodes(page,`${eightWrong}\n${sixWhite}`,'Original test codes');await row(page,sixWhite).waitFor();assert.equal(await page.locator('[data-cheat-code]').count(),2);
  const exported=await exportCodes(page);assert.deepEqual(exported,{version:1,enabled:true,codes:[{code:eightWrong,name:'Original test codes',enabled:true},{code:sixWhite,name:'Original test codes',enabled:true}]});await mkdir('docs/evidence/nes-cheats',{recursive:true});await writeFile('docs/evidence/nes-cheats/original-palette-cheats.json',JSON.stringify(exported,null,2)+'\n');
  await page.locator('#games-cheat-codes').fill(`${eightGreen}\nNOT-A-CODE`);await page.locator('#games-cheat-submit').click();await page.waitForFunction(()=>/invalid|letter/i.test(document.querySelector('#games-cheat-message').textContent));
  assert.equal(await page.locator('[data-cheat-code]').count(),2);assert.equal(await row(page,eightGreen).count(),0);
  await page.locator('#games-cheats-import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"codes":["NOT-A-CODE"]}')});
  await page.waitForTimeout(120);assert.equal(await page.locator('[data-cheat-code]').count(),2);
  await page.locator('#games-cheats-clear').click();assert.equal(await page.locator('[data-cheat-code]').count(),0);
  await page.locator('#games-cheats-import').setInputFiles({name:'original-palette-cheats.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await row(page,sixWhite).waitFor();assert.equal(await row(page,eightWrong).count(),1);assert.equal(await page.locator('[data-cheat-code]').count(),2);
  await done(page);await waitColor(page,[255,255,255,255]);
});

test('cheats remain current across manual restore, Start fresh and reopening, and isolate viewers and ROMs',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);const base=await pixel(page);await addCodes(page,sixWhite,'Persistent white');await row(page,sixWhite).waitFor();await done(page);await waitColor(page,[255,255,255,255]);
  await page.locator('#games-save').click();await page.waitForFunction(()=>/saved/i.test(document.querySelector('#games-player-message').textContent));
  await openCheats(page);await page.locator('#games-cheats-enabled').uncheck();await done(page);await waitColor(page,base);
  await page.locator('#games-load').click();await page.waitForFunction(()=>/Loaded your manual save/.test(document.querySelector('#games-player-message').textContent));await waitColor(page,base);
  await openCheats(page);await page.locator('#games-cheats-enabled').check();await done(page);await waitColor(page,[255,255,255,255]);
  await page.locator('#games-start-fresh').click();await waitColor(page,[255,255,255,255]);await page.locator('#close-games-player').click();await openGame(page);await waitColor(page,[255,255,255,255]);
  await page.locator('#close-games-player').click();await page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-2'));await openGame(page);await waitColor(page,base);await openCheats(page);assert.equal(await page.locator('[data-cheat-code]').count(),0);
  await page.locator('#close-games-player').click();await page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-1'));await openGame(page,'cheat-green');await openCheats(page);assert.equal(await page.locator('[data-cheat-code]').count(),0);
  await page.locator('#close-games-player').click();await openGame(page);await waitColor(page,[255,255,255,255]);await openCheats(page);assert.equal(await row(page,sixWhite).count(),1);
});

test('the paused cheat panel accepts text keys without sending them to NES controllers',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);await openCheats(page);
  const frames=await page.locator('#games-canvas').getAttribute('data-frames');await page.locator('#games-cheat-name').fill('');await page.locator('#games-cheat-name').pressSequentially('xz');await page.locator('#games-cheat-name').press('ArrowLeft');
  assert.equal(await page.locator('#games-cheat-name').inputValue(),'xz');await page.waitForTimeout(100);assert.equal(await page.locator('#games-canvas').getAttribute('data-frames'),frames);
  const pressed=await page.evaluate(()=>Object.values(window.cheatTestNES.controllers).some(controller=>Array.from(controller.state).some(value=>value!==0x40)));assert.equal(pressed,false);
});

test('an unexpected native callback failure rolls back the engine, stored model and checkboxes',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);const base=await pixel(page);await addCodes(page,sixWhite,'Rollback fixture');await row(page,sixWhite).waitFor();await done(page);await waitColor(page,[255,255,255,255]);await openCheats(page);
  const before=await page.evaluate(()=>{
    const genie=window.cheatTestNES.gameGenie;window.cheatOriginalOnChange=genie.onChange;
    const snapshot={patches:JSON.stringify(genie.patches),enabled:genie.enabled,stored:localStorage.getItem('torbox-games-cheats-v1:'+document.querySelector('#games-player').dataset.saveKey)};
    genie.onChange=()=>{throw new Error('Original test callback failure');};return snapshot;
  });
  const unchanged=async()=>{
    const after=await page.evaluate(()=>({patches:JSON.stringify(window.cheatTestNES.gameGenie.patches),enabled:window.cheatTestNES.gameGenie.enabled,stored:localStorage.getItem('torbox-games-cheats-v1:'+document.querySelector('#games-player').dataset.saveKey)}));
    assert.deepEqual(after,before);assert.equal(await page.locator('#games-cheats-enabled').isChecked(),true);assert.equal(await row(page,sixWhite).locator('.games-cheat-enabled').isChecked(),true);
    assert.match(await page.locator('#games-cheat-message').textContent(),/Previous cheats remain active/i);
  };
  // click permits the expected immediate rollback to checked; uncheck would
  // itself reject because Playwright insists on the requested final state.
  await page.locator('#games-cheats-enabled').click();await unchanged();await done(page);await waitColor(page,[255,255,255,255]);
  await openCheats(page);await row(page,sixWhite).locator('.games-cheat-enabled').click();await unchanged();
  await page.evaluate(()=>{window.cheatTestNES.gameGenie.onChange=window.cheatOriginalOnChange;});
  await row(page,sixWhite).locator('.games-cheat-enabled').uncheck();assert.equal(await row(page,sixWhite).locator('.games-cheat-enabled').isChecked(),false);await done(page);await waitColor(page,base);
  await openCheats(page);await row(page,sixWhite).locator('.games-cheat-enabled').check();await done(page);await waitColor(page,[255,255,255,255]);
});

test('a fatal opcode cheat stays editable and recovers through Start fresh and manual Load while editing',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);const base=await pixel(page);await page.locator('#games-save').click();await page.waitForFunction(()=>/saved/i.test(document.querySelector('#games-player-message').textContent));
  const bad='8000:02';await addCodes(page,bad,'Original invalid opcode');await row(page,bad).waitFor();await done(page);await page.locator('#games-start-fresh').click();
  await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='error');assert.equal(await page.locator('#games-cheats').isEnabled(),true);await page.locator('#games-cheats').click();await page.waitForSelector('#games-cheats-panel:not([hidden])');
  await row(page,bad).locator('.games-cheat-enabled').uncheck();await page.locator('#games-start-fresh').click();
  assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');assert.equal(await page.locator('#games-pause').isEnabled(),true);assert.match(await page.locator('#games-pause').textContent(),/Resume/i);
  const frames=await page.locator('#games-canvas').getAttribute('data-frames');await page.waitForTimeout(100);assert.equal(await page.locator('#games-canvas').getAttribute('data-frames'),frames);await done(page);await waitColor(page,base);
  await openCheats(page);await row(page,bad).locator('.games-cheat-enabled').check();await done(page);await page.locator('#games-start-fresh').click();await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='error');
  await page.locator('#games-cheats').click();await row(page,bad).locator('.games-cheat-remove').click();await page.locator('#games-load').click();await page.waitForFunction(()=>/Loaded your manual save/.test(document.querySelector('#games-player-message').textContent));
  assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');assert.equal(await page.locator('#games-pause').isEnabled(),true);assert.equal(await page.locator('#games-cheats-panel').isVisible(),true);await done(page);await waitColor(page,base);assert.equal(await row(page,bad).count(),0);
});

test('a delayed JSON import from an old game cannot change the next game',async t=>{
  const {page}=await cheatsPage(t);await openGame(page);await addCodes(page,sixWhite);await row(page,sixWhite).waitFor();const exported=await exportCodes(page);
  await page.evaluate(()=>{
    for(const method of ['text','arrayBuffer']){const original=File.prototype[method];File.prototype[method]=function(){if(this.name==='delayed-cheats.json')return new Promise(resolve=>{window.releaseCheatImport=async()=>resolve(await original.call(this));});return original.call(this);};}
  });
  await page.locator('#games-cheats-import').setInputFiles({name:'delayed-cheats.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await page.waitForFunction(()=>typeof window.releaseCheatImport==='function');
  await page.locator('#close-games-player').click();await openGame(page,'cheat-green');await openCheats(page);await page.evaluate(()=>window.releaseCheatImport());await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-cheat-code]').count(),0);assert.equal(await page.locator('#games-cheats-enabled').isChecked(),true);
});

test('mobile portrait and landscape keep cheat editing inside the viewport',async t=>{
  const {page}=await cheatsPage(t,{mobile:true});await openGame(page);await addCodes(page,`${eightWrong}\n${sixWhite}`,'Mobile codes');await row(page,sixWhite).waitFor();
  await mkdir('docs/evidence/nes-cheats',{recursive:true});
  for(const viewport of [{width:412,height:915},{width:915,height:412}]){
    await page.setViewportSize(viewport);await page.locator('#games-cheat-form').scrollIntoViewIfNeeded();await page.waitForTimeout(60);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const panel=await page.locator('#games-cheats-panel').boundingBox();assert.ok(panel.x>=0&&panel.x+panel.width<=viewport.width+1);
    await page.screenshot({path:`docs/evidence/nes-cheats/${viewport.width<viewport.height?'portrait':'landscape'}.png`});
  }
});

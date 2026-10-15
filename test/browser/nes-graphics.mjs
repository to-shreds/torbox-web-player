// Real-cartridge graphics acceptance. These cases use the exact bundled ROMs,
// native PPU output, and the real app save controls, without timer-based frames.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';

const evidence='docs/evidence/nes-graphics';
let browser,fixture;
before(async()=>{
  await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  fixture=await startFixture(4215);
});
after(async()=>{await browser?.close();await fixture?.close();});
async function app(t,{legacyEngine=false}={}){
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  page.setDefaultTimeout(12000);
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.equal(requests.filter(url=>/^\/(api\/|healthz|media\/)/.test(new URL(url).pathname)).length,0);});
  await context.route('https://**/*',route=>route.abort());
  if(legacyEngine)await page.route('**/vendor/jsnes-2.1.0-torbox.1.min.js*',route=>route.fulfill({path:'public/vendor/jsnes-2.1.0.min.js',contentType:'text/javascript'}));
  await page.addInitScript(()=>{
    let api;
    Object.defineProperty(window,'jsnes',{configurable:true,get:()=>api,set:value=>{
      class ControlledNES extends value.NES {
        constructor(options){
          super({...options,sampleRate:48000});
          const nativeFrame=this.frame.bind(this),nativeRestore=this.fromJSON.bind(this);
          this.graphicsFrames=0;this.graphicsRestores=0;
          // The application still owns its native start, pause, save, and restore
          // lifecycle. Only advancement is controlled so a pixel test compares
          // the same emulated frame instead of racing requestAnimationFrame.
          this.frame=()=>{};
          this.graphicsStep=count=>{for(let i=0;i<count;i++){nativeFrame();this.graphicsFrames++;}};
          this.fromJSON=record=>{nativeRestore(record);this.graphicsFrames=0;this.graphicsRestores++;};
          window.graphicsNES=this;
        }
      }
      api={...value,NES:ControlledNES};
    }});
    window.graphicsPixels=()=>{
      const c=document.querySelector('#games-canvas'),d=c.getContext('2d').getImageData(0,0,256,240).data;
      let hash=2166136261;const colors=new Map();
      for(let i=0;i<d.length;i+=4){hash=Math.imul(hash^d[i],16777619);hash=Math.imul(hash^d[i+1],16777619);hash=Math.imul(hash^d[i+2],16777619);const key=d[i]+','+d[i+1]+','+d[i+2];colors.set(key,(colors.get(key)||0)+1);}
      return {hash:hash>>>0,colors:Object.fromEntries(colors),frame:window.graphicsNES.graphicsFrames,restores:window.graphicsNES.graphicsRestores};
    };
  });
  await page.goto(fixture.origin+'/#games');
  return page;
}
async function open(page,id){
  await page.locator(`[data-game-id="${id}"]`).click();
  await page.waitForFunction(()=>['playing','paused'].includes(document.querySelector('#games-player').dataset.state));
}
async function step(page,count,{reset=false}={}){
  return page.evaluate(({count,reset})=>{const n=window.graphicsNES;if(reset){n.reloadROM();n.graphicsFrames=0;}n.graphicsStep(count);return window.graphicsPixels();},{count,reset});
}
async function capture(page,name){await page.screenshot({path:`${evidence}/${name}.png`});}

// Fixed known frames are assigned from the actual bundled NTSC revision. A
// pixel oracle must include sprites: a colorful title alone also passes with
// the upstream 8x16 tile-address bug that cut characters in half.
const SMB3_FRAMES = new Map([
  [390,972485408],[450,2054907761],[600,2785151150],
]);

test('bundled SMB3 renders complete 8x16 sprites during the black intro and tan title stage',async t=>{
  const page=await app(t);await open(page,'super-mario-bros-3');
  const results=[];
  for(const frame of [390,450,600]){
    const pixels=await step(page,frame,{reset:true});
    assert.equal(pixels.hash,SMB3_FRAMES.get(frame),`native SMB3 sprite pixels at frame ${frame}`);
    if(frame===390)assert.ok((pixels.colors['0,0,0']||0)>40000,'the black intro backdrop is intentional');
    else assert.ok((pixels.colors['255,218,154']||0)>20000,'the title stage must finish revealing its tan backdrop');
    await capture(page,`smb3-fixed-${frame}`);results.push({frame,...pixels});
  }
  await writeFile(`${evidence}/smb3-pixels.json`,JSON.stringify({success:true,results},null,2)+'\n');
});

test('SMB3 manual and automatic app saves retain complete native graphics on a new emulator',async t=>{
  const page=await app(t);await open(page,'super-mario-bros-3');
  const initial=await step(page,600,{reset:true});
  assert.equal(initial.hash,SMB3_FRAMES.get(600));
  await page.locator('#games-pause').click();
  await page.locator('#games-save').click();
  await page.waitForFunction(()=>/Game saved/.test(document.querySelector('#games-player-message').textContent));
  const expected=await step(page,60);
  await page.locator('#games-load').click();
  await page.waitForFunction(()=>/Loaded your manual save/.test(document.querySelector('#games-player-message').textContent));
  const manual=await step(page,60);
  assert.equal(manual.hash,expected.hash,'manual restoration must reproduce exactly the continuous native frame');
  await capture(page,'smb3-manual-restored');
  const autoExpected=await page.evaluate(()=>{const n=window.graphicsNES,snapshot=structuredClone(n.toJSON());n.graphicsStep(1);const expected=window.graphicsPixels();n.fromJSON(snapshot);return expected;});
  // Closing invokes the real automatic save path, then a newly constructed
  // engine restores it after the explicit Resume action.
  await page.locator('#close-games-player').click();
  await open(page,'super-mario-bros-3');
  assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');
    await page.locator('#games-pause').click();
  await page.waitForFunction(()=>document.querySelector('#games-player').dataset.state==='playing');
  const auto=await step(page,1);
  assert.equal(auto.restores,1,'automatic Resume must restore into the new engine');
  assert.equal(auto.hash,autoExpected.hash,'automatic restoration on a new engine must match the uninterrupted native frame');
  assert.ok((auto.colors['255,218,154']||0)>20000,'saved title scenery must remain intact');
  await capture(page,'smb3-auto-restored');
  await writeFile(`${evidence}/save-pixels.json`,JSON.stringify({success:true,initial,expected,manual,autoExpected,auto},null,2)+'\n');
});

test('all three supplied cartridges render real native frames and survive manual save restoration',async t=>{
  const page=await app(t),results=[];
  for(const id of ['super-mario-bros-duck-hunt','super-mario-bros-3','tmnt-ii-arcade-game']){
    await open(page,id);
    const initial=await step(page,600,{reset:true});
    assert.ok(Object.keys(initial.colors).length>=3,`${id} must draw native game graphics`);
    assert.ok(Object.entries(initial.colors).filter(([color])=>color!=='0,0,0'&&color!=='255,255,255').reduce((count,[,pixels])=>count+pixels,0)>1000,`${id} must render colored game pixels, not an empty or monochrome canvas`);
    assert.equal(await page.evaluate(()=>window.graphicsNES.rom.mapperType),id==='super-mario-bros-duck-hunt'?66:4);
    await page.locator('#games-pause').click();await page.locator('#games-save').click();
    await page.waitForFunction(()=>/Game saved/.test(document.querySelector('#games-player-message').textContent));
    const expected=await step(page,60);
    await page.locator('#games-load').click();
    await page.waitForFunction(()=>/Loaded your manual save/.test(document.querySelector('#games-player-message').textContent));
    const restored=await step(page,60);
    assert.equal(restored.hash,expected.hash,`${id} restored native pixels must match uninterrupted native pixels`);
    await capture(page,id+'-restored');results.push({id,initial,expected,restored});
    await page.locator('#close-games-player').click();
  }
  await writeFile(`${evidence}/three-cartridges.json`,JSON.stringify({success:true,results},null,2)+'\n');
});


test('saves written by the unmodified 2.1.0 engine resume with corrected sprites and unchanged progress',async t=>{
  const page=await app(t,{legacyEngine:true});await open(page,'super-mario-bros-3');
  const legacy=await step(page,600,{reset:true});
  assert.equal(legacy.hash,3052838854,'fixture must reproduce the old renderer, including the sprite defect');
  await page.locator('#games-pause').click();await page.locator('#games-save').click();
  await page.waitForFunction(()=>/Game saved/.test(document.querySelector('#games-player-message').textContent));
  await capture(page,'smb3-before-fix');
  const before=await page.evaluate(()=>({ram:Array.from(window.graphicsNES.cpu.mem.slice(0,2048)),pc:window.graphicsNES.cpu.REG_PC}));
  await page.locator('#games-pause').click(); // Running while controlled, so close creates the automatic slot.
  await page.locator('#close-games-player').click();
  await page.unroute('**/vendor/jsnes-2.1.0-torbox.1.min.js*');
  await page.reload();await open(page,'super-mario-bros-3');
  assert.equal(await page.locator('#games-player').getAttribute('data-state'),'paused');
  await page.locator('#games-pause').click();
  const after=await page.evaluate(()=>({ram:Array.from(window.graphicsNES.cpu.mem.slice(0,2048)),pc:window.graphicsNES.cpu.REG_PC}));
  assert.deepEqual(after,before,'the new renderer must restore the exact old CPU progress');
  const auto=await step(page,60);assert.equal(auto.hash,2054084051,'old automatic save must show fixed native frame660');
  await capture(page,'smb3-legacy-auto-restored');
  await page.locator('#games-load').click();
  await page.waitForFunction(()=>/Loaded your manual save/.test(document.querySelector('#games-player-message').textContent));
  const manual=await step(page,60);assert.equal(manual.hash,2054084051,'old manual save must show fixed native frame660');
  await capture(page,'smb3-legacy-manual-restored');
  await writeFile(`${evidence}/legacy-save.json`,JSON.stringify({success:true,legacy,progressRestoredExactly:true,auto,manual},null,2)+'\n');
});

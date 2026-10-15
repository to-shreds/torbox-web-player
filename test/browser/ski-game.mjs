import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

// The real self-hosted child runs inside a small genuine parent window. No test
// replaces its simulation, renderer, monster, collision or input functions.
const origin='http://127.0.0.1:4194';
const parentHTML=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px sans-serif}nav{height:70px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}button{min-height:30px}#child{display:block;width:100%;height:calc(100dvh - 70px);border:0}#attacker{display:none}</style><script src="/_parent.js" defer></script></head><body><nav><button id="resume" data-command="resume">Resume</button><button id="pause" data-command="pause">Pause</button><button id="restart" data-command="restart">Restart</button><button id="close" data-command="close">Close</button><button id="left" data-key="37">Left</button><button id="jump" data-key="32">Jump</button><button id="right" data-key="39">Right</button><button id="tuck" data-key="40">Tuck</button><button id="bad-source">Other frame</button></nav><iframe id="child" src="${origin}/games-web/skifree/index.html?v=release-1.2.3-games.1"></iframe><iframe id="attacker" src="/_attacker.html"></iframe></body></html>`;
const parentJS=`const child=document.getElementById('child');window.childStatuses=[];window.addEventListener('message',event=>{if(event.source===child.contentWindow&&event.origin==='${origin}')window.childStatuses.push(event.data);});const send=data=>child.contentWindow.postMessage({type:'torbox-extra-command',...data},'${origin}');for(const button of document.querySelectorAll('[data-command]'))button.addEventListener('click',()=>send({command:button.dataset.command}));for(const button of document.querySelectorAll('[data-key]')){button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);send({command:'key',key:Number(button.dataset.key),pressed:true});});for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>send({command:'key',key:Number(button.dataset.key),pressed:false}));}document.getElementById('bad-source').addEventListener('click',()=>document.getElementById('attacker').contentWindow.postMessage('attack',location.origin));`;
const attackerJS=`window.addEventListener('message',()=>parent.document.getElementById('child').contentWindow.postMessage({type:'torbox-extra-command',command:'resume'},'${origin}'));`;
const files=new Map([
  ['/games-web/skifree/index.html',['games-web/skifree/index.html','text/html']],['/games-web/skifree/game.js',['games-web/skifree/game.js','text/javascript']],['/games-web/skifree/style.css',['games-web/skifree/style.css','text/css']],['/parental-controls.js',['parental-controls.js','text/javascript']]
]);
let browser,server;
before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  server=createServer(async(req,res)=>{
    const path=new URL(req.url,origin).pathname;let body,type='text/html';
    if(path==='/')body=parentHTML;
    else if(path==='/_parent.js'){body=parentJS;type='text/javascript';}
    else if(path==='/_attacker.html')body='<script src="/_attacker.js"></script>';
    else if(path==='/_attacker.js'){body=attackerJS;type='text/javascript';}
    else if(files.has(path)){const [file,mime]=files.get(path);body=await readFile(new URL('../../public/'+file,import.meta.url));type=mime;}
    else{res.statusCode=404;body='Missing test resource';}
    res.setHeader('Content-Type',type+'; charset=utf-8');res.end(body);
  });
  await new Promise(resolve=>server.listen(4194,'127.0.0.1',resolve));
});
after(async()=>{await browser?.close();await new Promise(resolve=>{server?.closeAllConnections();server?.close(resolve);});});
async function skiPage(t,{mobile=false,kid=false,fastClock=false,parentHost='127.0.0.1'}={}){
  const context=await browser.newContext({viewport:mobile?{width:412,height:915}:{width:1000,height:760},isMobile:mobile,hasTouch:mobile}),page=await context.newPage(),errors=[],requests=[];page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.equal(requests.some(url=>!['127.0.0.1','localhost'].includes(new URL(url).hostname)),false);assert.equal(requests.some(url=>/^\/(api\/|healthz|media\/)/.test(new URL(url).pathname)),false);});
  await context.route('https://**/*',route=>route.abort());
  await page.addInitScript(({kid,fastClock})=>{
    if(kid)localStorage.setItem('torbox-parental-controls-v1',JSON.stringify({version:1,viewers:{'viewer-1':{enabled:true}}}));
    if(fastClock){const raf=requestAnimationFrame;window.requestAnimationFrame=callback=>raf(timestamp=>callback(timestamp*20));}
  },{kid,fastClock});
  await page.goto(`http://${parentHost}:4194/`);const child=page.frames().find(frame=>frame.url().includes('/games-web/skifree/'));
  await child.waitForFunction(()=>window.skiState?.frames===0);return{page,context,child};
}
const state=child=>child.evaluate(()=>window.skiState);
async function resume(page,child){await page.locator('#resume').click();await child.waitForFunction(()=>!window.skiState.paused&&window.skiState.frames>4);}
async function hold(page,id,ms){const target=await page.locator(id).boundingBox();await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await page.mouse.down();await page.waitForTimeout(ms);await page.mouse.up();}

test('the real ski simulation steers, jumps, tracks distance and restarts through parent controls',async t=>{
  const {page,child}=await skiPage(t);assert.equal((await state(child)).paused,true);await resume(page,child);const before=await state(child);await hold(page,'#right',300);const steered=await state(child);assert.ok(steered.playerX>before.playerX);assert.ok(steered.distance>before.distance);
  const jump=await page.locator('#jump').boundingBox();await page.mouse.move(jump.x+10,jump.y+10);await page.mouse.down();await child.waitForFunction(()=>window.skiState.jumpHeight>0);await page.mouse.up();assert.equal((await state(child)).playerState,'JUMPING');
  await page.waitForTimeout(900);assert.equal((await state(child)).jumpHeight,0);await page.locator('#restart').click();await child.waitForFunction(()=>window.skiState.distance<10&&!window.skiState.paused);assert.equal((await state(child)).style,0);
  await mkdir('docs/evidence/extra-games',{recursive:true});await page.screenshot({path:'docs/evidence/extra-games/ski-desktop.png'});
});

test('pause and close stop frames and held keys; manual pause cannot be resumed by a movement command',async t=>{
  const {page,child}=await skiPage(t);await resume(page,child);await page.locator('#pause').click();await child.waitForFunction(()=>window.skiState.paused);const paused=await state(child);await hold(page,'#right',150);await page.waitForTimeout(100);assert.equal((await state(child)).frames,paused.frames);assert.equal((await state(child)).keys.length,0);
  await resume(page,child);await child.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state(child)).paused,true);assert.equal((await state(child)).keys.length,0);
  await page.locator('#resume').click();await child.waitForFunction(()=>!window.skiState.paused);await page.locator('#close').click();await child.waitForFunction(()=>window.skiState.closed);const closed=await state(child);await page.locator('#resume').click();await page.waitForTimeout(150);assert.equal((await state(child)).frames,closed.frames);
});

test('idempotent mute commands do not create a parent status feedback loop',async t=>{
  const {page,child}=await skiPage(t);await page.evaluate(()=>{
    window.childStatuses=[];const frame=document.getElementById('child');
    window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='torbox-extra-status'&&event.data.state==='playing')frame.contentWindow.postMessage({type:'torbox-extra-command',command:'mute',muted:true},location.origin);});
  });
  await resume(page,child);await page.waitForTimeout(1000);const messages=await page.evaluate(()=>window.childStatuses.length);assert.ok(messages<=5,'mute acknowledgement must not cause repeated playing status messages');
  assert.equal(await child.locator('body').getAttribute('data-muted'),'true');assert.equal((await state(child)).paused,false);
});

test('commands from another window or another origin cannot start the paused game',async t=>{
  const view=await skiPage(t);await view.page.locator('#bad-source').click();await view.page.waitForTimeout(100);assert.equal((await state(view.child)).frames,0);
  const other=await skiPage(t,{parentHost:'localhost'});await other.page.locator('#resume').click();await other.page.waitForTimeout(150);assert.equal((await state(other.child)).frames,0);assert.equal((await state(other.child)).paused,true);
});

test('Kid Mode and an adult-viewer change stop the child and reject further starts',async t=>{
  const kid=await skiPage(t,{kid:true});await kid.child.waitForSelector('body[data-state="error"]');await kid.page.locator('#resume').click();await kid.page.waitForTimeout(100);assert.equal((await state(kid.child)).frames,0);
  const adult=await skiPage(t);await resume(adult.page,adult.child);await adult.page.evaluate(()=>localStorage.setItem('tw-viewer','viewer-2'));await adult.child.waitForSelector('body[data-state="error"]');const stopped=await state(adult.child);await adult.page.locator('#resume').click();await adult.page.waitForTimeout(100);assert.equal((await state(adult.child)).frames,stopped.frames);
});

test('stored scores with invalid shapes cannot break the actual title screen or a new run',async t=>{
  const {page,child}=await skiPage(t);await page.evaluate(()=>localStorage.setItem('torbox-extra-ski-scores-v1:viewer-1','"wrong shape"'));await child.goto(origin+'/games-web/skifree/index.html?v=release-1.2.3-games.1');await child.waitForFunction(()=>window.skiState?.frames===0);await resume(page,child);assert.ok((await state(child)).frames>4);
});

test('mobile touch controls and portrait/landscape layouts fit the actual canvas and toolbar',async t=>{
  const {page,child}=await skiPage(t,{mobile:true});await child.locator('#ski-pause').click();await child.waitForFunction(()=>window.skiState.frames>4);const before=await state(child);
  const key=child.locator('[data-ski-key="39"]');await key.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',button:0});await page.waitForTimeout(180);await key.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',button:0});assert.ok((await state(child)).playerX>before.playerX);
  await mkdir('docs/evidence/extra-games',{recursive:true});
  for(const viewport of [{width:412,height:915},{width:915,height:412}]){await page.setViewportSize(viewport);await page.waitForTimeout(80);const bounds=await child.locator('#game').boundingBox();assert.ok(bounds.width>250&&bounds.height>150);assert.equal(await child.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await child.locator('#ski-pause').isVisible(),true);await page.screenshot({path:`docs/evidence/extra-games/ski-${viewport.width<viewport.height?'portrait':'landscape'}.png`});}
});

test('the native monster chase starts after real simulated skiing reaches 2000 meters',{timeout:30000},async t=>{
  // Accelerate only the RAF clock. The game's own dt cap, native physics,
  // obstacles and monster still determine every frame and outcome.
  const {page,child}=await skiPage(t,{fastClock:true});await resume(page,child);await child.locator('#ski-fast').click();
  await page.evaluate(()=>{const frame=document.querySelector('#child');for(const key of [39,40])frame.contentWindow.postMessage({type:'torbox-extra-command',command:'key',key,pressed:true},location.origin);});
  await child.waitForFunction(()=>window.skiState.monsterActive,{},{timeout:24000});const hunted=await state(child);assert.ok(hunted.distance>=2000);assert.ok(['CHASE','TIRED','REST'].includes(hunted.monsterCycle));await page.locator('#pause').click();await page.screenshot({path:'docs/evidence/extra-games/ski-monster.png'});
});

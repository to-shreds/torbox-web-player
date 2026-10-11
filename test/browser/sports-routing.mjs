import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';
const catalog=JSON.parse(await readFile(new URL('../../public/sports-catalog.json',import.meta.url),'utf8'));
const tennis=catalog.items.find(item=>item.id==='t2');
const mediaOrigin=new URL(tennis.sources[0].url).origin;
const otherOrigin='https://play.redbull.com';
const forbidden='https://torbox-web-player-key.onrender.com/forbidden.ts';
const playlist=await readFile(new URL('../fixtures/sports/playlist.m3u8',import.meta.url),'utf8');
const segment=await readFile(new URL('../fixtures/sports/segment0.ts',import.meta.url));
let browser,fixture;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});fixture=await startFixture(4183);});
after(async()=>{await browser?.close();await fixture?.close();});
async function routingPage(t,{attack='',native=false}={}){
  const context=await browser.newContext({viewport:{width:1000,height:760},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(35000);
  const requests=[],errors=[];let forbiddenRequests=0,metadataRequests=0,redirects=0;
  page.on('request',request=>requests.push({url:request.url(),headers:request.headers()}));page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);});
  await context.addCookies([{name:'existing-provider-cookie',value:'private-value',domain:new URL(mediaOrigin).hostname,path:'/',secure:true}]);
  await context.route('https://**/*',route=>route.abort());
  await context.route('https://torbox-web-player-key.onrender.com/**',route=>{forbiddenRequests++;return route.abort();});
  const mediaRoute=async route=>{
    const path=new URL(route.request().url()).pathname;const cors={'Access-Control-Allow-Origin':'*'};
    let destination='';
    if(attack==='approved-redirect'&&path.endsWith('/segment0.ts'))destination=otherOrigin+'/approved.ts';
    if(attack==='redirect-chain'&&path.endsWith('/segment0.ts'))destination=otherOrigin+'/hop.ts';
    if(attack==='redirect-chain'&&path.endsWith('/hop.ts'))destination=forbidden;
    if(attack==='credentials-redirect'&&path.endsWith('/segment0.ts'))destination=mediaOrigin.replace('https://','https://user:password@')+'/approved.ts';
    if(attack==='http-redirect'&&path.endsWith('/segment0.ts'))destination=mediaOrigin.replace('https://','http://')+'/approved.ts';
    if(attack==='port-redirect'&&path.endsWith('/segment0.ts'))destination=mediaOrigin+':444/approved.ts';
    if((attack==='manifest-redirect'&&path===new URL(tennis.sources[0].url).pathname)||(attack==='variant-redirect'&&path.endsWith('/variant.m3u8'))||(attack==='segment-redirect'&&path.endsWith('/segment0.ts'))||(attack==='key-redirect'&&path.endsWith('/key.bin')))destination=forbidden;
    if(destination){redirects++;return route.fulfill({status:307,headers:{...cors,Location:destination}});}
    if(path.endsWith('.m3u8')){
      let body=playlist;
      if(attack==='variant-redirect')body='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180\n'+mediaOrigin+'/variant.m3u8\n';
      if(attack==='variant-direct')body='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180\n'+forbidden+'\n';
      if(attack==='segment-direct')body=playlist.replace('segment0.ts',forbidden);
      if(attack==='key-redirect'||attack==='key-direct')body=playlist.replace('#EXTINF:',`#EXT-X-KEY:METHOD=AES-128,URI="${attack==='key-direct'?forbidden:mediaOrigin+'/key.bin'}",IV=0x00000000000000000000000000000001\n#EXTINF:`);
      return route.fulfill({body,contentType:'application/vnd.apple.mpegurl',headers:cors});
    }
    if(path.endsWith('/segment0.ts')||path.endsWith('/approved.ts'))return route.fulfill({body:segment,contentType:'video/mp2t',headers:cors});
    return route.abort();
  };
  await context.route(mediaOrigin+'/**',mediaRoute);await context.route(otherOrigin+'/**',mediaRoute);
  await context.route('https://api-player.redbull.com/**',route=>{metadataRequests++;if(attack==='replay-metadata-redirect')return route.fulfill({status:302,headers:{Location:forbidden,'Access-Control-Allow-Origin':'*'}});return route.fulfill({json:{videoUrl:mediaOrigin+'/replay.m3u8',playabilityErrors:[],description:'RESULT SPOILER'},headers:{'Access-Control-Allow-Origin':'*'}});});
  if(native)await context.addInitScript(()=>window.addEventListener('load',()=>{if(typeof window.createSportsHls==='function'){window.Hls.isSupported=()=>false;document.getElementById('sports-video').canPlayType=()=> 'probably';}}));
  await page.goto(fixture.origin+'/#sports');await page.waitForSelector('.sports-card');
  return {page,requests,forbiddenRequests:()=>forbiddenRequests,metadataRequests:()=>metadataRequests,redirects:()=>redirects};
}
function privateCalls(requests){return requests.filter(request=>new URL(request.url).origin===fixture.origin&&/^\/(api\/|healthz)/.test(new URL(request.url).pathname));}
function assertAnonymous(requests){for(const request of requests.filter(request=>[mediaOrigin,otherOrigin,'https://api-player.redbull.com'].includes(new URL(request.url).origin))){assert.equal(request.headers.authorization,undefined);assert.equal(request.headers.cookie,undefined);}}
test('anonymous Sports plays directly without any private service request or provider credentials',async t=>{const view=await routingPage(t);await view.page.locator('[data-sports-id="t2"]').click();await view.page.waitForFunction(()=>document.querySelector('#sports-player-frame').contentDocument?.querySelector('#sports-video')?.currentTime>0);assert.equal(privateCalls(view.requests).length,0);assert.equal(view.forbiddenRequests(),0);assertAnonymous(view.requests);});
test('legitimate approved CDN beacon redirect still plays without private service requests or provider cookies',async t=>{const view=await routingPage(t,{attack:'approved-redirect'});await view.page.locator('[data-sports-id="t2"]').click();await view.page.waitForFunction(()=>document.querySelector('#sports-player-frame').contentDocument?.querySelector('#sports-video')?.currentTime>0);assert.ok(view.redirects()>0);assert.ok(view.requests.some(x=>x.url===otherOrigin+'/approved.ts'));assert.equal(view.forbiddenRequests(),0);assert.equal(privateCalls(view.requests).length,0);assertAnonymous(view.requests);});
test('anonymous full replay resolves metadata and media directly without result text',async t=>{const view=await routingPage(t);const replay=catalog.items.find(x=>x.kind==='replay');await view.page.locator('[data-sports-mode="replay"]').click();await view.page.locator(`[data-sports-id="${replay.id}"]`).click();await view.page.waitForFunction(()=>document.querySelector('#sports-player-frame').contentDocument?.querySelector('#sports-video')?.currentTime>0);assert.equal(view.metadataRequests(),1);assert.equal(privateCalls(view.requests).length,0);assert.equal(view.forbiddenRequests(),0);assertAnonymous(view.requests);assert.equal((await view.page.locator('#sports-panel').textContent()).includes('RESULT SPOILER'),false);});
for(const attack of ['manifest-redirect','variant-redirect','segment-redirect','key-redirect','variant-direct','segment-direct','key-direct','redirect-chain','credentials-redirect','http-redirect','port-redirect']){
  test(`Sports denies ${attack} before forbidden media transfer`,{timeout:45000},async t=>{const view=await routingPage(t,{attack});await view.page.locator('[data-sports-id="t2"]').click();await view.page.waitForSelector('#sports-retry:not([hidden])');assert.equal(view.forbiddenRequests(),0);assert.equal(privateCalls(view.requests).length,0);assertAnonymous(view.requests);assert.ok(!view.requests.some(x=>/user:password@|:444\/|^http:.*approved\.ts/.test(x.url)));});
}
test('replay metadata redirects cannot reach Render',async t=>{const view=await routingPage(t,{attack:'replay-metadata-redirect'});const replay=catalog.items.find(x=>x.kind==='replay');await view.page.locator('[data-sports-mode="replay"]').click();await view.page.locator(`[data-sports-id="${replay.id}"]`).click();await view.page.waitForSelector('#sports-retry:not([hidden])');assert.equal(view.metadataRequests(),1);assert.equal(view.forbiddenRequests(),0);assert.equal(privateCalls(view.requests).length,0);});
test('native browser HLS fallback is isolated and cannot redirect media to Render',async t=>{const view=await routingPage(t,{attack:'manifest-redirect',native:true});await view.page.locator('[data-sports-id="t2"]').click();await view.page.waitForSelector('#sports-retry:not([hidden])');assert.equal(view.forbiddenRequests(),0);assertAnonymous(view.requests);assert.equal(await view.page.frameLocator('#sports-player-frame').locator('#sports-video').getAttribute('crossorigin'),'anonymous');});

import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium,firefox,webkit}=await import('../.release-browser/node_modules/playwright/index.mjs');
const root=path.resolve('public');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(!p.startsWith('/torbox-web-player/')){res.writeHead(404).end();return;}p=p.slice('/torbox-web-player/'.length);if(!p||p.endsWith('/'))p+='index.html';const file=path.resolve(root,p);if(!file.startsWith(root+'/'))throw Error('path');res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(await fs.readFile(file));}catch{res.writeHead(404).end('not found');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,base=origin+'/torbox-web-player/';
const key='fixture-browser-TorBox-key-not-real',hash='a'.repeat(40),video=await fs.readFile('.release-browser/fixture.mp4');
await fs.mkdir('.release-results',{recursive:true});
const results=[];
async function context(browser){const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),requests=[],errors=[];
 await ctx.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin===origin)return route.continue();requests.push({host:url.hostname,path:url.pathname,method:req.method()});
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'Authorization,Content-Type,Range','access-control-allow-methods':'GET,POST,OPTIONS,HEAD','access-control-expose-headers':'X-TorBox-Bridge,Content-Length,Content-Range,Accept-Ranges','content-type':'application/json'};
 if(url.hostname.includes('onrender.com'))return route.abort('failed');
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
 if(url.hostname.endsWith('workers.dev')){headers['x-torbox-bridge']='cloudflare';let data;
   if(url.pathname.endsWith('/user/me'))data={plan:2};
   else if(url.pathname.endsWith('/checkcached'))data={[hash]:true};
   else if(url.pathname.endsWith('/mylist'))data=[{id:42,hash,name:'Fixture Movie',download_finished:true,download_present:true,files:[{id:1,short_name:'Fixture.Movie.720p.h264.aac.mp4',size:50000000,mimetype:'video/mp4'}]}];
   else if(url.pathname.endsWith('/requestdl'))data='https://store.tb-cdn.io/fixture.mp4';
   else if(url.pathname==='/relay/health')return route.fulfill({headers,body:JSON.stringify({ok:true,bridge:'cloudflare',protocol:1})});
   else throw Error('Unexpected relay route '+url.pathname);
   return route.fulfill({headers,body:JSON.stringify({success:true,data})});
 }
 if(['v3-cinemeta.strem.io','cinemeta-catalogs.strem.io'].includes(url.hostname)){const id=/\/meta\/(?:movie|series)\/(tt\d+)/.exec(url.pathname)?.[1]||'tt0111161',type=url.pathname.includes('/series/')?'series':'movie',meta={id,type,name:id==='tt0111161'?'Fixture Movie':'Fixture Show',description:'Test metadata',videos:[{id:id+':1:1',season:1,episode:1,name:'Episode 1',released:'2020-01-01'},{id:id+':1:2',season:1,episode:2,name:'Episode 2',released:'2020-01-02'}]};return route.fulfill({headers,body:JSON.stringify(url.pathname.includes('/meta/')?{meta}:{metas:[meta]})});}
 if(url.hostname.startsWith('stremthru.')){assert.ok(url.pathname.includes('/stremio/torz/')&&url.pathname.includes('/stream/'),'Configured StremThru prefix must be preserved');return route.fulfill({headers,body:JSON.stringify({streams:[{infoHash:hash,title:'Fixture.Movie.720p.h264.aac.mp4',behaviorHints:{filename:'Fixture.Movie.720p.h264.aac.mp4',videoSize:50000000},videoCodec:'h264',audioCodecs:['aac']}]})});}
 if(url.hostname.startsWith('zilean'))return route.fulfill({headers,body:'[]'});
 if(url.hostname==='mediafusion.elfhosted.com')return route.fulfill({headers:{...headers,'content-type':'application/xml'},body:'<rss><channel></channel></rss>'});
 if(url.hostname==='store.tb-cdn.io'){
   const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers().range||'');
   const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),video.length-1):video.length-1;
   if(start>=video.length||end<start)return route.fulfill({status:416,headers:{'content-range':'bytes */'+video.length},body:''});
   const part=video.subarray(start,end+1),h={...headers,'content-type':'video/mp4','accept-ranges':'bytes','content-length':String(part.length)};
   if(range)h['content-range']=`bytes ${start}-${end}/${video.length}`;
   return route.fulfill({status:range?206:200,headers:h,body:req.method()==='HEAD'?'':part});
 }
 errors.push('Unexpected network host '+url.hostname);return route.abort();
 });
 ctx.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
 return {ctx,requests,errors};
}
try{for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
 const browser=await engine.launch({headless:true});try{
 const a=await context(browser),page=await a.ctx.newPage();await page.goto(base);await page.locator('#api-key').waitFor({state:'visible'});assert.equal(await page.locator('#portable-dialog').isVisible(),false,'Transfer is not default onboarding');await page.locator('#api-key').fill(key);await page.locator('#login-form button[type=submit]').click();await page.locator('#workspace').waitFor({state:'visible'});await page.getByText('Fixture Movie',{exact:true}).first().waitFor();assert.ok(a.requests.some(r=>r.host.endsWith('workers.dev')&&r.path.endsWith('/user/me')));
 await page.locator('#search').fill('Fixture');await page.locator('#search').press('Enter');assert.equal(await page.locator('#search').evaluate(e=>e===document.activeElement),false);await page.locator('#search-results-heading').waitFor({state:'visible'});await page.locator('#search').fill('');
 await page.evaluate(()=>{localStorage.setItem('torbox-watchlist-v1',JSON.stringify({'viewer-1':[{id:'tt0111161',type:'movie',name:'Fixture Movie',addedAt:1800000000000}],'viewer-2':[]}));localStorage.setItem('torbox-recent-v1',JSON.stringify([{key:'movie:tt0111161',title:'Fixture Movie',position:125,duration:1000,updatedAt:1800000000000}]));});
 await page.locator('#open-settings').click();await page.locator('#portable-open-send').click();await page.locator('#portable-show-qr').click();await page.locator('#portable-qr').waitFor({state:'visible'});await page.addScriptTag({url:base+'vendor/jsqr.js'});
 const link=await page.evaluate(()=>{const c=document.getElementById('portable-qr'),d=c.getContext('2d').getImageData(0,0,c.width,c.height);return jsQR(d.data,d.width,d.height).data;});assert.ok(link.includes('#setup=tw2.'));
 const b=await context(browser),receiver=await b.ctx.newPage();await receiver.goto(link);await receiver.locator('#portable-preview').waitFor({state:'visible'});assert.equal(new URL(receiver.url()).hash,'');assert.equal(b.requests.filter(r=>r.path.endsWith('/user/me')).length,0,'No connection sent before confirmation');await receiver.locator('#portable-import-confirm').click();await receiver.locator('#workspace').waitFor({state:'visible'});await receiver.waitForFunction(()=>JSON.parse(localStorage.getItem('torbox-recent-v1')||'[]')[0]?.title==='Fixture Movie');
 const state=await receiver.evaluate(()=>({recent:JSON.parse(localStorage.getItem('torbox-recent-v1')),lists:JSON.parse(localStorage.getItem('torbox-watchlist-v1')),parent:localStorage.getItem('torbox-parental-controls-v1')}));assert.equal(state.recent[0].position,125);assert.equal(state.lists['viewer-1'][0].id,'tt0111161');assert.equal(state.parent,null);
 await page.locator('#portable-password').fill('fixture-transfer-password');const downloadEvent=page.waitForEvent('download');await page.locator('#portable-export-file').click();const download=await downloadEvent,file='.release-results/'+name+'.twsetup';await download.saveAs(file);
 await receiver.locator('#open-settings').click();await receiver.locator('#portable-open-receive').click();await receiver.locator('#portable-file').setInputFiles(file);await receiver.locator('#portable-unlock').waitFor({state:'visible'});await receiver.locator('#portable-unlock-password').fill('wrong-password');await receiver.locator('#portable-unlock-button').click();await receiver.locator('#portable-message.error').waitFor();assert.equal(await receiver.locator('#portable-preview').isVisible(),false);await receiver.locator('#portable-unlock-password').fill('fixture-transfer-password');await receiver.locator('#portable-unlock-button').click();await receiver.locator('#portable-preview').waitFor({state:'visible'});await receiver.locator('#portable-import-confirm').click();await receiver.locator('#portable-dialog').waitFor({state:'hidden'});
 await receiver.goto(base+'direct/');await receiver.waitForURL(base);await receiver.locator('#workspace').waitFor({state:'visible'});assert.equal(await receiver.evaluate(()=>JSON.parse(localStorage.getItem('torbox-recent-v1'))[0].position),125);
 await receiver.screenshot({path:'.release-results/'+name+'-home.png',fullPage:true});
 assert.equal(await receiver.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'No mobile horizontal overflow');
 await receiver.locator('#catalog-grid button').first().click();await receiver.locator('#title-dialog').waitFor({state:'visible'});await receiver.getByRole('button',{name:'Play',exact:true}).first().click();await receiver.locator('#video-slot video').waitFor({state:'attached',timeout:30000});
 try{await receiver.waitForFunction(()=>{const v=document.querySelector('#video-slot video');return v&&v.currentTime>0.1;},{},{timeout:12000});}
 catch(error){
   const observation=await receiver.evaluate(async()=>{const v=document.querySelector('#video-slot video');const runtime=await import('./direct-runtime.js');return{video:v?{time:v.currentTime,duration:v.duration,readyState:v.readyState,networkState:v.networkState,error:v.error?.code,message:v.error?.message,paused:v.paused,ended:v.ended,src:v.currentSrc,canPlay:v.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')}:null,playerMessage:document.getElementById('player-message').textContent,trace:runtime.recentDirectTrace()};});
   console.error('FIXTURE_PLAYBACK_FAILURE',JSON.stringify({engine:name,observation,errors:b.errors,requests:b.requests},null,2));await receiver.screenshot({path:'.release-results/'+name+'-playback-failure.png',fullPage:true});throw error;
 }
 assert.ok(b.requests.some(r=>r.host==='store.tb-cdn.io'));assert.ok(b.requests.some(r=>r.host.startsWith('stremthru.')&&r.path.includes('/stremio/torz/')));
 assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);results.push({engine:name,passed:true,checks:['simple onboarding','automatic Render failure fallback','search keyboard blur','actual QR read/import','password-protected file import','metadata hydration','old bookmark redirect','state preservation','mobile layout','source lookup prefix','synthetic H264/AAC playback']});console.log(name+': all browser acceptance checks passed');
 await a.ctx.close();await b.ctx.close();
 }finally{await browser.close();}
}}finally{server.close();await fs.writeFile('.release-results/acceptance.json',JSON.stringify({fixtureOnly:true,results},null,2));}

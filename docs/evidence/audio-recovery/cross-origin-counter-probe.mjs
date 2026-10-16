import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../', import.meta.url));
const files={ aac:await readFile(root+'/test/fixtures/fixture.mp4'), eac3:await readFile(root+'/test/fixtures/h264-eac3.mkv') };
const cdn=createServer((req,res)=>{const kind=req.url.slice(1),bytes=files[kind];res.writeHead(200,{'Content-Type':kind==='aac'?'video/mp4':'video/x-matroska','Content-Length':bytes.length});res.end(bytes);});
await new Promise(r=>cdn.listen(0,'127.0.0.1',r));
const server=createServer((req,res)=>{if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<video id="v" controls></video>');}else{res.writeHead(307,{Location:`http://127.0.0.1:${cdn.address().port}${req.url}`});res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/tmp/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
const rows=[];
for(const kind of ['aac','eac3','aac']){
 const row=await page.evaluate(async kind=>{const v=document.querySelector('video');v.pause();v.removeAttribute('src');v.load();const afterReset=v.webkitAudioDecodedByteCount;v.src='/'+kind;v.load();await v.play();await new Promise(r=>setTimeout(r,1400));return {kind,afterReset,time:v.currentTime,audioBytes:v.webkitAudioDecodedByteCount,videoFrames:v.webkitDecodedFrameCount,error:v.error&&v.error.code,src:v.currentSrc,crossOrigin:v.crossOrigin};},kind);rows.push(row);
}
console.log(JSON.stringify(rows));await writeFile(new URL('./cross-origin-counters.json', import.meta.url),JSON.stringify({browser:await browser.version(),sameElement:true,cdnCorsHeaders:false,rows},null,2));await browser.close();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>cdn.close(r))]);

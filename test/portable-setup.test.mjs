import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { collectPortableSetup, validatePortableSetup, encodePortableSetup, decodePortableSetup, stagedPortableState, writePortableState, makeSetupUrl, tokenFromText, isProtectedSetup, portableSummary, splitSetupFrames, SetupFrameCollector, hydratePortableMetadata } from '../public/portable-setup.js';
function store(values={}){const m=new Map(Object.entries(values));return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),dump:()=>Object.fromEntries(m)};}
const fixtureKey='fixture-TorBox-key-not-real';
function sample(){return store({'torbox-settings-v1':JSON.stringify({resolution:'720p',resumeRewindSeconds:15,autoNext:false}),'torbox-recent-v1':JSON.stringify([{key:'series:tt0903747:1:2',title:'Metadata must stay behind',episodeName:'No descriptions in transfer',poster:'https://example.invalid/poster',position:543.9,duration:1800.5,completed:false,updatedAt:1800000000000}]),'torbox-watchlist-v1':JSON.stringify({'viewer-1':[{type:'movie',id:'tt0111161',name:'Do not pack this title',poster:'https://example.invalid/image',addedAt:1800000000000}],'viewer-2':[{type:'series',id:'tt0903747',name:'Another title',addedAt:1799999999999}]}),'torbox-parental-controls-v1':'PRIVATE_PARENT_SENTINEL','torbox-search-history-v1':'PRIVATE_SEARCH_SENTINEL','torbox-source-memory-v1':'PRIVATE_DEVICE_SENTINEL','tw-viewer':'viewer-2'});}

test('portable scope excludes parent data searches viewer choice source learning and descriptive metadata',()=>{
 const v=collectPortableSetup(fixtureKey,sample()),json=JSON.stringify(v);assert.equal(v[2],fixtureKey);for(const text of ['PRIVATE_','Metadata must','https://','Do not pack','viewer-2'])assert.ok(!json.includes(text),text);assert.equal(v[4][0][4],543);assert.equal(v[4][0][1],'0903747');assert.equal(portableSummary(v).myList,2);
});
test('compressed plain token and private URL round trip without any fetch',async()=>{
 const v=collectPortableSetup(fixtureKey,sample()),token=await encodePortableSetup(v);assert.deepEqual(await decodePortableSetup(token),v);assert.equal(isProtectedSetup(token),false);const url=makeSetupUrl(token,'https://example.com/player/?utm_source=remove');assert.equal(new URL(url).search,'');assert.equal(tokenFromText(url),token);assert.equal(tokenFromText(token),token);
});
test('password protection rejects wrong password and authenticates the envelope',async()=>{
 const v=collectPortableSetup(fixtureKey,sample()),password='fixture-transfer-password',token=await encodePortableSetup(v,{password});assert.equal(isProtectedSetup(token),true);assert.deepEqual(await decodePortableSetup(token,{password}),v);await assert.rejects(decodePortableSetup(token,{password:'incorrect-password'}),/incorrect|damaged/);await assert.rejects(encodePortableSetup(v,{password:'short'}),/10 to 200/);
});
test('malformed, damaged, overlarge and unsupported transfers fail before writes',async()=>{
 const v=collectPortableSetup(fixtureKey,sample()),token=await encodePortableSetup(v);const bytes=Buffer.from(token.slice(4),'base64url');bytes[4]^=1;await assert.rejects(decodePortableSetup('tw2.'+bytes.toString('base64url')),/damaged/);
 for(const change of [x=>x.push('extra'),x=>x[1]='unsupported',x=>x[3].push([999,'secret']),x=>x[4][0][3]=0,x=>x[5][0].push(x[5][0][0])]){const x=structuredClone(v);change(x);assert.throws(()=>validatePortableSetup(x));}
 assert.throws(()=>tokenFromText('https://evil.example/?apiKey=secret'));await assert.rejects(decodePortableSetup('tw2.'+'A'.repeat(70000)));
});
test('decompression is bounded against tiny compressed oversized input',async()=>{
 const payload=Buffer.concat([Buffer.from([1,0,1]),deflateSync(Buffer.alloc(300000,65))]);const d=createHash('sha256').update(payload).digest().subarray(0,16);await assert.rejects(decodePortableSetup('tw2.'+Buffer.concat([payload,d]).toString('base64url')),/size limit/);
});
test('replacement affects exactly three portable keys and preserves destination controls',()=>{
 const destination=store({'torbox-parental-controls-v1':'DESTINATION_PIN','torbox-search-history-v1':'destination searches','torbox-source-memory-v1':'device codecs','tw-viewer':'viewer-2','arcade-state':'untouched','torbox-watchlist-v1':'stale'});writePortableState(stagedPortableState(collectPortableSetup(fixtureKey,sample())),destination);
 assert.equal(destination.getItem('torbox-parental-controls-v1'),'DESTINATION_PIN');assert.equal(destination.getItem('tw-viewer'),'viewer-2');assert.equal(destination.getItem('arcade-state'),'untouched');assert.equal(destination.getItem('torbox-source-memory-v1'),'device codecs');assert.equal(destination.getItem('torbox-search-history-v1'),'destination searches');const r=JSON.parse(destination.getItem('torbox-recent-v1'))[0];assert.equal(r.key,'series:tt0903747:1:2');assert.equal(r.position,543);assert.equal(r.metadataPending,true);
});
test('quota failure rolls back an exact replacement instead of leaving half a setup',()=>{
 const target=store({'torbox-settings-v1':'old-settings','torbox-recent-v1':'old-history','torbox-watchlist-v1':'old-list'}),original=target.dump(),set=target.setItem;let writes=0;target.setItem=(k,v)=>{if(++writes===2)throw new Error('quota');set(k,v);};assert.throws(()=>writePortableState(stagedPortableState(collectPortableSetup(fixtureKey,sample())),target),/restored/);assert.deepEqual(target.dump(),original);
});
test('animated frames accept duplicates and missed/out-of-order captures without mixing sessions',async()=>{
 const token=await encodePortableSetup(collectPortableSetup(fixtureKey,sample())),frames=await splitSetupFrames(token,50),collector=new SetupFrameCollector();assert.ok(frames.length>2);await collector.accept(frames.at(-1));await collector.accept(frames.at(-1));let result;for(const frame of frames)result=await collector.accept(frame);assert.equal(result.token,token);assert.equal(result.received,frames.length);
 const other=await splitSetupFrames(await encodePortableSetup(collectPortableSetup('different-fixture-key',sample())),50);await assert.rejects(collector.accept(other[0]),/different setup/);collector.reset();assert.equal((await collector.accept(other[0])).received,1);
});
test('metadata hydration retains real progress and removals made during network requests',async()=>{
 const target=store();writePortableState(stagedPortableState(collectPortableSetup(fixtureKey,sample())),target);let changes=0;
 await hydratePortableMetadata(async(type,id)=>{if(id==='tt0903747'){const r=JSON.parse(target.getItem('torbox-recent-v1'));r[0].position=777;target.setItem('torbox-recent-v1',JSON.stringify(r));const lists=JSON.parse(target.getItem('torbox-watchlist-v1'));lists['viewer-2']=[];target.setItem('torbox-watchlist-v1',JSON.stringify(lists));}return{id,type,name:'Restored '+id,poster:'',episodes:[{season:1,episode:2,name:'Episode two'}]};},target,()=>changes++);
 const r=JSON.parse(target.getItem('torbox-recent-v1'))[0];assert.equal(r.position,777);assert.equal(r.title,'Restored tt0903747');assert.equal(r.episodeName,'Episode two');assert.deepEqual(JSON.parse(target.getItem('torbox-watchlist-v1'))['viewer-2'],[]);assert.ok(changes>0);
});
function vendor(path){const context={module:{exports:{}},exports:{},Uint8Array,Uint8ClampedArray,ArrayBuffer,console};vm.runInNewContext(fs.readFileSync(new URL(path,import.meta.url),'utf8'),context);return context.module.exports;}
function raster(qr){const modules=qr.getModuleCount(),scale=5,width=(modules+8)*scale,data=new Uint8ClampedArray(width*width*4).fill(255);for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(qr.isDark(y,x))for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=(((y+4)*scale+dy)*width+(x+4)*scale+dx)*4;data[i]=data[i+1]=data[i+2]=0;}return{data,width};}
test('actual static QR encoder and decoder recover the entire import URL',async()=>{
 const qrcode=vendor('../public/vendor/qrcode.js'),jsQR=vendor('../public/vendor/jsqr.js');const token=await encodePortableSetup(collectPortableSetup(fixtureKey,sample())),url=makeSetupUrl(token,'https://to-shreds.github.io/torbox-web-player/'),qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();assert.ok(qr.getModuleCount()<=113);const {data,width}=raster(qr);const result=jsQR(data,width,width,{inversionAttempts:'dontInvert'});assert.equal(result?.data,url);assert.deepEqual(await decodePortableSetup(tokenFromText(result.data)),collectPortableSetup(fixtureKey,sample()));console.log('Single-QR fixture: '+token.length+' token characters; '+qr.getModuleCount()+' modules.');
});
test('maximum current list and history limits survive file and animated QR transfer with no truncation',async()=>{
 const v=collectPortableSetup(fixtureKey,sample());v[5]=[0,1].map(offset=>Array.from({length:100},(_,i)=>[i%2,String(100000000000+offset*1000+i*137)]));v[4]=Array.from({length:20},(_,i)=>[0,String(100000000000+i),0,0,100+i,6000,0,1800000000000-i]);const token=await encodePortableSetup(v),frames=await splitSetupFrames(token),collector=new SetupFrameCollector();let result;for(const f of [...frames].reverse())result=await collector.accept(f);const decoded=await decodePortableSetup(result.token);assert.deepEqual(decoded,v);assert.equal(portableSummary(decoded).myList,200);console.log('Maximum-limits fixture: '+token.length+' characters; '+frames.length+' animated frames.');
});

test('portable ordinary settings include optional user names and new non-parent preferences',()=>{
 const source=sample(),raw=JSON.parse(source.getItem('torbox-settings-v1'));Object.assign(raw,{viewer1Name:'Logan',viewer2Name:'Scarlett',rememberViewer:false,homeDensity:'compact',searchDelayMs:700,preferCachedSources:false});source.setItem('torbox-settings-v1',JSON.stringify(raw));
 const staged=stagedPortableState(collectPortableSetup(fixtureKey,source)),settings=JSON.parse(staged['torbox-settings-v1']);
 assert.equal(settings.viewer1Name,'Logan');assert.equal(settings.viewer2Name,'Scarlett');assert.equal(settings.rememberViewer,false);assert.equal(settings.homeDensity,'compact');assert.equal(settings.searchDelayMs,700);assert.equal(settings.preferCachedSources,false);
});

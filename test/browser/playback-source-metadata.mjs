// Real public metadata, synthetic torrent identities/account, and synthetic
// video bytes exercise the UI and backend without downloading any release.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { normalizeSources } from '../../public/source-client.js';
import { normalizeStremioStreams } from '../../lib/source-lookup.mjs';
import { startFixture } from './fixture.mjs';

const snapshot=JSON.parse(await readFile(new URL('../fixtures/dexter-resurrection-s01e02-sources.json',import.meta.url),'utf8'));
const rawSnapshot=JSON.parse(await readFile(new URL('../fixtures/dexter-resurrection-s01e02-streams.json',import.meta.url),'utf8'));
const media=await readFile(new URL('../fixtures/fixture.mp4',import.meta.url));
let browser,fixture;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});fixture=await startFixture(4203);});
after(async()=>{await browser?.close();await fixture?.close();});

async function pageFor(t,{sources=snapshot.sources}={}){
  Object.assign(fixture.control,{sessionDelay:0,statusDelay:0,progressDelay:0,creates:0,playbackCalls:0,mediaFetches:0});
  fixture.discovery.tickets.clear();fixture.discovery.operations.clear();
  let preparedItem=null;
  const byHash=new Map(normalizeSources(sources).map(source=>[source.hash,source]));
  fixture.discovery.catalog={search:async()=>({metas:[{...snapshot.meta,episodes:[]}],nextSkip:null,feed:'popular'}),meta:async(type,id)=>{assert.equal(type,snapshot.meta.type);assert.equal(id,snapshot.meta.id);return snapshot.meta;}};
  fixture.sourceLookup.lookup=async target=>({sources:target.episode===snapshot.target.episode?sources:[],complete:true});
  fixture.discovery.gateway={
    cached:async hashes=>Object.fromEntries(hashes.map(hash=>[hash,{cached:false,files:[]}])),
    find:async hash=>preparedItem?.hash===hash?preparedItem:null,
    create:async(hash,onlyCached)=>{assert.equal(onlyCached,false,'an uncached creation requires explicit Prepare & Play');const source=byHash.get(hash);assert.ok(source);assert.match(source.filename,/S01E02/i);fixture.control.creates++;preparedItem={id:1,hash,name:source.filename,download_finished:true,download_present:true,files:[{id:0,short_name:source.filename,mimetype:'video/mp4',size:media.length}]};return 1;},
    item:async id=>{assert.equal(id,1);assert.ok(preparedItem);return preparedItem;}
  };
  fixture.provider.resolveForRelay=async id=>{assert.ok(preparedItem);return{file:{id,title:preparedItem.files[0].short_name,state:'Ready to watch'},upstreamUrl:'https://store.tb-cdn.io/fixture.mp4?token=fixture-master-key'};};
  const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],preparedBodies=[],registered=[];
  page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/discover/prepare')preparedBodies.push(request.postDataJSON());});
  page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/discover/sources'&&response.status()===200)registered.push(await response.json());});
  await page.addInitScript(token=>{sessionStorage.setItem('torbox-web-session',token);window.__copiedPlaybackDetails=[];window.__denyClipboard=false;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(window.__denyClipboard)throw new Error('Clipboard denied');window.__copiedPlaybackDetails.push(text);}}});},fixture.session());
  await context.route('https://**/*',route=>route.abort());
  await context.route('**/media/*',async route=>{
    const redirect=await route.fetch({maxRedirects:0});assert.equal(redirect.status(),307);assert.equal((await redirect.body()).length,0);assert.equal(new URL(redirect.headers().location).hostname,'store.tb-cdn.io');
    const range=/bytes=(\d+)-(\d*)/.exec(route.request().headers().range||''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
    await route.fulfill({status:range?206:200,headers:{'Content-Type':'video/mp4','Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})},body:media.subarray(start,end+1)});
  });
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.equal(fixture.control.mediaFetches,0,'video bytes never traverse the app backend');});
  return{page,preparedBodies,registered,item:()=>preparedItem};
}

async function openEpisode(page){
  await page.goto(fixture.origin);await page.waitForSelector('#workspace:not([hidden])');await page.locator('#catalog-grid .poster-card').first().click();
  await page.locator('#episode-area .episode-actions button.primary').nth(1).click();await page.locator('#play-fallback [data-action="prepare-source"]').first().waitFor();
}

test('actual Dexter E2 source metadata produces choices and explicitly prepares the exact episode through the real backend',async t=>{
  const {page,preparedBodies,registered,item}=await pageFor(t);await openEpisode(page);
  const choices=page.locator('#play-fallback [data-action="prepare-source"]');assert.ok(await choices.count()>0);
  assert.equal(fixture.control.creates,0);assert.equal(preparedBodies.length,0,'uncached metadata never starts automatic preparation');
  assert.ok(registered.some(result=>result.target.id==='tt33043892'&&result.target.episode===2&&result.sources.length===40));
  const firstRow=page.locator('#play-fallback .play-fallback-row').first();assert.match(await firstRow.textContent(),/Language unconfirmed/);assert.doesNotMatch(await firstRow.locator('small').textContent(),/\.DUB\./i);
  await choices.first().click();await page.waitForFunction(()=>document.querySelector('#video-slot video')?.currentTime>0);
  assert.equal(fixture.control.creates,1);assert.equal(fixture.control.playbackCalls,1);assert.equal(preparedBodies.length,1);assert.equal(preparedBodies[0].onlyCached,false);
  assert.match(item().files[0].short_name,/S01E02/i);assert.match(await page.locator('#playing-title').textContent(),/S01E02/);
});

test('playback diagnostics copy only safe counts on demand and remain visible when clipboard access is denied',async t=>{
  const {page}=await pageFor(t);await openEpisode(page);
  assert.equal(await page.evaluate(()=>window.__copiedPlaybackDetails.length),0,'there is no automatic diagnostic collection');
  const copy=page.locator('#play-fallback [data-action="copy-playback-details"]');await copy.click();
  const text=await page.evaluate(()=>window.__copiedPlaybackDetails[0]),details=JSON.parse(text);
  assert.deepEqual(details.target,snapshot.target);assert.equal(details.sourceCount,40);assert.ok(details.eligibleCount>0);assert.match(details.appBuild,/^release-/);
  assert.equal(details.cacheAvailability,'checked');assert.equal(details.failureCode,'NO_CACHED_BROWSER_SOURCE');
  assert.equal(details.languageCounts.foreignOnly,3,'FRENCH and rus.LostFilm release tags identify dubs');assert.equal(details.languageCounts.unconfirmed,37);assert.doesNotMatch(text,/filename|https?:|token|api.?key|session|authorization|fixture-master-key/i);
  for(const source of snapshot.sources){assert.ok(!text.includes(source.hash));if(source.filename)assert.ok(!text.includes(source.filename));}
  await page.evaluate(()=>{window.__denyClipboard=true;});await copy.click();
  const visible=page.locator('#play-fallback details');assert.equal(await visible.isVisible(),true);assert.equal(await visible.evaluate(node=>node.open),true);assert.deepEqual(JSON.parse(await visible.locator('pre').textContent()),details);
});

test('actual raw source metadata offers attested AAC ahead of English unknown-audio MKV and excludes risky Dolby Vision',async t=>{
  const sources=normalizeStremioStreams(rawSnapshot,rawSnapshot.target,rawSnapshot.provider);
  const {page,registered,preparedBodies}=await pageFor(t,{sources});await openEpisode(page);
  const firstRow=page.locator('#play-fallback .play-fallback-row').first(),filename=await firstRow.locator('small').textContent();
  assert.match(filename,/S01E02/i);assert.match(filename,/\.mp4$/i);assert.match(await firstRow.textContent(),/Language unconfirmed/);
  const selected=registered.flatMap(result=>result.sources).find(source=>source.filename===filename);assert.ok(selected);
  assert.deepEqual(selected.languages,[]);assert.equal(selected.videoCodec,'H264');assert.equal(selected.containerStatus,'supported');assert.equal(selected.browserUnsupported,false);
  assert.ok(selected.audioCodecs.includes('AAC'),'the chosen filename must provide positive AAC evidence');
  assert.equal(selected.audioRisk,false);assert.equal(selected.videoRisk,false);
  const englishUnknown=registered.flatMap(result=>result.sources).find(source=>source.languages.includes('en')&&!source.audioCodecs.length&&!source.audioRisk&&!source.videoRisk);
  assert.ok(englishUnknown,'the test must include the previously preferred English source with unconfirmed audio');
  const dolby=registered.flatMap(result=>result.sources).find(source=>source.filename.includes('DV.P5'));
  if(dolby){assert.equal(dolby.videoRisk,true);assert.equal(dolby.audioRisk,true);}
  assert.equal(fixture.control.creates,0);assert.equal(preparedBodies.length,0,'this test verifies metadata eligibility without pretending to play the real release');
});

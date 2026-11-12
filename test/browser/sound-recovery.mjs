// Real Chromium decoding: several untagged versions decode silent (EAC3)
// before one with AAC. Release names follow the real patterns captured in
// test/fixtures/family-guy-sources.json, which almost never state audio.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixture } from './fixture.mjs';

const media = {
  eac3: { bytes: await readFile(new URL('../fixtures/h264-eac3.mkv', import.meta.url)), mime: 'video/x-matroska' },
  aac: { bytes: await readFile(new URL('../fixtures/h264-aac.mkv', import.meta.url)), mime: 'video/x-matroska' },
};
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: ['--mute-audio'] }); });
after(async () => { await browser?.close(); });

async function setup(t, versions) {
  const fixture = await startFixture(Number(process.env.SOUND_TEST_PORT) || 4235);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepares = [], slowDowns = [], played = [];
  const items = versions.map(([filename, kind, cached = true], index) => ({ id: index + 1, kind, cached, hash: (index + 1).toString(16).padStart(40, 'c'), name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: filename, mimetype: media[kind].mime, size: media[kind].bytes.length }] }));
  fixture.sourceLookup.lookup = async () => ({ complete: true, sources: items.map(item => ({ hash: item.hash, title: item.files[0].short_name, filename: item.files[0].short_name, resolution: /1080p/.test(item.files[0].short_name) ? '1080p' : '720p', videoCodec: 'H264', audioCodecs: item.cached===false&&item.kind==='aac'?['AAC']:[], size: item.files[0].size, provider: 'Synthetic real-name sound regression' })) });
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(hash => {
    const item = items.find(row => row.hash === hash);
    return [hash, { cached: item?.cached===true, files: item?.cached===true ? [{ name: item.files[0].short_name, size: item.files[0].size, mime: item.files[0].mimetype }] : [] }];
  }));
  fixture.provider.request = async (_path, params) => params?.id ? items.find(item => item.id === Number(params.id)) : items;
  fixture.provider.resolveForRelay = async id => {
    const item = items[Number(id.split(':')[1]) - 1]; played.push(item.files[0].short_name);
    return { file: { id, title: item.files[0].short_name, mime: item.files[0].mimetype, state: 'Ready to watch' }, upstreamUrl: `https://store.tb-cdn.io/${item.kind}?token=fixture-master-key` };
  };
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/discover/prepare') prepares.push(request.postDataJSON()); });
  page.on('response', response => { if (response.status() === 429) slowDowns.push(new URL(response.url()).pathname); });
  await page.addInitScript(token => {
    sessionStorage.setItem('torbox-web-session', token);
    localStorage.setItem('torbox-settings-v1', JSON.stringify({ autoNext: false, showPlaybackHealth: false, interfaceMode: 'simple' }));
  }, fixture.session());
  await context.route('https://**/*', route => route.abort());
  await context.route('**/media/*', async route => {
    const redirect = await route.fetch({ maxRedirects: 0 });
    const selected = media[new URL(redirect.headers().location).pathname.slice(1)], bytes = selected.bytes;
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': selected.mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
  });
  t.after(async () => {
    t.diagnostic(JSON.stringify({ played, prepares: prepares.length, playbackCalls: fixture.control.playbackCalls, slowDowns }));
    await context.close(); await fixture.close();
    assert.deepEqual(errors, []); assert.deepEqual(slowDowns, []);
    assert.equal(fixture.control.mediaFetches, 0); assert.equal(fixture.control.creates, 0);
    assert.ok(prepares.every(body => body.onlyCached === true));
  });
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
  return { page, fixture, played, prepares };
}
const videoState = page => page.evaluate(() => {
  const video = document.querySelector('#video-slot video');
  return { time: video?.currentTime, paused: video?.paused, audioBytes: video?.webkitAudioDecodedByteCount, title: document.querySelector('#playing-title').textContent, message: document.querySelector('#player-message').textContent, more: !document.querySelector('#player-more-versions').hidden, moreText: document.querySelector('#player-more-versions').textContent };
});

test('three silent untagged versions are checked by sound until a version with audio plays from the same position', async t => {
  const { page, fixture, played } = await setup(t, [
    ['Fixture.Show.S01E01.One.WEBRip.x264-AAA.mp4', 'eac3'],
    ['Fixture.Show.S01E01.One.WEBRip.x264-BBB.mp4', 'eac3'],
    ['Fixture.Show.S01E01.One.WEBRip.x264-CCC.mp4', 'eac3'],
    ['Fixture.Show.S01E01.One.720p.WEB.h264-DDD.mkv', 'aac'],
  ]);
  await page.waitForFunction(() => /checking version 2 for sound/i.test(document.querySelector('#player-message').textContent), null, { timeout: 30000 });
  const origin = (await page.evaluate(() => document.querySelector('#video-slot video')?.currentTime)) ?? 0;
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video?.webkitAudioDecodedByteCount > 0 && /DDD/.test(document.querySelector('#playing-title').textContent) && !video.paused; }, null, { timeout: 90000 });
  const recovered = await videoState(page);
  assert.equal(fixture.control.playbackCalls, 4, 'each silent version is replaced exactly once');
  assert.deepEqual(played.map(name => /-(\w{3})\./.exec(name)[1]), ['AAA', 'BBB', 'CCC', 'DDD']);
  assert.ok(recovered.time >= origin - 0.5, 'playback keeps the position where sound first failed');
  assert.ok(recovered.time < origin + 8, `three silent checks must not push the position forward (origin ${origin}, now ${recovered.time})`);
  assert.equal(recovered.more, false);
});

test('when every cached version is silent, the player reports what it checked and offers the rest instead of claiming none exist', async t => {
  const silent = [...['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG'].map(group => [`Fixture.Show.S01E01.One.WEBRip.x264-${group}.mp4`, 'eac3']),['Fixture.Show.S01E01.One.720p.H264.AAC-HHH.mkv','aac',false]];
  const { page, fixture } = await setup(t, silent);
  await page.waitForFunction(() => !document.querySelector('#player-more-versions').hidden, null, { timeout: 120000 });
  const first = await videoState(page);
  assert.match(first.message, /Checked 5 versions; none had sound this browser can play\. 2 more cached versions are available to check\./);
  assert.equal(first.moreText, 'Check more versions (2)');
  assert.equal(first.paused, true);
  assert.equal(fixture.control.playbackCalls, 5);
  await page.locator('#player-more-versions').click();
  await page.waitForFunction(() => /Checked 7 versions/.test(document.querySelector('#player-message').textContent), null, { timeout: 90000 });
  const done = await videoState(page);
  assert.match(done.message, /Checked 7 versions; none had sound this browser can play\. No more cached versions remain\./);
  assert.equal(done.more, true);
  assert.equal(done.moreText, 'Find other versions');
  assert.equal(fixture.control.playbackCalls, 7);
  assert.equal(fixture.control.creates,0,'automatic audio recovery must never add torrents');
  await page.locator('#player-more-versions').click();
  await page.locator('#source-dialog').waitFor({state:'visible'});
  assert.match(await page.locator('#source-options').textContent(),/AAC-HHH/);
  assert.equal(await page.locator('#source-options .recommended button').first().textContent(),'Prepare');
  assert.equal(await page.getByRole('button',{name:'Refresh results'}).isVisible(),true);
  assert.equal(fixture.control.creates,0,'an uncached file must not prepare before explicit selection');
  await page.locator('#close-source').click();
  assert.equal(await page.locator('#player').evaluate(dialog=>dialog.open),true);
});


test('Options switches rejected cached versions repeatedly, keeps position, and remembers avoided copies', async t => {
  const releases=['AAA','BBB','CCC','DDD','EEE'].map(group => [`Fixture.Show.S01E01.One.720p.H264.AAC-${group}.mkv`, 'aac']);
  const { page, fixture, played, prepares } = await setup(t, releases);
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 0.5);
  const position = await page.evaluate(() => document.querySelector('#video-slot video').currentTime);
  assert.equal(await page.locator('#player-version-menu').isHidden(),true);
  for(let index=1;index<releases.length;index++){
    const expected=releases[index][0];
    // Switching is deliberately unavailable while the previous source's
    // metadata/seek is still settling. Capture its actual settled position.
    await page.locator('#player-version-toggle').waitFor({state:'visible'});
    await page.waitForFunction(() => {
      const video=document.querySelector('#video-slot video');
      return video?.readyState>=1 && !video.seeking && !document.querySelector('#player-version-toggle').disabled;
    });
    const before=await page.locator('#video-slot video').evaluate(video=>video.currentTime);
    await page.locator('#player-version-toggle').click();
    assert.equal(await page.locator('#player-version-menu').isVisible(),true);
    assert.equal(await page.locator('#player-version-avoid').isChecked(),true);
    await page.locator('#player-new-version').click();
    await page.waitForFunction(name => {
      const video=document.querySelector('#video-slot video');
      const toggle=document.querySelector('#player-version-toggle');
      return document.querySelector('#playing-title')?.textContent.includes(name)
        && video?.readyState>=1 && !video.seeking && !toggle.disabled && video.currentTime>0;
    },expected,{timeout:45000});
    const after=await page.locator('#video-slot video').evaluate(video=>({time:video.currentTime,duration:video.duration}));
    const expectedResume=Math.min(before,Math.max(0,after.duration-.25));
    assert.ok(after.time>=expectedResume-.35,
      `version ${index+1}: resumed at ${after.time.toFixed(2)}s, expected approximately ${expectedResume.toFixed(2)}s`);
    assert.equal(await page.locator('#player-version-menu').isHidden(),true);
  }
  const state=await page.evaluate(() => ({
    time:document.querySelector('#video-slot video').currentTime,
    duration:document.querySelector('#video-slot video').duration,
    sources:Object.values(JSON.parse(localStorage.getItem('torbox-source-memory-v1')||'{}').titles?.['series:tt1234567']?.sources||{})
  }));
  assert.equal(fixture.control.playbackCalls,5,'explicit taps can check beyond the three-source automatic cap');
  assert.equal(played.length,5,'each tap changes to a distinct source');
  assert.equal(new Set(played).size,5);
  assert.ok(state.time>=Math.min(position,Math.max(0,state.duration-.25))-.5,'the new copy should not restart from zero');
  assert.ok(state.time<position+12,'source changes do not lose significant playback progress');
  assert.equal(state.sources.filter(row=>row.bad===true).length,4,'only rejected versions were avoided');
  assert.ok(prepares.every(body=>body.onlyCached===true));
  assert.equal(fixture.control.creates,0);
});

test('failed New version search keeps the current cached copy and does not block it', async t => {
  const { page, fixture } = await setup(t, [['Fixture.Show.S01E01.One.720p.H264.AAC-ONLY.mkv','aac']]);
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 0.5);
  await page.locator('#video-slot video').evaluate(video=>video.pause());
  await page.locator('#player-version-toggle').click();
  await page.locator('#player-new-version').click();
  await page.waitForFunction(() => /No other cached version could be opened/.test(document.querySelector('#player-message')?.textContent||''),null,{timeout:35000});
  assert.equal(fixture.control.playbackCalls,1);
  assert.equal(await page.locator('#video-slot video').evaluate(video=>video.paused),true);
  const blocked=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('torbox-source-memory-v1')||'{}').titles?.['series:tt1234567']?.sources||{}).some(row=>row.bad===true));
  assert.equal(blocked,false,'the original stream remains eligible for future playback');
  assert.equal(await page.locator('#player-version-toggle').isEnabled(),true);
});

test('Options sits beside PiP, never covers the picture, and opening the menu does not interrupt playback', async t => {
  const { page, fixture } = await setup(t, [['Fixture.Show.S01E01.One.720p.H264.AAC-GOOD.mkv','aac']]);
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 0.5);
  const position=await page.locator('#video-slot video').evaluate(video=>video.currentTime);
  const layout=await page.evaluate(() => {
    const toggle=document.querySelector('#player-version-toggle'),pip=document.querySelector('#toggle-pip');
    const shell=document.querySelector('#player-media-shell'),menu=document.querySelector('#player-version-menu');
    return {
      inToolbar:toggle.parentElement.classList.contains('player-presentation-bar'),
      inMedia:shell.contains(toggle)||shell.contains(menu),
      sameRow:Math.abs(toggle.getBoundingClientRect().top-pip.getBoundingClientRect().top)<2
    };
  });
  assert.equal(layout.inToolbar,true,'Options belongs with the display/PiP controls');
  assert.equal(layout.inMedia,false,'neither the button nor its menu belongs over the video');
  assert.equal(layout.sameRow,true,'Options should share a row with PiP on phone-sized screens');
  await page.locator('#player-version-toggle').click();
  assert.equal(await page.locator('#player-version-menu').isVisible(),true);
  const belowToolbar=await page.evaluate(()=>{
    const menu=document.querySelector('#player-version-menu').getBoundingClientRect();
    const shell=document.querySelector('#player-media-shell').getBoundingClientRect();
    return {menuBottom:menu.bottom,videoTop:shell.top,menuPosition:getComputedStyle(document.querySelector('#player-version-menu')).position};
  });
  assert.ok(belowToolbar.menuBottom<=belowToolbar.videoTop+1,
    'expanded menu must stay above the video, not overlay it');
  assert.notEqual(belowToolbar.menuPosition,'absolute','menu should be in normal page flow');
  await page.locator('#player-version-toggle').click();
  assert.equal(await page.locator('#player-version-menu').isHidden(),true);
  assert.equal(fixture.control.playbackCalls,1,'opening options never changes source');
  assert.equal(await page.locator('#video-slot video').evaluate(video=>video.paused),false);
  assert.ok(await page.locator('#video-slot video').evaluate(video=>video.currentTime)>=position-.35);
});

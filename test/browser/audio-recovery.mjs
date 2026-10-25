// Real native decoding exercises the silent-video failure, not mocked media events.
// Original synthetic fixture provenance: docs/evidence/audio-recovery/fixture-provenance.json.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { startFixture } from './fixture.mjs';

const media = {
  eac3: { bytes: await readFile(new URL('../fixtures/h264-eac3.mkv', import.meta.url)), mime: 'video/x-matroska', suffix: 'H264.mkv' },
  aac: { bytes: await readFile(new URL('../fixtures/fixture.mp4', import.meta.url)), mime: 'video/mp4', suffix: 'H264.AAC.mp4' },
  intro: { bytes: await readFile(new URL('../fixtures/h264-aac-silent-intro.mp4', import.meta.url)), mime: 'video/mp4', suffix: 'H264.AAC.mp4' },
};
const results = [], mediaRequests = [];
let browser, mediaServer, mediaOrigin;
before(async () => {
  mediaServer = createServer((request, response) => {
    mediaRequests.push({ pathname: request.url.split('?')[0], range: request.headers.range || null });
    const selected = media[request.url.slice(1)];
    if (!selected) { response.writeHead(404); response.end(); return; }
    const bytes = selected.bytes, range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    // Deliberately no CORS header: direct native playback must not require it.
    response.writeHead(range ? 206 : 200, { 'Content-Type': selected.mime, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  });
  await new Promise(resolve => mediaServer.listen(0, '127.0.0.1', resolve));
  mediaOrigin = `http://127.0.0.1:${mediaServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], ignoreDefaultArgs: ['--mute-audio'] });
});
after(async () => {
  const report = { browser: browser ? await browser.version() : null, cases: results, limitations: 'Synthetic original media through the real application and backend with a browser CDN route. No real account, episode media, physical Android decoder or speaker-output acceptance.' };
  await browser?.close();
  await new Promise(resolve => mediaServer.close(resolve));
  if (process.env.AUDIO_RECOVERY_EVIDENCE_PATH) {
    await mkdir(dirname(process.env.AUDIO_RECOVERY_EVIDENCE_PATH), { recursive: true });
    await writeFile(process.env.AUDIO_RECOVERY_EVIDENCE_PATH, JSON.stringify(report, null, 2) + '\n');
  }
});

async function setup(t, {
  main = 'eac3', alternative = true, initialAlternative = false,
  mainResolution = '720p', alternativeResolution = '720p', resolution = 'auto',
  incompleteFirstBatch = false, holdComplete = false, waitForPlayback = true,
  requirePreparation = true, missingCounter = false, holdRecovery = false,
  crossOrigin = false, sourceMemory = null,
} = {}) {
  const fixture = await startFixture(Number(process.env.AUDIO_TEST_PORT) || 4215);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepares = [], redirects = [], observations = [];
  const firstMediaRequest = mediaRequests.length;
  if (crossOrigin) {
    // This test substitutes a loopback server for the public CDN. New Chromium
    // requires local-network permission when an intercepted redirect reaches
    // that server. Scope the permission to this disposable fixture origin;
    // production media still uses the unchanged public-CDN policy.
    await context.grantPermissions(['local-network-access'], { origin: fixture.origin });
    page.on('console', message => {
      if (/security policy|cors|blocked|local network|access.*denied/i.test(message.text())) observations.push({ browserConsole: message.text().replace(/https?:\/\/[^\s"']+/g, value => { try { const url = new URL(value); return url.origin + (url.pathname.startsWith('/media/') ? '/media/[redacted]' : url.pathname); } catch { return '[url]'; } }).slice(0, 1500) });
    });
    page.on('requestfailed', request => {
      if (request.resourceType() === 'media') { const url = new URL(request.url()); observations.push({ mediaRequestFailure: { origin: url.origin, pathname: url.pathname.startsWith('/media/') ? '/media/[redacted]' : url.pathname, failure: request.failure()?.errorText } }); }
    });
    const cdp = await context.newCDPSession(page); await cdp.send('Media.enable');
    cdp.on('Media.playerPropertiesChanged', event => {
      for (const property of event.properties) if (['kAudioTracks', 'kAudioDecoderName'].includes(property.name)) observations.push({ mediaDiagnostic: property });
    });
  }
  const controls = { started: false, recoveryRequested: false, releaseRecovery: null, completeRequested: false, releaseComplete: null, lookups: [] };
  const recoveryGate = holdRecovery ? new Promise(resolve => { controls.releaseRecovery = resolve; }) : Promise.resolve();
  const completeGate = holdComplete ? new Promise(resolve => { controls.releaseComplete = resolve; }) : Promise.resolve();
  const items = [main, 'aac'].map((kind, index) => {
    const hash = String.fromCharCode(97 + index).repeat(40), selected = media[kind];
    const itemResolution = index ? alternativeResolution : mainResolution;
    const filename = `Fixture.Show.S01E01.One.${itemResolution}.${selected.suffix}`;
    return { id: index + 1, hash, kind, resolution: itemResolution, name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: filename, mimetype: selected.mime, size: selected.bytes.length }] };
  });
  fixture.sourceLookup.lookup = async (_target, options = {}) => {
    fixture.control.lookupCalls++;
    controls.lookups.push({ fast: options.fast === true, complete: options.complete === true });
    if (controls.started) { controls.recoveryRequested = true; await recoveryGate; }
    if (incompleteFirstBatch && options.complete) { controls.completeRequested = true; await completeGate; }
    const complete = !incompleteFirstBatch || options.complete === true;
    const includeAlternative = alternative && (incompleteFirstBatch ? complete : initialAlternative || controls.started);
    const rows = includeAlternative ? items : items.slice(0, 1);
    return { complete, sources: rows.map(item => ({ hash: item.hash, title: item.files[0].short_name, filename: item.files[0].short_name, resolution: item.resolution, videoCodec: 'H264', audioCodecs: item.kind === 'eac3' ? [] : ['AAC'], size: item.files[0].size, provider: 'Synthetic audio regression' })) };
  };
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(hash => {
    const item = items.find(row => row.hash === hash);
    return [hash, { cached: Boolean(item), files: item ? [{ name: item.files[0].short_name, size: item.files[0].size, mime: item.files[0].mimetype }] : [] }];
  }));
  fixture.provider.request = async (path, params) => params?.id ? items.find(item => item.id === Number(params.id)) : items;
  fixture.provider.resolveForRelay = async id => {
    const item = items[Number(id.split(':')[1]) - 1];
    return { file: { id, title: item.files[0].short_name, mime: item.files[0].mimetype, state: 'Ready to watch' }, upstreamUrl: `https://store.tb-cdn.io/${item.kind}?token=fixture-master-key` };
  };
  page.setDefaultTimeout(16000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/discover/prepare') prepares.push(request.postDataJSON()); });
  await page.addInitScript(({ token, missingCounter, sourceMemory, resolution }) => {
    sessionStorage.setItem('torbox-web-session', token);
    if (sourceMemory) localStorage.setItem('torbox-source-memory-v1', JSON.stringify(sourceMemory));
    localStorage.setItem('torbox-settings-v1', JSON.stringify({ autoNext: false, showPlaybackHealth: false, interfaceMode: 'simple', resolution }));
    if (missingCounter) Object.defineProperty(HTMLMediaElement.prototype, 'webkitAudioDecodedByteCount', { configurable: true, get: () => undefined });
    window.__audioObservations = [];
    document.addEventListener('loadedmetadata', event => {
      if (event.target instanceof HTMLVideoElement) window.__audioObservations.push({ event: 'loadedmetadata', time: event.target.currentTime });
    }, true);
    document.addEventListener('seeked', event => {
      if (event.target instanceof HTMLVideoElement) window.__audioObservations.push({ event: 'seeked', time: event.target.currentTime });
    }, true);
  }, { token: fixture.session(), missingCounter, sourceMemory, resolution });
  await context.route('https://**/*', route => route.abort());
  if (crossOrigin) await context.route(fixture.origin + '/', async route => {
    const response = await route.fetch();
    // The local CDN origin substitutes for an allowed production CDN host.
    // Extend only the fixture document policy with that one local origin.
    const html = (await response.text()).replace("media-src 'self'", `media-src 'self' ${mediaOrigin}`);
    await route.fulfill({ response, body: html });
  });
  await context.route('**/media/*', async route => {
    const redirect = await route.fetch({ maxRedirects: 0 });
    assert.equal(redirect.status(), 307); assert.equal((await redirect.body()).length, 0);
    const location = new URL(redirect.headers().location);
    assert.equal(location.hostname, 'store.tb-cdn.io');
    const selected = media[location.pathname.slice(1)], bytes = selected.bytes;
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    redirects.push({ status: 307, bodyBytes: 0, kind: location.pathname.slice(1), crossOrigin, corsHeaders: !crossOrigin });
    if (crossOrigin) {
      // Inspect the production empty TorBox redirect, then map the synthetic
      // CDN to a separate real HTTP origin. The browser follows this empty
      // redirect and consumes media without CORS or response interception.
      await route.fulfill({ status: 307, headers: { Location: mediaOrigin + location.pathname }, body: '' });
      return;
    }
    await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': selected.mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
  });
  t.after(async () => {
    controls.releaseRecovery?.();
    controls.releaseComplete?.();
    if (!page.isClosed()) {
      observations.push(...await page.evaluate(() => window.__audioObservations));
      if (crossOrigin) observations.push({ finalMediaState: await page.locator('#video-slot video').evaluate(video => ({ readyState: video.readyState, networkState: video.networkState, error: video.error && { code: video.error.code, message: video.error.message }, paused: video.paused, currentTime: video.currentTime })).catch(() => null) });
    }
    const row = { name: t.name, browser: await browser.version(), requests: { playback: fixture.control.playbackCalls, prepare: prepares.length, onlyCached: prepares.every(body => body.onlyCached === true), newTorrents: fixture.control.creates, serverMediaFetches: fixture.control.mediaFetches }, lookups: controls.lookups, redirects, cdnRequests: mediaRequests.slice(firstMediaRequest), observations };
    results.push(row); t.diagnostic(JSON.stringify(row));
    await context.close(); await fixture.close();
    assert.deepEqual(errors, []); assert.equal(fixture.control.mediaFetches, 0); assert.equal(fixture.control.creates, 0);
    if (requirePreparation) assert.ok(prepares.length);
    assert.ok(prepares.every(body => body.onlyCached === true));
  });
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
  if (waitForPlayback) { await playing(page); controls.started = true; }
  return { page, fixture, controls, observations, redirects, prepares };
}

async function playing(page) {
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video && video.currentTime > 0.2 && video.webkitDecodedFrameCount > 0 && !video.paused; });
}

async function state(page) {
  return page.evaluate(() => {
    const video = document.querySelector('#video-slot video');
    return { time: video?.currentTime, paused: video?.paused, audioBytes: video?.webkitAudioDecodedByteCount, videoFrames: video?.webkitDecodedFrameCount, error: video?.error?.code || null, title: document.querySelector('#playing-title').textContent, message: document.querySelector('#player-message').textContent, health: document.querySelector('#health-state').textContent, memory: JSON.parse(localStorage.getItem('torbox-source-memory-v1') || '{"titles":{}}') };
  });
}
async function audioPeak(page) {
  return page.locator('#video-slot video').evaluate(async video => {
    if (!window.__audioGraph) {
      const audioContext = new AudioContext(), source = audioContext.createMediaElementSource(video), analyser = audioContext.createAnalyser();
      source.connect(analyser); analyser.connect(audioContext.destination); await audioContext.resume();
      window.__audioGraph = { audioContext, analyser };
    }
    const { analyser } = window.__audioGraph, samples = new Float32Array(analyser.fftSize); let peak = 0;
    for (let i = 0; i < 15; i++) { analyser.getFloatTimeDomainData(samples); peak = Math.max(peak, ...samples.map(Math.abs)); await new Promise(resolve => setTimeout(resolve, 20)); }
    return peak;
  });
}

test('cross-origin EAC3 video automatically recovers to cached AAC decoding and keeps the current position without CORS', async t => {
  const { page, fixture, observations } = await setup(t, { crossOrigin: true });
  const silent = await state(page); observations.push({ silent });
  assert.ok(silent.videoFrames > 0); assert.equal(silent.audioBytes, 0); assert.equal(silent.error, null);
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video?.webkitAudioDecodedByteCount > 0 && document.querySelector('#playing-title').textContent.includes('AAC'); });
  const recovered = await state(page); observations.push({ recovered });
  assert.equal(fixture.control.playbackCalls, 2); assert.ok(recovered.time >= 4.5, 'switch must keep the elapsed position'); assert.ok(recovered.audioBytes > 0);
  const old = recovered.memory.titles['series:tt1234567']?.sources['a'.repeat(40)];
  assert.equal(old?.successes || 0, 0, 'silent video must not become a learned success');
});

test('audio exhaustion pauses silent video and leaves a visible recovery action without a retry loop', async t => {
  const { page, fixture, observations } = await setup(t, { alternative: false });
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video?.paused && /No cached version with compatible audio was found/i.test(document.querySelector('#player-message').textContent); });
  const failed = await state(page); observations.push({ failed });
  assert.equal(fixture.control.playbackCalls, 1); assert.equal(failed.audioBytes, 0);
  assert.equal(await page.getByRole('button', { name: /^No sound$/ }).count(), 0);
  assert.equal(await page.locator('#playback-health').isVisible(), false);
  await page.waitForTimeout(700); assert.equal(fixture.control.playbackCalls, 1);
  assert.equal(failed.memory.titles['series:tt1234567']?.sources['a'.repeat(40)]?.successes || 0, 0);
});

test('a real AAC track with an eight-second silent introduction is not rejected for quiet PCM', async t => {
  const { page, fixture, observations } = await setup(t, { main: 'intro' });
  assert.ok((await state(page)).audioBytes > 0);
  const introPeak = await audioPeak(page); assert.equal(introPeak, 0, 'fixture actually begins with silent decoded audio');
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 9);
  const audiblePeak = await audioPeak(page), current = await state(page); observations.push({ introPeak, audiblePeak, current });
  assert.ok(audiblePeak > 0.0001); assert.equal(fixture.control.playbackCalls, 1); assert.equal(current.paused, false);
});

for (const resolution of ['auto', '720p']) test(`${resolution} selection starts known 1080p AAC before unknown-audio 720p video`, async t => {
  const { page, fixture, observations, redirects } = await setup(t, { initialAlternative: true, alternativeResolution: '1080p', resolution });
  const current = await state(page); observations.push({ resolution, current });
  assert.match(current.title, /1080p\.H264\.AAC/, 'the requested quality must not put unconfirmed sound before compatible audio');
  assert.ok(current.audioBytes > 0, 'the selected AAC fixture must actually decode audio');
  assert.equal(current.paused, false);
  assert.equal(fixture.control.playbackCalls, 1, 'selection must start the compatible source directly');
  assert.ok(redirects.length > 0);
  assert.ok(redirects.every(row => row.kind === 'aac'), 'unknown-audio EAC3 must not receive a media request before the available AAC version');
});

test('an incomplete fast unknown-audio batch waits for the completed AAC result before any media request', async t => {
  const { page, fixture, controls, observations, redirects } = await setup(t, { incompleteFirstBatch: true, holdComplete: true, waitForPlayback: false });
  const deadline = Date.now() + 3000;
  while (!controls.completeRequested && Date.now() < deadline) await page.waitForTimeout(40);
  assert.equal(controls.completeRequested, true, 'a playable picture in an incomplete batch must not stop the full audio-compatible search');
  assert.ok(controls.lookups.some(row => row.fast));
  assert.equal(fixture.control.playbackCalls, 0);
  assert.deepEqual(redirects, []);
  await page.waitForTimeout(400);
  assert.equal(fixture.control.playbackCalls, 0, 'playback must stay pending while the complete result is held');
  controls.releaseComplete();
  await playing(page); controls.started = true;
  const current = await state(page); observations.push({ current });
  assert.match(current.title, /H264\.AAC/); assert.ok(current.audioBytes > 0);
  assert.equal(fixture.control.playbackCalls, 1);
  assert.ok(redirects.length > 0);
  assert.ok(redirects.every(row => row.kind === 'aac'), 'the earlier unknown-audio source must never be opened');
});

test('a browser without a decode counter selects available AAC and does not invent learned audio success', async t => {
  const { page, fixture, observations, redirects } = await setup(t, { missingCounter: true, initialAlternative: true, alternativeResolution: '1080p', resolution: '720p' });
  const audiblePeak = await audioPeak(page);
  assert.ok(audiblePeak > 0.0001, 'the counterless browser must play the real audible AAC fixture');
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 16.1, undefined, { timeout: 20000 });
  const current = await state(page); observations.push({ audiblePeak, current });
  assert.equal(current.audioBytes, undefined); assert.equal(current.paused, false); assert.equal(fixture.control.playbackCalls, 1);
  assert.match(current.title, /1080p\.H264\.AAC/);
  assert.ok(redirects.length > 0); assert.ok(redirects.every(row => row.kind === 'aac'));
  assert.equal(current.memory.titles['series:tt1234567']?.sources['a'.repeat(40)]?.successes || 0, 0);
  assert.equal(current.memory.titles['series:tt1234567']?.sources['b'.repeat(40)]?.successes || 0, 0, 'metadata confidence alone must not become observed sound confirmation');
});

test('a browser without a decode counter does not automatically start an unknown-audio-only result', async t => {
  const { page, fixture, observations, redirects } = await setup(t, { missingCounter: true, alternative: false, waitForPlayback: false, requirePreparation: false });
  await page.locator('#play-fallback .play-fallback-panel').waitFor();
  await page.waitForTimeout(700);
  const current = await state(page); observations.push({ current });
  assert.equal(fixture.control.playbackCalls, 0, 'there is no runtime decoder safeguard to justify silently opening this unknown source');
  assert.deepEqual(redirects, [], 'no movie bytes may be requested automatically');
  assert.equal(await page.locator('#video-slot video').count(), 0);
  assert.equal(await page.getByRole('button', { name: /^No sound$/, includeHidden: true }).count(), 0);
  assert.equal(current.memory.titles['series:tt1234567']?.sources['a'.repeat(40)]?.successes || 0, 0);
});

test('working AAC has no one-click No sound action in simple, fullscreen or full interface and keeps playing', async t => {
  const { page, fixture, observations } = await setup(t, { main: 'aac' });
  const assertNoSoundAction = async () => {
    assert.equal(await page.getByRole('button', { name: /^No sound$/, includeHidden: true }).count(), 0);
    assert.equal(await page.locator('#player-sound-bad, #fullscreen-sound-bad, #health-sound-bad').count(), 0);
  };
  await assertNoSoundAction();
  await page.locator('#toggle-fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player-media-shell');
  await page.locator('#player-media-shell').dispatchEvent('pointerdown');
  await assertNoSoundAction();
  assert.equal(await page.locator('#fullscreen-exit-overlay').isVisible(), true);
  await page.locator('#fullscreen-exit-overlay').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => {
    document.body.classList.remove('mode-simple');
    document.body.classList.add('mode-full');
    document.querySelector('#playback-health').hidden = false;
  });
  await assertNoSoundAction();
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 16.1, undefined, { timeout: 20000 });
  const current = await state(page); observations.push({ current });
  assert.ok(current.audioBytes > 0); assert.equal(current.paused, false);
  assert.equal(fixture.control.playbackCalls, 1);
  assert.equal(current.memory.titles['series:tt1234567']?.sources['a'.repeat(40)]?.audio === 'bad', false);
  assert.equal(current.memory.titles['series:tt1234567']?.sources['a'.repeat(40)]?.bad || false, false);
});

test('closing the player while audio recovery lookup is pending cancels the obsolete source switch', async t => {
  const { page, fixture, controls, observations } = await setup(t, { holdRecovery: true });
  const deadline = Date.now() + 13000;
  while (!controls.recoveryRequested && Date.now() < deadline) await page.waitForTimeout(50);
  assert.equal(controls.recoveryRequested, true, 'native silent playback must actually begin recovery');
  observations.push({ beforeClose: await state(page) });
  await page.locator('#close-player').click(); controls.releaseRecovery();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#player').isVisible(), false); assert.equal(fixture.control.playbackCalls, 1);
  assert.equal(await page.locator('#video-slot video').count(), 0);
});

test('opening the update restores an AAC version rejected by the removed button and preserves other feedback', async t => {
  const blocked = { hash: 'a'.repeat(40), audio: 'bad', bad: true, successes: 2, updatedAt: 1792113186242 };
  const keepBlocked = { hash: 'c'.repeat(40), bad: true, audio: 'unknown', successes: 0 };
  const keepGood = { hash: 'd'.repeat(40), bad: false, audio: 'good', successes: 4 };
  const sourceMemory = { titles: { 'series:tt1234567': { quality: '720p', sources: { ['a'.repeat(40)]: blocked, ['c'.repeat(40)]: keepBlocked, ['d'.repeat(40)]: keepGood } } } };
  const { page, fixture, observations } = await setup(t, { main: 'aac', sourceMemory });
  const current = await state(page); observations.push({ current });
  assert.ok(current.audioBytes > 0); assert.equal(current.paused, false); assert.equal(fixture.control.playbackCalls, 1);
  const row = current.memory.titles['series:tt1234567'];
  assert.equal(row.quality, '720p');
  assert.deepEqual(row.sources['a'.repeat(40)], { ...blocked, audio: 'unknown', bad: false });
  assert.deepEqual(row.sources['c'.repeat(40)], keepBlocked);
  assert.deepEqual(row.sources['d'.repeat(40)], keepGood);
  assert.deepEqual(current.memory.retiredAudioFeedback['series:tt1234567']['a'.repeat(40)], blocked);
  assert.equal(current.memory.negativeAudioReset, 1);
});

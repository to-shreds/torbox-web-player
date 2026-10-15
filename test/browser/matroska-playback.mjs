// Real native playback of a synthetic H264/AAC MKV through the complete app UI.
// Fixture provenance/reproduction: docs/evidence/playback-source-correction/matroska-probe.mjs.
// The committed media fixture avoids requiring FFmpeg during CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { startFixture } from './fixture.mjs';

const media = await readFile(new URL('../fixtures/h264-aac.mkv', import.meta.url));
const filename = 'Fixture.Show.S01E01.One.720p.H264.AAC.mkv';
const hash = 'a'.repeat(40);

test('cached H264/AAC Matroska automatically plays native video and audio, seeks, and never relays video through the app', async t => {
  const started = performance.now();
  const fixture = await startFixture(4204);
  const item = { id: 1, hash, name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: filename, mimetype: 'video/x-matroska', size: media.length }] };
  fixture.sourceLookup.lookup = async () => {
    fixture.control.lookupCalls++;
    return { complete: true, sources: [{ hash, title: filename, filename, resolution: '720p', videoCodec: 'H264', audioCodecs: ['AAC'], size: media.length, provider: 'Synthetic Matroska fixture' }] };
  };
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(value => [value, { cached: value === hash, files: value === hash ? [{ name: filename, size: media.length, mime: 'video/x-matroska' }] : [] }]));
  fixture.provider.request = async (path, params) => params?.id ? item : [item];
  fixture.provider.resolveForRelay = async id => ({ file: { id, title: filename, mime: 'video/x-matroska', state: 'Ready to watch' }, upstreamUrl: 'https://store.tb-cdn.io/fixture.mkv?token=fixture-master-key' });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepareBodies = [], redirects = [];
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/discover/prepare') prepareBodies.push(request.postDataJSON()); });
  await page.addInitScript(token => {
    sessionStorage.setItem('torbox-web-session', token);
    localStorage.setItem('torbox-settings-v1', JSON.stringify({ autoNext: false }));
  }, fixture.session());
  await context.route('https://**/*', route => route.abort());
  // Playwright redirects do not support a second route interception. Inspect
  // the real app's empty CDN redirect, then stand in for the CDN at this route.
  // The application server does not receive or transmit these synthetic bytes.
  await context.route('**/media/*', async route => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = new URL(response.headers().location), body = await response.body();
    assert.equal(response.status(), 307); assert.equal(body.length, 0);
    assert.equal(location.hostname, 'store.tb-cdn.io'); assert.equal(location.pathname, '/fixture.mkv');
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    redirects.push({ status: response.status(), bodyBytes: body.length, hostname: location.hostname, pathname: location.pathname, range: route.request().headers().range || null });
    await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video && video.currentTime > 0.2 && video.webkitDecodedFrameCount > 0 && !video.paused; });
  const decoded = await page.locator('#video-slot video').evaluate(async video => {
    const audioContext = new AudioContext(), source = audioContext.createMediaElementSource(video), analyser = audioContext.createAnalyser();
    source.connect(analyser); analyser.connect(audioContext.destination); await audioContext.resume();
    const samples = new Float32Array(analyser.fftSize); let peak = 0;
    for (let i = 0; i < 20; i++) { analyser.getFloatTimeDomainData(samples); peak = Math.max(peak, ...samples.map(Math.abs)); await new Promise(resolve => setTimeout(resolve, 25)); }
    const result = { currentTime: video.currentTime, duration: video.duration, decodedVideoFrames: video.webkitDecodedFrameCount, decodedAudioBytes: video.webkitAudioDecodedByteCount, audioPeak: peak, error: video.error && { code: video.error.code, message: video.error.message } };
    // Keep the analysis graph alive through seeking. Closing an attached media
    // element's AudioContext stops its audio clock in this Chromium build.
    window.__matroskaProbeAudioContext = audioContext; return result;
  });
  assert.ok(decoded.decodedVideoFrames > 0); assert.ok(decoded.decodedAudioBytes > 0); assert.ok(decoded.audioPeak > 0.0001, 'the actual AAC audio track must decode to nonzero PCM'); assert.equal(decoded.error, null);
  await page.locator('#video-slot video').evaluate(video => { video.currentTime = 6; });
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video && !video.seeking && !video.paused && video.currentTime > 6.4 && video.currentTime < 10 && !video.error; });
  const afterSeek = await page.locator('#video-slot video').evaluate(video => ({ currentTime: video.currentTime, decodedVideoFrames: video.webkitDecodedFrameCount, decodedAudioBytes: video.webkitAudioDecodedByteCount, paused: video.paused, seeking: video.seeking }));
  await page.evaluate(() => window.__matroskaProbeAudioContext.close());
  assert.ok(afterSeek.decodedVideoFrames > decoded.decodedVideoFrames);
  assert.match(await page.locator('#playing-title').textContent(), /S01E01/);
  assert.ok(await page.locator('#title-dialog').isHidden());
  assert.equal(await page.locator('#play-fallback').textContent(), '');
  assert.ok(prepareBodies.length > 0); assert.ok(prepareBodies.every(body => body.onlyCached === true));
  assert.equal(fixture.control.playbackCalls, 1); assert.equal(fixture.control.creates, 0); assert.equal(fixture.control.mediaFetches, 0); assert.ok(redirects.length > 0); assert.deepEqual(errors, []);
  const evidence = { test: t.name, result: 'pass', duration_ms: performance.now() - started, browser: await browser.version(), fixture: { file: 'test/fixtures/h264-aac.mkv', size: media.length, sha256: createHash('sha256').update(media).digest('hex') }, decoded, afterSeek, redirects, prepareRequests: prepareBodies.length, onlyCached: prepareBodies.every(body => body.onlyCached === true), newTorrents: fixture.control.creates, serverMediaFetches: fixture.control.mediaFetches, limitations: 'Synthetic H264/AAC Matroska through real app UI/backend, with Playwright standing in for CDN media delivery. Desktop Chromium with a mobile viewport; not a physical Android decoder or live TorBox account test.' };
  t.diagnostic(JSON.stringify(evidence));
  if (process.env.MATROSKA_EVIDENCE_PATH) { await mkdir(dirname(process.env.MATROSKA_EVIDENCE_PATH), { recursive: true }); await writeFile(process.env.MATROSKA_EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n'); }
});

// Real native playback of a synthetic H264/AAC MKV through the complete app UI.
// Fixture provenance/reproduction: docs/evidence/playback-source-correction/matroska-probe.mjs.
// The committed media fixture avoids requiring FFmpeg during CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const baselineRoot = process.env.BASELINE_WORKTREE;
if (!baselineRoot) throw new Error('Set BASELINE_WORKTREE to a detached checkout of 34460c5a7434728873b66d6fa8ffb7a6ea5a7c62.');
const baselineCommit = spawnSync('git', ['-C', baselineRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (baselineCommit !== '34460c5a7434728873b66d6fa8ffb7a6ea5a7c62') throw new Error('BASELINE_WORKTREE must point to the exact published 1.2.6 evidence commit.');
const { startFixture } = await import(pathToFileURL(baselineRoot + '/test/browser/fixture.mjs'));
await mkdir('/tmp/torbox-audio-regression', { recursive: true });
const generation = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', baselineRoot + '/test/fixtures/fixture.mp4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30', '-t', '30', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'eac3', '-ac', '2', '-b:a', '192k', '/tmp/torbox-audio-regression/h264-eac3-30s.mkv'], { encoding: 'utf8' });
if (generation.status !== 0) throw new Error(generation.stderr);

const media = await readFile('/tmp/torbox-audio-regression/h264-eac3-30s.mkv');
const filename = 'Fixture.Show.S01E01.One.720p.H264.mkv';
const hash = 'a'.repeat(40);

test('reproduce unknown EAC3 MKV silent video marked successful by app', async t => {
  const started = performance.now();
  const fixture = await startFixture(4214);
  const item = { id: 1, hash, name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: filename, mimetype: 'video/x-matroska', size: media.length }] };
  fixture.sourceLookup.lookup = async () => {
    fixture.control.lookupCalls++;
    return { complete: true, sources: [{ hash, title: filename, filename, resolution: '720p', videoCodec: 'H264', audioCodecs: [], size: media.length, provider: 'Synthetic Matroska fixture' }] };
  };
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(value => [value, { cached: value === hash, files: value === hash ? [{ name: filename, size: media.length, mime: 'video/x-matroska' }] : [] }]));
  fixture.provider.request = async (path, params) => params?.id ? item : [item];
  fixture.provider.resolveForRelay = async id => ({ file: { id, title: filename, mime: 'video/x-matroska', state: 'Ready to watch' }, upstreamUrl: 'https://store.tb-cdn.io/fixture.mkv?token=fixture-master-key' });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await browser.close(); await fixture.close(); });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepareBodies = [], redirects = [];
  page.setDefaultTimeout(25000);
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
  assert.ok(decoded.decodedVideoFrames > 0); assert.equal(decoded.decodedAudioBytes, 0); assert.equal(decoded.audioPeak, 0); assert.equal(decoded.error, null);
  await page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video.currentTime > 17; });
  const afterSeek = await page.evaluate(() => { const video=document.querySelector('#video-slot video');return { currentTime: video.currentTime, decodedAudioBytes: video.webkitAudioDecodedByteCount, error:video.error, sourceMemory:JSON.parse(localStorage.getItem('torbox-source-memory-v1')||'{}'), healthState:document.querySelector('#health-state').textContent, healthDetail:document.querySelector('#health-detail').textContent };});
  assert.equal(afterSeek.decodedAudioBytes,0);assert.equal(afterSeek.healthState,'Playing');assert.equal(afterSeek.sourceMemory.titles['series:tt1234567'].sources['a'.repeat(40)].successes,1);
  assert.match(await page.locator('#playing-title').textContent(), /S01E01/);
  assert.ok(await page.locator('#title-dialog').isHidden());
  assert.equal(await page.locator('#play-fallback').textContent(), '');
  assert.ok(prepareBodies.length > 0); assert.ok(prepareBodies.every(body => body.onlyCached === true));
  assert.equal(fixture.control.playbackCalls, 1); assert.equal(fixture.control.creates, 0); assert.equal(fixture.control.mediaFetches, 0); assert.ok(redirects.length > 0); assert.deepEqual(errors, []);
  const evidence = { sourceCommit: '34460c5a7434728873b66d6fa8ffb7a6ea5a7c62', interpretation: 'Expected baseline bug reproduction, not a passing acceptance check.', test: t.name, result: 'pass', duration_ms: performance.now() - started, browser: await browser.version(), fixture: { file: 'generated h264-eac3-30s.mkv', size: media.length, sha256: createHash('sha256').update(media).digest('hex') }, decoded, afterSeek, redirects, prepareRequests: prepareBodies.length, onlyCached: prepareBodies.every(body => body.onlyCached === true), newTorrents: fixture.control.creates, serverMediaFetches: fixture.control.mediaFetches, limitations: 'Synthetic unknown EAC3 Matroska baseline reproduction through real app UI/backend, with Playwright standing in for CDN media delivery. Desktop Chromium with a mobile viewport; not a physical Android decoder or live TorBox account test.' };
  t.diagnostic(JSON.stringify(evidence));
  if (process.env.MATROSKA_EVIDENCE_PATH) { await mkdir(dirname(process.env.MATROSKA_EVIDENCE_PATH), { recursive: true }); await writeFile(process.env.MATROSKA_EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n'); }
});

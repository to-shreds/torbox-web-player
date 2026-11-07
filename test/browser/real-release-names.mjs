// Real releases rarely name their audio codec. Every other browser fixture
// labels sources "AAC", which hid a regression where strict audio checks
// spent the per-minute preparation budget on sources that could never pass.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startFixture } from './fixture.mjs';

const bytes = await readFile(new URL('../fixtures/fixture.mp4', import.meta.url));
// Typical cached release names: resolution, source and video codec only.
const NAMES = [
  'Fixture.Show.S01E01.1080p.WEB-DL.x264-GRP.mp4', 'Fixture.Show.S01E01.720p.WEB.h264-ETHEL.mp4',
  'Fixture.Show.S01E01.1080p.WEBRip.x264-ION10.mp4', 'Fixture.Show.S01E01.720p.HDTV.x264-SYNCOPY.mp4',
  'Fixture.Show.S01E01.1080p.AMZN.WEB-DL.H.264-NTb.mp4', 'Fixture.Show.S01E01.720p.WEBRip.x264-GalaxyTV.mp4',
  'Fixture.Show.S01E01.1080p.HULU.WEB.h264-EDITH.mp4', 'Fixture.Show.S01E01.480p.x264-mSD.mp4',
  'Fixture.Show.S01E01.720p.AMZN.WEB-DL.H264-FLUX.mp4', 'Fixture.Show.S01E01.1080p.WEB.H264-SuccessfulCrab.mp4',
];
let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }); });
after(async () => { await browser?.close(); });

async function setup(t, { incompleteFirstBatch = true, missingCounter = false } = {}) {
  const fixture = await startFixture(Number(process.env.REAL_NAMES_TEST_PORT) || 4225);
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepares = [], slowDowns = [];
  // Ten distinct cached releases for each of the fixture's three episodes.
  const items = [1, 2, 3].flatMap(episode => NAMES.map((name, index) => ({ id: (episode - 1) * NAMES.length + index + 1, episode, hash: (episode * 16 + index).toString(16).padStart(40, 'f'), name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: name.replace('S01E01', `S01E0${episode}`), mimetype: 'video/mp4', size: bytes.length }] })));
  fixture.sourceLookup.lookup = async (target, options = {}) => {
    const complete = !incompleteFirstBatch || options.complete === true;
    return { complete, sources: items.filter(item => item.episode === (target.episode || 1)).map(item => ({ hash: item.hash, title: item.files[0].short_name, filename: item.files[0].short_name, resolution: /1080p/.test(item.files[0].short_name) ? '1080p' : /480p/.test(item.files[0].short_name) ? '480p' : '720p', videoCodec: 'H264', audioCodecs: [], size: item.files[0].size, provider: 'Synthetic real-name regression' })) };
  };
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(hash => {
    const item = items.find(row => row.hash === hash);
    return [hash, { cached: Boolean(item), files: item ? [{ name: item.files[0].short_name, size: item.files[0].size, mime: item.files[0].mimetype }] : [] }];
  }));
  fixture.provider.request = async (_path, params) => params?.id ? items.find(item => item.id === Number(params.id)) : items;
  fixture.provider.resolveForRelay = async id => {
    const item = items[Number(id.split(':')[1]) - 1];
    return { file: { id, title: item.files[0].short_name, mime: item.files[0].mimetype, state: 'Ready to watch' }, upstreamUrl: 'https://store.tb-cdn.io/aac?token=fixture-master-key' };
  };
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/discover/prepare') prepares.push(request.postDataJSON()); });
  page.on('response', response => { if (response.status() === 429) slowDowns.push(new URL(response.url()).pathname); });
  await page.addInitScript(({ token, missingCounter }) => {
    sessionStorage.setItem('torbox-web-session', token);
    localStorage.setItem('torbox-settings-v1', JSON.stringify({ autoNext: false, showPlaybackHealth: false, interfaceMode: 'simple' }));
    if (missingCounter) Object.defineProperty(HTMLMediaElement.prototype, 'webkitAudioDecodedByteCount', { configurable: true, get: () => undefined });
  }, { token: fixture.session(), missingCounter });
  await context.route('https://**/*', route => route.abort());
  await context.route('**/media/*', async route => {
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) }, body: bytes.subarray(start, end + 1) });
  });
  t.after(async () => {
    t.diagnostic(JSON.stringify({ prepares: prepares.length, slowDowns, errors }));
    await context.close(); await fixture.close();
  });
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  return { page, fixture, errors, prepares, slowDowns };
}
const playing = page => page.waitForFunction(() => { const video = document.querySelector('#video-slot video'); return video && video.currentTime > 0.2 && !video.paused; });
async function openAndPlay(page) {
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
}

test('untagged cached releases play promptly from an incomplete first lookup within the preparation budget', async t => {
  const { page, prepares, slowDowns, errors } = await setup(t);
  await openAndPlay(page);
  await playing(page);
  assert.deepEqual(slowDowns, []); assert.deepEqual(errors, []);
  assert.ok(prepares.length <= 2, `expected a bounded number of preparations, saw ${prepares.length}`);
  assert.ok(prepares.every(body => body.onlyCached === true));
});

test('three different episodes in a row stay inside the per-minute preparation budget', async t => {
  const { page, prepares, slowDowns, errors } = await setup(t);
  for (let episode = 0; episode < 3; episode++) {
    if (!(await page.locator('#title-dialog').evaluate(dialog => dialog.open))) await page.locator('#catalog-grid button').first().click();
    await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).nth(episode).click();
    await playing(page);
    await page.locator('#close-player').click();
    await page.waitForFunction(() => !document.querySelector('#video-slot video') || document.querySelector('#video-slot video').paused);
  }
  assert.deepEqual(slowDowns, []); assert.deepEqual(errors, []);
  assert.ok(prepares.length <= 8, `preparation calls exceeded the server budget: ${prepares.length}`);
});

test('browsers without a decoded-audio counter still fail clearly instead of exhausting the budget', async t => {
  const { page, prepares, slowDowns } = await setup(t, { missingCounter: true });
  await openAndPlay(page);
  // Either playback starts (an acceptable file was proven) or a clear in-app fallback is shown.
  await page.waitForFunction(() => {
    const video = document.querySelector('#video-slot video');
    return (video && video.currentTime > 0.2 && !video.paused) || document.querySelector('#play-fallback')?.children.length > 0 || /compatible|No cached|try/i.test(document.querySelector('#detail-message')?.textContent || '');
  });
  assert.deepEqual(slowDowns, []);
  assert.ok(prepares.length <= 8, `preparation calls exceeded the server budget: ${prepares.length}`);
});

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
  const items = versions.map(([filename, kind], index) => ({ id: index + 1, kind, hash: (index + 1).toString(16).padStart(40, 'c'), name: 'Fixture Show', download_finished: true, download_present: true, files: [{ id: 0, short_name: filename, mimetype: media[kind].mime, size: media[kind].bytes.length }] }));
  fixture.sourceLookup.lookup = async () => ({ complete: true, sources: items.map(item => ({ hash: item.hash, title: item.files[0].short_name, filename: item.files[0].short_name, resolution: /1080p/.test(item.files[0].short_name) ? '1080p' : '720p', videoCodec: 'H264', audioCodecs: [], size: item.files[0].size, provider: 'Synthetic real-name sound regression' })) });
  fixture.discovery.gateway.cached = async hashes => Object.fromEntries(hashes.map(hash => {
    const item = items.find(row => row.hash === hash);
    return [hash, { cached: Boolean(item), files: item ? [{ name: item.files[0].short_name, size: item.files[0].size, mime: item.files[0].mimetype }] : [] }];
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
  const silent = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG'].map(group => [`Fixture.Show.S01E01.One.WEBRip.x264-${group}.mp4`, 'eac3']);
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
  assert.match(done.message, /Checked 7 versions; none had sound this browser can play\. No other cached version is available to check\./);
  assert.equal(done.more, false);
  assert.equal(fixture.control.playbackCalls, 7);
});

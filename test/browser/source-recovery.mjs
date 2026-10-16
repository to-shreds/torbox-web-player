// Source-recovery browser regressions. Faults are injected into local metadata
// responses; successful playback still uses the real backend and synthetic MP4.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { startFixture } from './fixture.mjs';

let browser, fixture, originalCached;
const media = await readFile(new URL('../fixtures/fixture.mp4', import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const source = (extension = 'mp4') => ({ hash: 'a'.repeat(40), title: `Fixture.Show.S01E01.One.720p.H264.AAC.${extension}`, filename: `Fixture.Show.S01E01.One.720p.H264.AAC.${extension}`, resolution: '720p', videoCodec: 'H264', audioCodecs: ['AAC'], provider: 'Fixture' });
before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  fixture = await startFixture(4201);
  originalCached = fixture.discovery.gateway.cached.bind(fixture.discovery.gateway);
});
after(async () => { await browser?.close(); await fixture?.close(); });

async function pageFor(t) {
  Object.assign(fixture.control, { sessionDelay: 0, progressDelay: 0, statusDelay: 0, lookupDelay: 0, cached: true, created: false, creates: 0, lookupCalls: 0, prepareCalls: 0, playbackCalls: 0, mediaFetches: 0, logins: 0 });
  fixture.discovery.tickets.clear(); fixture.discovery.operations.clear();
  fixture.discovery.gateway.cached = originalCached;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [], prepareBodies = [], lookupQueries = [];
  page.setDefaultTimeout(4500);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/discover/prepare') prepareBodies.push(request.postDataJSON());
    if (url.pathname === '/api/discover/lookup') lookupQueries.push(Object.fromEntries(url.searchParams));
  });
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); assert.equal(fixture.control.mediaFetches, 0, 'video bytes must never traverse the app server'); });
  await page.addInitScript(token => sessionStorage.setItem('torbox-web-session', token), fixture.session());
  await context.route('https://**/*', route => route.abort());
  await context.route('**/media/*', async route => {
    const redirect = await route.fetch({ maxRedirects: 0 });
    assert.equal(redirect.status(), 307);
    assert.equal((await redirect.body()).length, 0);
    assert.equal(new URL(redirect.headers().location).hostname, 'store.tb-cdn.io');
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    await route.fulfill({ status: range ? 206 : 200, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) }, body: media.subarray(start, end + 1) });
  });
  return { page, context, prepareBodies, lookupQueries };
}

async function chooseEpisode(page) {
  await page.goto(fixture.origin);
  await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
}
async function playing(page) { await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 0, undefined, { timeout: 4500 }); }
async function fallbackVisible(page, t, locator) {
  try { await locator.waitFor(); }
  catch (error) {
    t.diagnostic(JSON.stringify(await page.evaluate(() => ({ titleOpen: document.querySelector('#title-dialog').open, quickActionsOpen: document.querySelector('#quick-actions-dialog').open, detailMessage: document.querySelector('#detail-message').textContent, catalogMessage: document.querySelector('#catalog-message').textContent, fallback: document.querySelector('#play-fallback').textContent }))));
    throw error;
  }
}
function assertCachedOnly(bodies) {
  assert.ok(bodies.length > 0, 'must actually resolve a source');
  assert.ok(bodies.every(body => body.onlyCached === true), 'automatic and cached retry actions must remain cache-only');
  assert.equal(fixture.control.creates, 0, 'these existing cached sources must not create new torrents');
}

test('an unknown cache check still resolves an existing exact source without allowing an uncached addition', async t => {
  const { page, prepareBodies } = await pageFor(t);
  fixture.discovery.gateway.cached = async () => { throw new Error('Synthetic cache check outage'); };
  await chooseEpisode(page); await playing(page);
  assertCachedOnly(prepareBodies);
  assert.equal(fixture.control.playbackCalls, 1);
});

test('a cached source that fails automatic preparation remains recoverable through Retry & Play', async t => {
  const { page, context, prepareBodies } = await pageFor(t); let retry = false;
  await context.route('**/api/discover/prepare', route => retry ? route.continue() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'unavailable', message: 'Synthetic stale availability result; no torrent added.' }) }));
  await chooseEpisode(page);
  const action = page.locator('#play-fallback [data-action="prepare-source"]');
  await action.first().waitFor();
  assert.equal(await action.first().textContent(), 'Retry & Play');
  assert.equal(fixture.control.playbackCalls, 0); assert.equal(fixture.control.creates, 0);
  retry = true; await action.first().click(); await playing(page);
  assertCachedOnly(prepareBodies);
  assert.equal(fixture.control.playbackCalls, 1);
});

test('briefly preparing cached media is polled and starts automatically when ready', async t => {
  const { page, context, prepareBodies } = await pageFor(t); let statuses = 0;
  await context.route('**/api/discover/prepare', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'preparing', message: 'Synthetic metadata delay', progress: 0.99 }) });
  });
  await context.route('**/api/discover/status?**', route => { statuses++; return route.continue(); });
  await chooseEpisode(page); await playing(page);
  assert.ok(statuses >= 1, 'preparing must be rechecked rather than discarded immediately');
  assertCachedOnly(prepareBodies);
});

test('an empty incomplete fast batch waits for the complete lookup before failing', async t => {
  const { page, context, prepareBodies, lookupQueries } = await pageFor(t); let early = 0, complete = 0;
  await context.route('**/api/discover/lookup?**', async route => {
    const full = new URL(route.request().url()).searchParams.get('complete') === '1';
    if (full) complete++; else early++;
    await pause(100);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ complete: full, sources: full ? [source()] : [] }) });
  });
  await chooseEpisode(page); await playing(page);
  assert.equal(early, 1); assert.equal(complete, 1); assertCachedOnly(prepareBodies);
  assert.ok(lookupQueries.every(query => query.refresh === undefined), 'warm and automatic complete lookups do not request refresh');
});

for (const failure of ['incompatible', 'empty']) test(`${failure} source results expose a working Retry search in Simple mode`, async t => {
  const { page, context, prepareBodies, lookupQueries } = await pageFor(t); let recovered = false, lookups = 0;
  await context.route('**/api/discover/lookup?**', route => {
    lookups++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ complete: true, sources: recovered ? [source()] : failure === 'incompatible' ? [source('avi')] : [] }) });
  });
  await chooseEpisode(page);
  const retry = page.locator('#play-fallback [data-action="retry-sources"]'); await fallbackVisible(page, t, retry);
  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('mode-simple')), true);
  assert.equal(await page.locator('#play-fallback [data-action="prepare-source"]').count(), 0, 'must not offer known incompatible downloads');
  assert.equal(fixture.control.creates, 0); assert.equal(fixture.control.playbackCalls, 0);
  const box = await retry.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 412, 'retry action fits phone viewport');
  if (failure === 'incompatible' && process.env.SOURCE_RECOVERY_EVIDENCE_DIR) {
    await mkdir(process.env.SOURCE_RECOVERY_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.SOURCE_RECOVERY_EVIDENCE_DIR, 'source-recovery-phone.png'), fullPage: false });
  }
  assert.ok(lookupQueries.every(query => query.refresh === undefined), 'initial and warm requests must not refresh the shared lookup');
  const beforeRetry = lookups; recovered = true; await retry.click(); await playing(page);
  assert.ok(lookups > beforeRetry, 'retry must run a fresh lookup'); assertCachedOnly(prepareBodies);
  assert.equal(lookupQueries[beforeRetry].refresh, '1', 'explicit Check again must request a fresh lookup');
});

test('closing the title while cached preparation is pending prevents late playback', async t => {
  const { page, context, prepareBodies } = await pageFor(t); let statusCalls = 0;
  await context.route('**/api/discover/prepare', async route => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'preparing', message: 'Synthetic pending metadata', progress: 0.99 }) });
  });
  await context.route('**/api/discover/status?**', async route => { statusCalls++; await pause(500); await route.continue(); });
  await chooseEpisode(page);
  await page.waitForRequest(request => new URL(request.url()).pathname === '/api/discover/status');
  await page.locator('#close-title').click(); await page.waitForTimeout(900);
  assert.ok(statusCalls >= 1, 'cancellation exercised pending status work');
  assertCachedOnly(prepareBodies);
  assert.equal(fixture.control.playbackCalls, 0);
  assert.equal(await page.locator('#player').evaluate(dialog => dialog.open), false);
});

test('a quick-actions playback failure opens a visible recovery panel even when details were closed', async t => {
  const { page, context, prepareBodies } = await pageFor(t); let recovered = false;
  await context.route('**/api/discover/lookup?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ complete: true, sources: recovered ? [source()] : [] }) }));
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator('#catalog-type').selectOption('series');
  assert.equal(await page.locator('#title-dialog').evaluate(dialog => dialog.open), false);
  await page.locator('#catalog-grid button').first().click({ button: 'right' });
  await page.locator('#quick-actions-content button').filter({ hasText: /^Play$/ }).click();
  const retry = page.locator('#play-fallback [data-action="retry-sources"]'); await fallbackVisible(page, t, retry);
  assert.equal(await page.locator('#quick-actions-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator('#title-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#detail-title').textContent(), 'Fixture Show');
  recovered = true; await retry.click(); await playing(page); assertCachedOnly(prepareBodies);
});

test('a rate-limited cache check does not trigger preparation and exposes Check again', async t => {
  const { page, context, prepareBodies } = await pageFor(t); let limited = true;
  await context.route('**/api/discover/sources', async route => {
    if (!limited) return route.continue();
    const response = await route.fetch(), result = await response.json();
    result.cacheAvailability = 'unknown'; result.cacheErrorCode = 'TORBOX_RATE_LIMITED';
    result.sources = result.sources.map(item => ({ ...item, cached: null, cachedBrowserPlayable: null }));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
  });
  await chooseEpisode(page);
  const retry = page.locator('#play-fallback [data-action="retry-sources"]'); await retry.waitFor();
  assert.match(await page.locator('#play-fallback').textContent(), /limiting requests/i);
  assert.equal(prepareBodies.length, 0); assert.equal(fixture.control.creates, 0);
  assert.equal(await page.locator('#play-fallback [data-action="prepare-source"]').count(), 0);
  limited = false; await retry.click(); await playing(page); assertCachedOnly(prepareBodies);
});

test('failure of the full lookup retains a usable initial source for explicit Prepare & Play', async t => {
  const { page, context, prepareBodies, lookupQueries } = await pageFor(t); let complete = 0;
  fixture.control.cached = false;
  await context.route('**/api/discover/lookup?**', async route => {
    const full = new URL(route.request().url()).searchParams.get('complete') === '1';
    await pause(100);
    if (full) { complete++; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SOURCE_ALL_UNAVAILABLE', message: 'Synthetic complete lookup unavailable.' }) }); }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ complete: false, sources: [source()] }) });
  });
  await chooseEpisode(page);
  const action = page.locator('#play-fallback [data-action="prepare-source"]'); await fallbackVisible(page, t, action.first());
  assert.equal(complete, 1); assert.equal(await action.first().textContent(), 'Prepare & Play');
  assert.equal(fixture.control.creates, 0); assert.equal(prepareBodies.length, 0);
  await action.first().click(); await playing(page);
  assert.equal(fixture.control.creates, 1, 'only the explicitly selected uncached source may start a torrent');
  assert.deepEqual(prepareBodies.map(body => body.onlyCached), [false]);
  assert.ok(lookupQueries.every(query => query.refresh === undefined), 'an automatic full lookup is not a user-requested refresh');
});

for (const startOver of [false, true]) test(`${startOver ? 'Start over' : 'Resume'} preserves playback position after Check again recovery`, async t => {
  const { page, context, prepareBodies } = await pageFor(t); let recovered = false;
  await context.route('**/api/discover/lookup?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ complete: true, sources: recovered ? [source()] : [] }) }));
  await page.goto(fixture.origin); await page.waitForSelector('#workspace:not([hidden])');
  await page.evaluate(async () => {
    const { recordRecent } = await import('./history.js?v=release-1.2.7-audio.1');
    recordRecent({ current: { type: 'series', id: 'tt1234567', season: 1, episode: 1 }, title: 'Fixture Show', episodeName: 'One' }, 40, 120);
  });
  await page.reload(); await page.waitForSelector('#workspace:not([hidden])');
  await page.locator(startOver ? '#recent-list .recent-start-over' : '#recent-list .recent-card').click();
  const retry = page.locator('#play-fallback [data-action="retry-sources"]'); await retry.waitFor();
  assert.ok(await page.locator('#resume-overlay').isHidden());
  assert.equal(fixture.control.playbackCalls, 0);
  recovered = true; await retry.click(); await playing(page);
  await page.waitForFunction(() => document.querySelector('#resume-overlay').hidden);
  const position = await page.locator('#video-slot video').evaluate(video => video.currentTime);
  assert.ok(startOver ? position > 0 && position < 5 : position >= 30 && position < 35, `${startOver ? 'Start over' : 'Resume'} played from ${position.toFixed(2)} seconds`);
  assertCachedOnly(prepareBodies);
});

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../../server.mjs';
import { TorBox } from '../../lib/torbox.mjs';

// Independent browser sessions share the host's TorBox provider through a
// restricted party session and separate opaque playback tickets. Only the
// original, locally generated video fixture crosses the browser boundary;
// this suite never contacts TorBox or relays real media.
const media = await readFile(new URL('../fixtures/fixture.mp4', import.meta.url));
const target = { type: 'series', id: 'tt1234567', season: 1, episode: 1 };
const hash = 'a'.repeat(40);
const filename = 'Fixture.Show.S01E01.One.720p.H264.AAC.mp4';
const path = 'Fixture Show/' + filename;
const keys = { host: 'watch-party-host-fixture-key', guest: 'watch-party-guest-fixture-key' };
const temporaryLinkToken = 'temporary-host-file-token';
let browser;
const saveEvidence = process.env.WATCH_PARTY_EVIDENCE === '1';
const evidence = { generatedAt: new Date().toISOString(), scope: 'Local production UI/server with a synthetic host TorBox account, a restricted no-key party guest, an optional preexisting guest account, and original fixture.mp4; no real accounts or media.', measurements: {} };
const sourcePaths = ['public/watch-party.js', 'public/watch-party-core.js', 'public/app.js', 'lib/watch-party.mjs', 'server.mjs'];
async function sourceHashes() { return Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(new URL('../../' + path, import.meta.url))).digest('hex')]))); }
before(async () => {
  if (saveEvidence) { await mkdir('docs/evidence/watch-party', { recursive: true }); evidence.sourceSha256 = await sourceHashes(); }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
});
after(async () => {
  await browser?.close();
  if (saveEvidence) { assert.deepEqual(await sourceHashes(), evidence.sourceSha256, 'application source must remain unchanged during the evidence run'); await writeFile('docs/evidence/watch-party/browser-measurements.json', JSON.stringify(evidence, null, 2) + '\n'); }
});

async function fixtureFor(t, { mismatch = false } = {}) {
  const origin = 'http://127.0.0.1:4202';
  const control = { mediaFetches: 0, logins: 0, providerCalls: [], playback: { host: [], guest: [] }, redirects: { host: [], guest: [] } };
  const rows = Object.fromEntries(['host', 'guest'].map((role, index) => [role, {
    id: 11 + index * 11, hash, name: 'Fixture Show', download_finished: true, download_present: true,
    files: [{ id: 0, name: role === 'guest' && mismatch ? 'Different Cut/' + filename : path, short_name: filename, mimetype: 'video/mp4', size: media.length }]
  }]));
  const roleFor = key => key === keys.host ? 'host' : key === keys.guest ? 'guest' : null;
  const meta = { id: target.id, type: 'series', name: 'Fixture Show', releaseInfo: '2024', videos: [{ id: `${target.id}:1:1`, season: 1, episode: 1, name: 'One', released: '2024-01-01' }] };
  const upstream = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'status.torbox.app') return new Response('All systems operational');
    if (url.pathname.includes('/meta/')) return Response.json({ meta });
    if (url.pathname.includes('/catalog/')) return Response.json({ metas: [meta] });
    const key = options.headers?.Authorization?.replace(/^Bearer /, '') || url.searchParams.get('token');
    const role = roleFor(key);
    if (!role) throw new Error('Unexpected synthetic account');
    control.providerCalls.push({ role, path: url.pathname, redirect: url.searchParams.get('redirect') });
    if (url.pathname.endsWith('/user/me')) return Response.json({ success: true, data: { id: role, email: `${role}@fixture.invalid` } });
    if (url.pathname.endsWith('/mylist')) return Response.json({ success: true, data: url.searchParams.has('id') ? rows[role] : [rows[role]] });
    if (url.pathname.endsWith('/checkcached')) return Response.json({ success: true, data: { [hash]: { files: rows[role].files } } });
    if (url.pathname.endsWith('/requestdl')) {
      if (url.searchParams.get('redirect') === 'true') return new Response(null, { status: 307, headers: { Location: `https://store.tb-cdn.io/${role}/fixture.mp4?token=${temporaryLinkToken}` } });
      return Response.json({ success: true, data: `https://store.tb-cdn.io/${role}/fixture.mp4?token=${key}` });
    }
    throw new Error('Unexpected synthetic upstream: ' + url.pathname);
  };
  const app = createApp({
    env: { AUTH_MODE: 'api-key', PUBLIC_ORIGIN: origin, FRONTEND_ORIGINS: origin },
    providerFactory: key => new TorBox({ key, fetchFn: upstream }),
    discoveryFetch: upstream,
    mediaFetch: async () => { control.mediaFetches++; throw new Error('Video relaying is forbidden in this fixture'); },
    sourceLookupService: { lookup: async () => ({ sources: [{ hash, title: filename, filename, resolution: '720p', videoCodec: 'H264', audioCodecs: ['AAC'], size: media.length, provider: 'Synthetic fixture' }] }) }
  });
  const handler = app.server.listeners('request')[0]; app.server.removeAllListeners('request');
  app.server.on('request', async (request, response) => {
    const requestPath = new URL(request.url, origin).pathname;
    if (requestPath === '/api/login') control.logins++;
    if (requestPath === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end((await readFile(new URL('../../public/index.html', import.meta.url), 'utf8')).replaceAll('https://torbox-web-player-key.onrender.com', origin));
      return;
    }
    void handler(request, response);
  });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(4202, '127.0.0.1', resolve); });
  const contexts = [];
  t.after(async () => { await Promise.all(contexts.map(context => context.close())); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); assert.equal(control.mediaFetches, 0); });

  async function user(role, { mobile = false, mediaGate = null, signedIn = role === 'host', invitation = '' } = {}) {
    const context = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1100, height: 820 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }); contexts.push(context);
    const page = await context.newPage(), errors = [], partyResponses = [], pendingResponses = [];
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/api/watch-party/')) pendingResponses.push(response.json().then(data => partyResponses.push(data)).catch(() => {}));
      if (new URL(response.url()).pathname === '/api/playback') pendingResponses.push(response.json().then(data => control.playback[role].push(data)).catch(() => {}));
    });
    await context.route('https://**/*', route => route.abort());
    await context.route('**/media/*', async route => {
      const redirect = await route.fetch({ maxRedirects: 0 });
      assert.equal(redirect.status(), 307); assert.equal((await redirect.body()).length, 0);
      const destination = new URL(redirect.headers().location);
      assert.equal(destination.hostname, 'store.tb-cdn.io'); assert.equal(destination.pathname, '/host/fixture.mp4');
      assert.equal(destination.searchParams.get('token'), keys.host, 'the consented native media handoff uses the host account, including its provider-issued key-bearing URL');
      assert.equal(destination.href.includes(keys.guest), false, 'a signed-in guest’s own provider key must never authorize party media');
      control.redirects[role].push(destination.href);
      if (mediaGate) await mediaGate;
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '');
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
      await route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) } });
    });
    await page.goto(invitation || origin);
    if (signedIn) {
      await page.locator('#api-key').fill(keys[role]); await page.locator('#login-form button[type=submit]').click();
      await page.waitForSelector('#workspace:not([hidden])');
    } else if (invitation) {
      await page.locator('#watch-party-dialog[open]').waitFor();
      assert.equal(await page.locator('#api-key').isVisible(), false);
    } else {
      await page.locator('#login:not([hidden])').waitFor();
      assert.equal(await page.locator('#api-key').inputValue(), '');
    }
    t.after(async () => {
      await Promise.allSettled(pendingResponses);
      assert.deepEqual(errors, [], 'production browser should not raise page errors');
      for (const data of partyResponses) {
        const serialized = JSON.stringify(data);
        assert.equal(serialized.includes(keys.host), false); assert.equal(serialized.includes(keys.guest), false);
        assert.equal(serialized.includes('store.tb-cdn.io'), false); assert.equal(serialized.includes('/media/'), false);
      }
      for (const data of control.playback[role]) {
        const serialized = JSON.stringify(data);
        for (const key of Object.values(keys)) assert.equal(serialized.includes(key), false, 'API keys belong only to the host-consented native media handoff');
        assert.equal(serialized.includes('store.tb-cdn.io'), false, 'playback JSON must contain an opaque ticket rather than the upstream media URL');
      }
    });
    return { page, context, partyResponses };
  }
  return { ...app, origin, control, rows, user };
}
async function playHost(page) {
  await page.locator('#catalog-type').selectOption('series'); await page.locator('#catalog-grid button').first().click();
  await page.locator('#episode-area button').filter({ hasText: /^Play$/ }).first().click();
  await page.waitForFunction(() => document.querySelector('#video-slot video')?.currentTime > 0);
}
async function createParty(host) {
  await playHost(host.page); await host.page.locator('#player-watch-party').click();
  assert.equal(await host.page.locator('#party-create').isDisabled(), true, 'creating must require deliberate account-access consent');
  assert.match(await host.page.locator('#party-host-access').innerText(), /full API key[\s\S]*access[\s\S]*TorBox account/i);
  await host.page.locator('#party-trust-viewer').check();
  const response = host.page.waitForResponse(response => new URL(response.url()).pathname === '/api/watch-party/create' && response.request().method() === 'POST');
  await host.page.locator('#party-create').click(); const created = await (await response).json();
  assert.ok(created.room?.id); assert.match(created.joinToken, /^[A-Za-z0-9_-]{43}$/);
  created.invitation = await host.page.locator('#party-link').inputValue();
  const invitation = new URL(created.invitation); assert.equal(invitation.hash, '#party=' + created.joinToken);
  assert.equal(invitation.search, ''); assert.equal(invitation.username, ''); assert.equal(invitation.password, '');
  return created;
}
async function joinParty(guest, created, { paste = false } = {}) {
  if (paste) {
    await guest.page.locator('#login-watch-party').click(); await guest.page.locator('#party-join-code').fill(created.joinValue || created.joinToken); await guest.page.locator('#party-join').click();
  } else {
    if (guest.page.url() !== created.invitation) await guest.page.goto(created.invitation);
    await guest.page.locator('#watch-party-dialog[open]').waitFor();
    await guest.page.locator('#party-join').click();
  }
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.readyState >= 2);
  await guest.page.waitForFunction(() => !document.querySelector('#watch-party-dialog').open);
  await guest.page.locator('#player-watch-party').click();
}
async function metrics(page) { return page.locator('#video-slot video').evaluate(video => ({ time: video.currentTime, paused: video.paused, duration: video.duration, readyState: video.readyState, rate: video.playbackRate })); }
async function waitConverged(host, guest, { playing, near, tolerance = .65 } = {}) {
  const deadline = Date.now() + 12000;
  let current;
  while (Date.now() < deadline) {
    current = await Promise.all([metrics(host.page), metrics(guest.page)]);
    if (current.every(video => video.readyState >= 2 && (playing === undefined || video.paused !== playing) && (near === undefined || Math.abs(video.time - near) < 1.5)) && Math.abs(current[0].time - current[1].time) < tolerance) return current;
    await host.page.waitForTimeout(100);
  }
  assert.fail('Independent real video elements did not converge: ' + JSON.stringify(current));
}
async function closePartyDialog(page) {
  await page.locator('#close-watch-party').click();
}

// The assertions below exercise production DOM and real media playback. Browser
// event injection is limited to a stall/recovery notification, which cannot be
// induced deterministically by a fully cached local MP4.
test('a fresh invitation joins the consented host connection without a guest API key and exposes credentials only in the native media handoff', { timeout: 45000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host');
  const created = await createParty(host), guest = await fixture.user('guest', { mobile: true, invitation: created.invitation });
  await joinParty(guest, created);
  await guest.page.waitForFunction(() => document.querySelector('#playing-title').textContent.includes('Fixture.Show.S01E01'));
  await host.page.locator('#party-play').click();
  const videos = await waitConverged(host, guest, { playing: true });
  assert.equal(videos[0].duration, videos[1].duration);
  for (const user of [host, guest]) await user.page.waitForFunction(() => document.querySelector('#video-slot video')?.getVideoPlaybackQuality().totalVideoFrames > 0);
  assert.ok(videos.every(video => Math.abs(video.rate - 1) <= .06), 'drift correction should keep playback close to the normal rate');
  t.diagnostic(`Real-video drift on coordinated start: ${Math.abs(videos[0].time - videos[1].time).toFixed(3)}s; host-backed guest and direct CDN tickets confirmed.`);
  assert.ok(fixture.control.redirects.host.length); assert.ok(fixture.control.redirects.guest.length);
  assert.equal(fixture.control.playback.host.at(-1).file.id, 'torrents:11:0'); assert.equal(fixture.control.playback.guest.at(-1).file.id, 'torrents:11:0');
  assert.equal(fixture.control.playback.guest.at(-1).guestSafeLink, false);
  assert.equal(fixture.control.playback.guest.at(-1).exposesTorBoxToken, true);
  assert.equal(fixture.control.logins, 1, 'only the host connects a TorBox API key');
  assert.ok(fixture.control.providerCalls.every(call => call.role === 'host'), 'no guest provider account may be used');
  const session = await guest.page.evaluate(async () => {
    const response = await fetch('/api/session', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('torbox-web-session') } });
    return response.json();
  });
  assert.equal(session.guest, true); assert.equal(session.partyGuest, true); assert.equal(session.partyRoomId, created.room.id);
  const storage = await guest.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const key of Object.values(keys)) assert.equal(storage.includes(key), false);
  assert.equal(await guest.page.locator('#api-key').isVisible(), false);
  assert.equal(await guest.page.locator('#catalog-grid').isVisible(), false);
  const forbidden = await guest.page.evaluate(async () => {
    const headers = { Authorization: 'Bearer ' + sessionStorage.getItem('torbox-web-session') };
    return Promise.all(['/api/discover/catalog?type=series', '/api/library', '/api/drive/config', '/api/discover/meta?type=series&id=tt9999999'].map(async path => {
      const response = await fetch(path, { headers }); return { path, status: response.status, body: await response.json() };
    }));
  });
  for (const result of forbidden) { assert.equal(result.status, 403, result.path); assert.equal(result.body.error, 'GUEST_FORBIDDEN', result.path); }
  assert.equal(await guest.page.locator('#party-host-access').isVisible(), false);
  evidence.measurements.start = { driftSeconds: Math.abs(videos[0].time - videos[1].time), host: videos[0], guest: videos[1], hostProviderShared: true, guestKeySupplied: false, hostExplicitlyConsentedToKeyBearingMediaHandoff: true, keyInGuestMediaRedirect: true, keyInPartyJsonOrGuestStorage: false, forbiddenApis: forbidden.map(({ path, status }) => ({ path, status })), mediaRelayCalls: fixture.control.mediaFetches };
  if (saveEvidence) { await closePartyDialog(host.page); await closePartyDialog(guest.page); await host.page.screenshot({ path: 'docs/evidence/watch-party/watch-party-desktop.png' }); await guest.page.screenshot({ path: 'docs/evidence/watch-party/watch-party-phone.png' }); }
});

test('either participant pauses, seeks and resumes both independent video elements at the same time', { timeout: 45000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, { ...created, joinValue: created.invitation }, { paste: true }); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await guest.page.locator('#party-pause').click(); await waitConverged(host, guest, { playing: false });
  await guest.page.locator('#video-slot video').evaluate(video => { video.currentTime = 32; });
  await waitConverged(host, guest, { playing: false, near: 32 });
  await guest.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true, near: 32 });
  await host.page.locator('#party-pause').click(); const paused = await waitConverged(host, guest, { playing: false });
  await host.page.waitForTimeout(500); const still = await Promise.all([metrics(host.page), metrics(guest.page)]);
  assert.ok(still.every((video, index) => Math.abs(video.time - paused[index].time) < .1));
  await host.page.waitForTimeout(600);
  await guest.page.locator('#video-slot video').evaluate(video => video.play()); await waitConverged(host, guest, { playing: true });
  await host.page.waitForTimeout(600);
  await host.page.locator('#video-slot video').evaluate(video => video.pause()); await waitConverged(host, guest, { playing: false });
});

test('joining from a signed-in browser uses a separate host-backed session instead of that viewer’s account', { timeout: 40000 }, async t => {
  const fixture = await fixtureFor(t, { mismatch: true }), host = await fixture.user('host'), guest = await fixture.user('guest', { signedIn: true });
  const created = await createParty(host);
  const preservedSetup = await guest.page.evaluate(async ({ key, target }) => {
    const { rememberApiKey, loadRememberedApiKey } = await import('./vault.js');
    const { updateSettings } = await import('./settings.js');
    const { recordRecent } = await import('./history.js');
    await rememberApiKey(key); updateSettings({ resolution: '1080p', resumeRewindSeconds: 15, autoNext: false });
    recordRecent({ current: target, title: 'Previously watched through my own connection', resolution: '1080p' }, 65, 120);
    return { settings: localStorage.getItem('torbox-settings-v1'), history: localStorage.getItem('torbox-recent-v1'), rememberedKey: await loadRememberedApiKey() };
  }, { key: keys.guest, target });
  const oldSession = await guest.page.evaluate(() => sessionStorage.getItem('torbox-web-session'));
  const providerCalls = fixture.control.providerCalls.length;
  await joinParty(guest, created);
  const partySession = await guest.page.evaluate(() => sessionStorage.getItem('torbox-web-session'));
  assert.notEqual(partySession, oldSession);
  assert.ok(fixture.control.providerCalls.slice(providerCalls).every(call => call.role === 'host'), 'joining must not search or prepare through the viewer’s independent account');
  assert.equal(fixture.control.playback.guest.at(-1).file.id, 'torrents:11:0');
  await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await guest.page.locator('#party-leave').click();
  await guest.page.waitForFunction(previous => sessionStorage.getItem('torbox-web-session') === previous && !document.querySelector('#workspace').hidden, oldSession);
  const restored = await guest.page.evaluate(async () => (await fetch('/api/session', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('torbox-web-session') } })).json());
  assert.equal(restored.authenticated, true); assert.equal(restored.guest, false);
  assert.deepEqual(await guest.page.evaluate(async () => ({ settings: localStorage.getItem('torbox-settings-v1'), history: localStorage.getItem('torbox-recent-v1'), rememberedKey: await (await import('./vault.js')).loadRememberedApiKey() })), preservedSetup, 'the party overlay must preserve the independent account’s episode resume, settings and encrypted remembered key');
});

test('a no-key guest reloads the same party session and can leave and rejoin the host’s invitation', { timeout: 55000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created);
  await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await host.page.locator('#party-pause').click(); await waitConverged(host, guest, { playing: false });
  await host.page.locator('#video-slot video').evaluate(video => { video.currentTime = 27; });
  await waitConverged(host, guest, { playing: false, near: 27 });
  const originalSession = await guest.page.evaluate(() => sessionStorage.getItem('torbox-web-session'));
  const previousPlays = fixture.control.playback.guest.length;
  await guest.page.reload();
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.readyState >= 2);
  assert.equal(await guest.page.evaluate(() => sessionStorage.getItem('torbox-web-session')), originalSession);
  await waitConverged(host, guest, { playing: false, near: 27 });
  assert.ok(fixture.control.playback.guest.length > previousPlays, 'reload must issue a fresh consented playback ticket through the existing restricted session');
  if (!(await guest.page.locator('#watch-party-dialog').evaluate(dialog => dialog.open))) await guest.page.locator('#player-watch-party').click();
  await guest.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true, near: 27 });
  await guest.page.locator('#party-leave').click();
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'waiting');
  await guest.page.locator('#login:not([hidden])').waitFor();
  await joinParty(guest, created);
  assert.notEqual(await guest.page.evaluate(() => sessionStorage.getItem('torbox-web-session')), originalSession);
  await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  assert.equal(fixture.control.logins, 1, 'reloading and rejoining never require another TorBox sign-in');
});

test('closing playback leaves the party and cannot reopen a stopped player', { timeout: 40000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await closePartyDialog(guest.page); await guest.page.locator('#close-player').click();
  await host.page.waitForFunction(() => document.querySelector('#video-slot video')?.paused === true);
  await host.page.waitForTimeout(1000); assert.equal(await guest.page.locator('#player').evaluate(dialog => dialog.open), false);
  const before = fixture.control.playback.guest.length; await host.page.locator('#party-play').click(); await host.page.waitForTimeout(1000);
  assert.equal(fixture.control.playback.guest.length, before); assert.equal(await guest.page.locator('#player').evaluate(dialog => dialog.open), false);
});


test('a delayed real media load holds the ready viewer until both videos can start', { timeout: 45000 }, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest', { mediaGate: gate });
  const created = await createParty(host);
  await guest.page.goto(created.invitation); await guest.page.locator('#watch-party-dialog[open]').waitFor(); await guest.page.locator('#party-join').click();
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.currentSrc);
  assert.equal(await guest.page.locator('#party-resume').isDisabled(), true, 'Ready must remain disabled before actual media metadata arrives');
  await guest.page.locator('#party-resume').evaluate(button => button.click());
  await host.page.locator('#party-play').click();
  await host.page.waitForTimeout(900); const first = await metrics(host.page); assert.equal(first.paused, true);
  await host.page.waitForTimeout(500); const second = await metrics(host.page); assert.ok(Math.abs(second.time - first.time) < .1);
  release(); await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.readyState >= 2);
  await waitConverged(host, guest, { playing: true });
});

test('a player buffering report pauses the party and recovery starts both videos together', { timeout: 45000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await guest.page.locator('#video-slot video').evaluate(video => video.dispatchEvent(new Event('waiting')));
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'buffering');
  await waitConverged(host, guest, { playing: false });
  await guest.page.locator('#video-slot video').evaluate(video => video.dispatchEvent(new Event('canplay')));
  await waitConverged(host, guest, { playing: true });
});

test('a lost control connection pauses locally and at the peer, then reconnects to the shared timeline', { timeout: 65000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await guest.context.setOffline(true);
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.paused === true);
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'disconnected', null, { timeout: 18000 });
  assert.equal((await metrics(host.page)).paused, true);
  await guest.context.setOffline(false);
  await waitConverged(host, guest, { playing: true });
});

test('changing the viewer detaches its party before a stale heartbeat can affect another viewer', { timeout: 40000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await closePartyDialog(guest.page);
  // A viewer selection event can also arrive from account/device navigation
  // while a player modal is present; production must still revoke the room.
  await guest.page.locator('#viewer').evaluate(select => { select.value = 'viewer-2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await guest.page.waitForFunction(() => document.querySelector('#viewer').value === 'viewer-2' && !document.querySelector('#player').open);
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'waiting');
  const requests = fixture.control.playback.guest.length; await host.page.waitForTimeout(900);
  assert.equal(fixture.control.playback.guest.length, requests); assert.equal(await guest.page.locator('#player').evaluate(dialog => dialog.open), false);
});

test('a no-key invitation preserves Kid Mode and requires the Parent PIN again after reload', { timeout: 50000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host);
  await guest.page.evaluate(async () => {
    const { setParentPin, updateKidProfile } = await import('./parental-controls.js');
    await setParentPin('2468'); updateKidProfile('viewer-1', { enabled: true });
  });
  await guest.page.goto(created.invitation);
  await guest.page.locator('#parent-pin-dialog[open]').waitFor();
  assert.equal(fixture.control.playback.guest.length, 0);
  await guest.page.locator('#parent-pin-input').fill('1111'); await guest.page.locator('#parent-pin-form button[type=submit]').click();
  await guest.page.waitForFunction(() => document.querySelector('#parent-pin-message').textContent.includes('Incorrect'));
  assert.equal(fixture.control.playback.guest.length, 0);
  await guest.page.locator('#parent-pin-input').fill('2468'); await guest.page.locator('#parent-pin-form button[type=submit]').click();
  await guest.page.locator('#watch-party-dialog[open]').waitFor(); await guest.page.locator('#party-join').click();
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.readyState >= 2);
  assert.equal(await guest.page.evaluate(async () => (await import('./parental-controls.js')).getKidProfile('viewer-1').enabled), true);
  const previousPlays = fixture.control.playback.guest.length;
  await guest.page.reload(); await guest.page.locator('#parent-pin-dialog[open]').waitFor();
  assert.equal(fixture.control.playback.guest.length, previousPlays, 'a restored guest session cannot load media before renewed parent approval');
  await guest.page.locator('#parent-pin-input').fill('2468'); await guest.page.locator('#parent-pin-form button[type=submit]').click();
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.readyState >= 2);
  await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  assert.equal(fixture.control.logins, 1);
});

test('Kid Mode enabled in another tab leaves the adult party and keeps further controls unavailable', { timeout: 40000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  const otherTab = await guest.context.newPage(); await otherTab.goto(fixture.origin);
  await otherTab.evaluate(async () => { const { updateKidProfile } = await import('./parental-controls.js'); updateKidProfile('viewer-1', { enabled: true }); });
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'waiting');
  await guest.page.waitForFunction(() => !document.querySelector('#watch-party-dialog').open);
  assert.equal(await guest.page.locator('#party-player-status').isVisible(), false);
  await otherTab.close();
});


test('the host leaving ends the invitation and cleanly detaches the other player', { timeout: 40000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created); await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await host.page.locator('#party-leave').click();
  await guest.page.waitForFunction(() => document.querySelector('#party-player-status').hidden === true && (!document.querySelector('#video-slot video') || document.querySelector('#video-slot video').paused === true));
  assert.equal(await host.page.locator('#party-controls').isVisible(), false); assert.equal(await guest.page.locator('#party-controls').isVisible(), false);
  const rejected = await guest.page.evaluate(async invitation => {
    const response = await fetch('/api/watch-party/join', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('torbox-web-session') }, body: JSON.stringify({ token: invitation }) });
    return { status: response.status, body: await response.json() };
  }, created.joinToken);
  assert.equal(rejected.status, 404); assert.equal(rejected.body.error, 'WATCH_PARTY_NOT_FOUND');
});

test('immediate native pause survives coordinated start and a drift-correction rate change', { timeout: 45000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created);
  await guest.page.locator('#video-slot video').evaluate(video => {
    const probe = window.partyImmediatePauseProbe = { playingAt: null, pauseAt: null };
    video.addEventListener('playing', () => {
      probe.playingAt = performance.now();
      setTimeout(() => { probe.pauseAt = performance.now(); video.pause(); }, 50);
    }, { once: true });
  });
  await host.page.locator('#party-play').click();
  await guest.page.waitForFunction(() => window.partyImmediatePauseProbe?.pauseAt !== null);
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'paused');
  const paused = await waitConverged(host, guest, { playing: false });
  await host.page.waitForTimeout(1000);
  const held = await Promise.all([metrics(host.page), metrics(guest.page)]);
  assert.ok(held.every((video, index) => video.paused && Math.abs(video.time - paused[index].time) < .1), 'the native pause must remain authoritative after later correction ticks');
  const immediate = await guest.page.evaluate(() => window.partyImmediatePauseProbe);
  assert.ok(immediate.pauseAt - immediate.playingAt >= 40 && immediate.pauseAt - immediate.playingAt < 400, 'native pause must occur inside the former global suppression window');

  await host.page.locator('#party-play').click(); await waitConverged(host, guest, { playing: true });
  await guest.page.locator('#video-slot video').evaluate(video => {
    const probe = window.partyRatePauseProbe = { correctionAt: null, correctionRate: null, pauseAt: null };
    // Repeatedly slowing the actual media clock creates real decoder drift,
    // without a seek command or a synthetic room/video implementation. The
    // production adapter then selects its normal >1x catch-up correction.
    let slowing;
    const changed = () => {
      if (probe.correctionAt !== null || video.playbackRate <= 1.01 || video.playbackRate > 1.1) return;
      clearInterval(slowing); video.removeEventListener('ratechange', changed);
      probe.correctionAt = performance.now(); probe.correctionRate = video.playbackRate;
      setTimeout(() => { probe.pauseAt = performance.now(); video.pause(); }, 10);
    };
    video.addEventListener('ratechange', changed);
    slowing = setInterval(() => { if (!video.paused) video.playbackRate = .25; }, 25);
    setTimeout(() => { clearInterval(slowing); video.removeEventListener('ratechange', changed); }, 4000);
  });
  await guest.page.waitForFunction(() => window.partyRatePauseProbe?.pauseAt !== null);
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'paused');
  const correctedPause = await waitConverged(host, guest, { playing: false });
  await host.page.waitForTimeout(1000);
  const correctedHeld = await Promise.all([metrics(host.page), metrics(guest.page)]);
  assert.ok(correctedHeld.every((video, index) => video.paused && Math.abs(video.time - correctedPause[index].time) < .1), 'a rate correction must not discard an immediate native pause');
  const ratePause = await guest.page.evaluate(() => window.partyRatePauseProbe);
  assert.ok(ratePause.correctionRate > 1.01); assert.ok(ratePause.pauseAt - ratePause.correctionAt < 400);
  evidence.measurements.nativePause = { startPauseDelayMs: immediate.pauseAt - immediate.playingAt, correctionRate: ratePause.correctionRate, rateCorrectionPauseDelayMs: ratePause.pauseAt - ratePause.correctionAt, remainedPaused: true };
  t.diagnostic(`Native pause after coordinated start: ${(immediate.pauseAt - immediate.playingAt).toFixed(0)}ms; after ${ratePause.correctionRate.toFixed(3)}x correction: ${(ratePause.pauseAt - ratePause.correctionAt).toFixed(0)}ms. Both remained paused.`);
});

test('Ready to watch unlocks a real video after an autoplay refusal and preserves coordinated startup', { timeout: 45000 }, async t => {
  const fixture = await fixtureFor(t), host = await fixture.user('host'), guest = await fixture.user('guest');
  const created = await createParty(host); await joinParty(guest, created);
  await closePartyDialog(guest.page);
  await guest.page.locator('#video-slot video').evaluate(video => {
    const actualPlay = video.play.bind(video);
    window.partyAutoplayRefusals = 0;
    let unlocked = false;
    // Headless CI explicitly allows autoplay for the normal playback suites.
    // Reproduce the browser's NotAllowedError contract until the real Ready
    // click, then delegate every playback call to the actual media element.
    video.play = () => {
      if (!unlocked) { window.partyAutoplayRefusals++; return Promise.reject(new DOMException('A user gesture is required.', 'NotAllowedError')); }
      return actualPlay();
    };
    document.querySelector('#party-resume').addEventListener('click', () => { unlocked = true; }, { capture: true, once: true });
  });
  await host.page.locator('#party-play').click();
  await guest.page.waitForFunction(() => window.partyAutoplayRefusals > 0);
  await guest.page.locator('#party-resume').waitFor({ state: 'visible' });
  await host.page.waitForFunction(() => document.querySelector('#party-status').dataset.phase === 'paused');
  assert.equal((await metrics(host.page)).paused, true);
  await guest.page.locator('#party-resume').click();
  await waitConverged(host, guest, { playing: true });
  await guest.page.waitForFunction(() => document.querySelector('#video-slot video')?.getVideoPlaybackQuality().totalVideoFrames > 0);
  assert.equal(await guest.page.locator('#party-resume').isVisible(), false);
  evidence.measurements.ready = { simulatedBrowserAutoplayRefusals: await guest.page.evaluate(() => window.partyAutoplayRefusals), actualReadyGestureRecoveredRealPlayback: true };
});

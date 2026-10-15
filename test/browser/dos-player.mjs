import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createApp} from '../../server.mjs';

// An original real-mode COM program. It paints VGA mode 13h red and changes
// the whole screen's palette index when the DOS BIOS receives a key.
function originalCOM() {
  const code = [], labels = new Map(), fixups = [];
  const emit = (...bytes) => code.push(...bytes);
  const label = name => labels.set(name, code.length);
  const branch = (op, name) => { emit(op, 0); fixups.push({offset: code.length - 1, name}); };
  emit(0xb8, 0x13, 0x00, 0xcd, 0x10, 0xb8, 0x00, 0xa0, 0x8e, 0xc0, 0xb3, 0x04);
  label('paint'); emit(0x88, 0xd8, 0x31, 0xff, 0xb9, 0x00, 0xfa, 0xf3, 0xaa);
  label('wait'); emit(0xb4, 0x01, 0xcd, 0x16); branch(0x74, 'wait');
  emit(0xb4, 0x00, 0xcd, 0x16, 0xfe, 0xc3); branch(0xeb, 'paint');
  for (const fix of fixups) code[fix.offset] = (labels.get(fix.name) - fix.offset - 1) & 255;
  return Buffer.from(code);
}
function mouseCOM() {
  // Original VGA/BIOS fixture: poll the real DOS mouse driver with INT 33h,
  // showing magenta while its left button is down and red after release.
  const code = [], labels = new Map(), fixups = [];
  const emit = (...bytes) => code.push(...bytes), label = name => labels.set(name, code.length);
  const branch = (op, name) => { emit(op, 0); fixups.push({offset:code.length - 1, name}); };
  emit(0xb8,0x13,0x00,0xcd,0x10,0xb8,0x00,0xa0,0x8e,0xc0,0x31,0xc0,0xcd,0x33);
  label('poll'); emit(0xb8,0x03,0x00,0xcd,0x33,0xb0,0x04,0xf7,0xc3,0x01,0x00); branch(0x74,'paint'); emit(0xb0,0x05);
  label('paint'); emit(0x31,0xff,0xb9,0x00,0xfa,0xf3,0xaa); branch(0xeb,'poll');
  for (const fix of fixups) code[fix.offset] = (labels.get(fix.name) - fix.offset - 1) & 255;
  return Buffer.from(code);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const files = [], records = []; let offset = 0;
  for (const [path, value] of entries) {
    const name = Buffer.from(path), content = Buffer.isBuffer(value) ? value : Buffer.from(value), crc = crc32(content);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(content.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(content.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    files.push(local, name, content); records.push(central, name); offset += local.length + name.length + content.length;
  }
  const directory = Buffer.concat(records), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}
function bundleFor(program) { return zip([
  ['.jsdos/dosbox.conf', '[sdl]\n[dosbox]\nmemsize=16\n[cpu]\ncore=auto\ncycles=5000\n[mixer]\nrate=44100\n[autoexec]\n@echo off\nmount c .\nc:\nMAIN.COM\n'],
  ['.jsdos/jsdos.json', '{"version":"8"}'], ['MAIN.COM', program],
]); }
const bundle = bundleFor(originalCOM()), mouseBundle = bundleFor(mouseCOM());
const catalog = {version:1, items:[{id:'original-dos', title:'Original DOS test', platform:'dos', bundle:'games-data/original-dos.jsdos', controls:'Press any key to change the color.'}, {id:'master-mind', title:'Original mouse poll fixture', platform:'dos', bundle:'games-data/original-mouse.jsdos'}, {id:'original-mouse', title:'Original ordinary mouse fixture', platform:'dos', bundle:'games-data/original-mouse.jsdos'}]};
let server, browser, origin;
before(async () => {
  browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}), args:['--no-sandbox']});
  const app = createApp({env:{}});
  server = app.server;
  const handler = server.listeners('request')[0]; server.removeAllListeners('request');
  server.on('request', async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/extra-games-catalog.json' || path === '/key/extra-games-catalog.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(catalog)); return; }
    if (path === '/games-data/original-dos.jsdos' || path === '/key/games-data/original-dos.jsdos') { response.setHeader('Content-Type', 'application/octet-stream'); response.end(bundle); return; }
    if (path === '/games-data/original-mouse.jsdos' || path === '/key/games-data/original-mouse.jsdos') { response.setHeader('Content-Type', 'application/octet-stream'); response.end(mouseBundle); return; }
    if (path === '/host') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><iframe id="game" src="/dos-player.html?game=original-dos"></iframe>'); return; }
    // Pages publishes a second copy at /key/. Map that equivalent local path
    // into the actual production server handler, including its CSP headers.
    request.url = request.url.replace(/^\/key\//, '/');
    void handler(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
async function pageFor(t, path = '/dos-player.html?game=original-dos', {kid = false} = {}) {
  const context = await browser.newContext({serviceWorkers:'block'}), page = await context.newPage(), requests = [], errors = [];
  page.setDefaultTimeout(process.env.DOS_DEBUG ? 5000 : 25000); page.on('request', request => requests.push(request.url())); page.on('pageerror', error => errors.push(error.message));
  if (process.env.DOS_DEBUG) page.on('console', message => console.log('DOS console:', message.type(), message.text()));
  await context.route('https://**/*', route => route.abort());
  if (kid) await context.addInitScript(() => { localStorage.setItem('tw-viewer', 'viewer-1'); localStorage.setItem('torbox-parental-controls-v1', JSON.stringify({version:1, viewers:{'viewer-1':{enabled:true}}})); });
  t.after(async () => { if (process.env.DOS_DEBUG) console.log('DOS final:', await page.evaluate(() => ({state:document.body.dataset.state,status:document.querySelector('#dos-status')?.textContent}))); await context.close(); assert.deepEqual(errors, [], 'the isolated DOS player must not throw uncaught errors'); });
  await page.goto(origin + path);
  return {context, page, requests};
}
async function redScreen(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#dos-canvas'); if (canvas?.width !== 320 || canvas.height !== 200) return false;
    const pixel = canvas.getContext('2d').getImageData(160, 100, 1, 1).data;
    return pixel[0] > 100 && pixel[1] < 20 && pixel[2] < 20;
  });
}
async function pixel(page) { return page.locator('#dos-canvas').evaluate(canvas => Array.from(canvas.getContext('2d').getImageData(160, 100, 1, 1).data)); }

test('self-hosted DOSBox WASM executes real COM graphics and keyboard input under scoped CSP', async t => {
  const {page, requests} = await pageFor(t); await redScreen(page); const before = await pixel(page);
  await page.locator('#dos-canvas').focus(); await page.keyboard.press('a');
  await page.waitForFunction(before => { const canvas = document.querySelector('#dos-canvas'); return Array.from(canvas.getContext('2d').getImageData(160, 100, 1, 1).data).some((value, index) => value !== before[index]); }, before);
  assert.equal(await page.locator('body').getAttribute('data-state'), 'playing');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(csp.includes("'wasm-unsafe-eval'")); assert.equal(csp.includes("'unsafe-eval'"), false);
  const headers = (await page.request.get(origin + '/dos-player.html')).headers();
  assert.ok(headers['content-security-policy'].includes("'wasm-unsafe-eval'")); assert.ok(headers['content-security-policy'].includes("frame-ancestors 'self'"));
  assert.ok(requests.some(url => url.includes('wdosbox.wasm'))); assert.equal(requests.some(url => new URL(url).origin !== origin), false);
  assert.equal(requests.some(url => /\/(api|healthz|media)\//.test(new URL(url).pathname)), false);
});

test('pause and restart stop input and reboot the same approved DOS program', async t => {
  const {page} = await pageFor(t); await redScreen(page); const before = await pixel(page);
  await page.locator('#dos-pause').click(); await page.waitForFunction(() => document.body.dataset.state === 'paused');
  await page.locator('#dos-canvas').focus(); await page.keyboard.press('a'); await page.waitForTimeout(150); assert.deepEqual(await pixel(page), before);
  await page.locator('#dos-pause').click(); await page.waitForFunction(() => document.body.dataset.state === 'playing');
  await page.locator('#dos-canvas').focus(); await page.keyboard.press('a'); await page.waitForTimeout(150); assert.notDeepEqual(await pixel(page), before);
  await page.locator('#dos-restart').click(); await redScreen(page); assert.deepEqual(await pixel(page), before);
});

test('legacy key subpath uses only relative local emulator and bundle assets', async t => {
  const {page, requests} = await pageFor(t, '/key/dos-player.html?game=original-dos'); await redScreen(page);
  for (const request of requests) if (new URL(request).origin === origin) assert.ok(new URL(request).pathname.startsWith('/key/'), request);
});

test('unknown game identifiers and Kid Mode fail before a bundle or emulator can run', async t => {
  const first = await pageFor(t, '/dos-player.html?game=..%2fapi%2flogin');
  await first.page.waitForFunction(() => document.body.dataset.state === 'error'); assert.equal(first.requests.some(url => url.includes('vendor/dos/') || url.includes('.jsdos')), false);
  const second = await pageFor(t, '/dos-player.html?game=original-dos', {kid:true});
  await second.page.waitForFunction(() => document.body.dataset.state === 'error');
  assert.match(await second.page.locator('#dos-status').textContent(), /adult viewer/);
  assert.equal(second.requests.some(url => url.includes('vendor/dos/') || url.includes('.jsdos')), false);
});

test('only the same-origin parent can send emulator commands and receives actual frame status', async t => {
  const {page} = await pageFor(t, '/host'); const frame = page.frameLocator('#game');
  await frame.locator('#dos-canvas').waitFor(); await page.waitForFunction(() => document.querySelector('#game').contentDocument.querySelector('#dos-canvas').width === 320);
  await page.evaluate(() => { const child = document.querySelector('#game').contentWindow; child.dispatchEvent(new MessageEvent('message', {source:child, origin:location.origin, data:{type:'torbox-extra-command', command:'pause'}})); });
  assert.equal(await frame.locator('body').getAttribute('data-state'), 'playing');
  await page.evaluate(() => {
    window.dosStatuses = [];
    window.addEventListener('message', event => { if (event.source === document.querySelector('#game').contentWindow && event.data?.type === 'torbox-extra-status') window.dosStatuses.push(event.data); });
    document.querySelector('#game').contentWindow.postMessage({type:'torbox-extra-command', command:'pause'}, location.origin);
  });
  await frame.locator('body[data-state="paused"]').waitFor();
  await page.evaluate(() => document.querySelector('#game').contentWindow.postMessage({type:'torbox-extra-command', command:'resume'}, location.origin));
  await frame.locator('body[data-state="playing"]').waitFor();
  await page.waitForFunction(() => window.dosStatuses.some(status => status.state === 'playing' && status.frames > 0));
  await page.evaluate(() => { const child = document.querySelector('#game').contentWindow; child.postMessage({type:'torbox-extra-command', command:'key', key:65, pressed:true}, location.origin); child.postMessage({type:'torbox-extra-command', command:'key', key:65, pressed:false}, location.origin); });
  await page.waitForTimeout(120);
  await page.evaluate(() => document.querySelector('#game').contentWindow.postMessage({type:'torbox-extra-command', command:'close'}, location.origin));
  await frame.locator('body[data-state="paused"]').waitFor();
});

async function leftMouseDown(page) {
  const box = await page.locator('#dos-canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
}
async function magentaScreen(page) {
  await page.waitForFunction(() => { const canvas = document.querySelector('#dos-canvas'), color = canvas.getContext('2d').getImageData(160,100,1,1).data; return color[0] > 100 && color[1] < 20 && color[2] > 100; });
}
test('Master Mind short-click pulse reaches the actual DOS mouse driver, while other games release normally', async t => {
  const {page} = await pageFor(t, '/dos-player.html?game=master-mind'); await redScreen(page);
  await leftMouseDown(page); await page.waitForTimeout(120); await page.mouse.up();
  await magentaScreen(page); await page.waitForTimeout(30); assert.ok((await pixel(page))[2] > 100, 'a short tap remains observable by the DOS mouse poll');
  await redScreen(page);
  await page.goto(origin + '/dos-player.html?game=original-mouse'); await redScreen(page);
  await leftMouseDown(page); await magentaScreen(page); await page.mouse.up(); await redScreen(page);
});
test('pausing during a pending mouse pulse forces native release before resume and a new press', async t => {
  const {page} = await pageFor(t, '/dos-player.html?game=master-mind'); await redScreen(page);
  await leftMouseDown(page); await page.waitForTimeout(100); await page.mouse.up(); await magentaScreen(page);
  await page.locator('#dos-pause').click(); await page.waitForFunction(() => document.body.dataset.state === 'paused');
  await page.locator('#dos-pause').click(); await redScreen(page);
  await leftMouseDown(page); await magentaScreen(page); await page.waitForTimeout(400);
  assert.ok((await pixel(page))[2] > 100, 'a canceled old release cannot lift a later held native button');
  await page.mouse.up(); await redScreen(page);
});
test('canceling a Master Mind pointer before delayed down cannot fire a later native click', async t => {
  const {page} = await pageFor(t, '/dos-player.html?game=master-mind'); await redScreen(page);
  await leftMouseDown(page); await page.waitForTimeout(40);
  await page.locator('#dos-canvas').evaluate(canvas => canvas.dispatchEvent(new PointerEvent('pointercancel', {pointerId:1, pointerType:'mouse', button:0})));
  await page.mouse.up(); await page.waitForTimeout(220);
  const color = await pixel(page); assert.ok(color[0] > 100 && color[2] < 20, 'canceling before native down must leave the DOS button released');
});

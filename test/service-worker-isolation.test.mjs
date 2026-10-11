import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { LatestPlaybackAction } from '../public/playback-lifecycle.js';

test('100 rapid playback choices cancel older work and only the latest can commit', () => {
  const choices = new LatestPlaybackAction();
  const actions = Array.from({ length: 100 }, () => choices.begin());
  for (const old of actions.slice(0, -1)) { assert.equal(old.signal.aborted, true); assert.throws(() => old.check(), { name: 'AbortError' }); }
  assert.equal(actions.at(-1).current(), true);
  actions[0].finish();
  assert.equal(actions.at(-1).current(), true);
  choices.cancel();
  assert.equal(actions.at(-1).current(), false);
});

for (const cached of [true, false]) {
  test(`offline Sports frame ${cached ? 'uses its isolated shell' : 'fails closed without the movie shell'}`, async () => {
    const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
    const scope = 'https://to-shreds.github.io/torbox-web-player/';
    const handlers = {}, matches = [];
    const self = { registration: { scope }, location: { origin: new URL(scope).origin }, addEventListener: (name, handler) => { handlers[name] = handler; } };
    const request = { url: scope + 'sports-player.html?v=release-1.2.2-buffstreams.1', method: 'GET', mode: 'navigate' };
    vm.runInNewContext(source, { self, URL, Response, Request: class { constructor(input) { Object.assign(this, input); } }, fetch: async () => { throw new Error('offline'); }, caches: { open: async () => ({ match: async input => { matches.push(input); return cached ? new Response('isolated sports shell') : undefined; } }) } });
    let response;
    handlers.fetch({ request, respondWith: promise => { response = promise; } });
    const result = await response;
    assert.equal(result.status, cached ? 200 : 503);
    assert.equal(await result.text(), cached ? 'isolated sports shell' : 'Sports player unavailable offline.');
    assert.deepEqual(matches, [request]);
  });
}

test('service worker activation preserves other GitHub Pages apps and the legacy key scope', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const scope = 'https://to-shreds.github.io/torbox-web-player/';
  const own = 'torbox-player:' + scope + ':';
  const names = [own + 'old', own + 'release-1.2.2-buffstreams.1', 'arcade-v1', 'facebatch-assets', 'torbox-player:' + scope + 'key/:old'];
  const deleted = [], handlers = {};
  const self = { registration: { scope }, clients: { claim: async () => {} }, addEventListener: (name, handler) => { handlers[name] = handler; } };
  vm.runInNewContext(source, { self, URL, Request, caches: { keys: async () => names, delete: async name => { deleted.push(name); } } });
  let done;
  handlers.activate({ waitUntil: promise => { done = promise; } });
  await done;
  assert.deepEqual(deleted, [own + 'old']);
});

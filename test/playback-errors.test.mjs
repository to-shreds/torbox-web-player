import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePlaybackFailure, matchesFormat } from '../public/playback-errors.js';
const path = '/media/' + 'a'.repeat(43);
const reply = (status, type = 'video/mp4', callback = () => {}) => ({ status, headers: new Headers({ 'content-type': type }), body: { cancel: async () => callback() } });
test('MP4 filtering is case insensitive and never labels MKV or AVI as MP4', () => {
  assert.ok(matchesFormat({ title: 'Movie.MP4' }, 'mp4'));
  assert.equal(matchesFormat({ title: 'Movie.mkv', mime: 'video/mp4' }, 'mp4'), false);
  assert.equal(matchesFormat({ title: 'Movie.avi' }, 'mp4'), false);
  assert.ok(matchesFormat({ title: 'Movie.mkv' }, 'all'));
});
test('MP4 filter tolerates missing titles without claiming compatibility', () => {
  assert.equal(matchesFormat({}, 'mp4'), false);
  assert.ok(matchesFormat({}, 'all'));
});
test('arbitrary URLs and altered media paths are never fetched', async () => {
  for (const url of ['https://outside.example/video', '/media/short', path + '?url=x', '//outside.example/video', path + '/extra']) {
    const result = await diagnosePlaybackFailure(url, 4, () => { assert.fail('unexpected request'); });
    assert.equal(result.kind, 'session');
  }
});
test('user cancellation does not trigger a diagnostic request', async () => {
  assert.equal((await diagnosePlaybackFailure(path, 1, () => { assert.fail(); })).kind, 'cancelled');
});
test('only a bounded same-origin no-cache media check is requested', async () => {
  let cancelled = false;
  await diagnosePlaybackFailure(path, 4, async (url, options) => {
    assert.equal(url, path); assert.equal(options.headers.Range, 'bytes=0-0');
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    return reply(206, 'video/mp4', () => { cancelled = true; });
  });
  assert.ok(cancelled);
});
test('reachable stream plus browser decode rejection stops pointless renewal advice', async () => {
  for (const code of [3, 4]) {
    const result = await diagnosePlaybackFailure(path, code, async () => reply(206, 'video/x-matroska'));
    assert.equal(result.kind, 'codec'); assert.equal(result.retry, false);
    assert.ok(result.message.includes('does not convert')); assert.ok(result.message.includes('Show MP4 files'));
  }
});
test('401 is a household-session error, not a codec error', async () => {
  const result = await diagnosePlaybackFailure(path, 4, async () => reply(401, 'application/json'));
  assert.equal(result.kind, 'session'); assert.ok(result.message.includes('Sign in'));
});
test('404 is a missing playback session, not a codec error', async () => {
  const result = await diagnosePlaybackFailure(path, 4, async () => reply(404));
  assert.equal(result.kind, 'session'); assert.equal(result.retry, true);
});
test('429 is explicitly rate limiting', async () => {
  const result = await diagnosePlaybackFailure(path, 4, async () => reply(429));
  assert.equal(result.kind, 'network'); assert.ok(result.message.includes('rate limited'));
});
test('server failures are not mislabeled as incompatible codecs', async () => {
  for (const status of [400, 403, 416, 500, 502, 504]) {
    const result = await diagnosePlaybackFailure(path, 4, async () => reply(status));
    assert.equal(result.kind, 'network'); assert.equal(result.retry, true); assert.ok(result.message.includes(String(status)));
  }
});
test('successful HTML or JSON responses are not assumed to be video', async () => {
  for (const type of ['text/html', 'application/json']) {
    const result = await diagnosePlaybackFailure(path, 4, async () => reply(200, type));
    assert.equal(result.kind, 'network');
  }
});
test('a recovered network failure does not become a codec diagnosis', async () => {
  const result = await diagnosePlaybackFailure(path, 2, async () => reply(206));
  assert.equal(result.kind, 'network'); assert.equal(result.retry, true);
});
test('an unknown browser error stays unknown even if its stream is reachable', async () => {
  const result = await diagnosePlaybackFailure(path, undefined, async () => reply(206));
  assert.equal(result.kind, 'unknown');
});
test('network failures and timeout text remain redacted', async () => {
  const result = await diagnosePlaybackFailure(path, 4, async () => { throw new Error('private-url-and-token'); });
  assert.equal(result.kind, 'network'); assert.ok(!JSON.stringify(result).includes('private-url-and-token'));
});
test('response cleanup also occurs for failed HTTP statuses', async () => {
  let cancelled = false;
  await diagnosePlaybackFailure(path, 4, async () => reply(502, 'application/json', () => { cancelled = true; }));
  assert.ok(cancelled);
});

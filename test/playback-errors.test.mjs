import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosePlaybackFailure, matchesFormat } from '../public/playback-errors.js';
const direct = 'https://store-034.wnam.tb-cdn.io/file?token=exposed-by-user-choice';
test('MP4 filtering is case insensitive and never labels MKV or AVI as MP4', () => {
  assert.ok(matchesFormat({ title: 'Movie.MP4' }, 'mp4'));
  assert.equal(matchesFormat({ title: 'Movie.mkv', mime: 'video/mp4' }, 'mp4'), false);
  assert.equal(matchesFormat({ title: 'Movie.avi' }, 'mp4'), false);
  assert.ok(matchesFormat({ title: 'Movie.mkv' }, 'all'));
});
test('MP4 filter tolerates missing titles without claiming compatibility', () => {
  assert.equal(matchesFormat({}, 'mp4'), false); assert.ok(matchesFormat({}, 'all'));
});
test('only verified TorBox CDN hosts are accepted as direct media', async () => {
  for (const url of ['https://outside.example/video','http://store.tb-cdn.io/file','https://tb-cdn.io.evil.test/file','/media/'+'a'.repeat(43)]) assert.equal((await diagnosePlaybackFailure(url,4)).kind,'session');
  assert.equal((await diagnosePlaybackFailure(direct,4)).kind,'codec');
});
test('user cancellation remains distinct', async () => { assert.equal((await diagnosePlaybackFailure(direct,1)).kind,'cancelled'); });
test('network media error recommends a fresh TorBox link once', async () => {
  const r=await diagnosePlaybackFailure(direct,2); assert.equal(r.kind,'network'); assert.equal(r.retry,true); assert.ok(/New playback link/.test(r.message));
});
test('browser codec rejection does not suggest Render relay or repeated renewal', async () => {
  for(const code of [3,4]) { const r=await diagnosePlaybackFailure(direct,code); assert.equal(r.kind,'codec'); assert.equal(r.retry,false); assert.ok(/does not convert/.test(r.message)); assert.ok(!/relay/i.test(r.message)); }
});
test('unknown direct failure remains a direct network failure', async () => {
  const r=await diagnosePlaybackFailure(direct,undefined); assert.equal(r.kind,'network'); assert.equal(r.retry,true);
});

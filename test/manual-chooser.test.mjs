import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentPlaybackSource } from '../public/discover.js';

test('manual source identity survives refreshed selection tokens without mistaking another file for the current copy',()=>{
  const hash='a'.repeat(40),other='b'.repeat(40);
  const playing={id:'original-token',hash,filename:'Series.S01E01.720p.AAC.mp4'};
  assert.equal(isCurrentPlaybackSource({id:'original-token',hash,filename:playing.filename},playing),true);
  assert.equal(isCurrentPlaybackSource({id:'refreshed-token',hash,filename:'series.s01e01.720p.aac.mp4'},playing),true);
  assert.equal(isCurrentPlaybackSource({id:'other-token',hash,filename:'Series.S01E01.OtherFile.mp4'},playing),false);
  assert.equal(isCurrentPlaybackSource({id:'other-token',hash:other,filename:playing.filename},playing),false);
  assert.equal(isCurrentPlaybackSource(null,playing),false);
  assert.equal(isCurrentPlaybackSource({id:'other-token'},playing),false);
});

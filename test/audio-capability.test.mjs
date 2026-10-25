import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsAudioDecodeCounter } from '../public/playback-lifecycle.js';
import { validatePreparedSource, recoverySourceOrder, sourcesForAudioRequirement, automaticCachedSourceOrder, resolveAutomaticCachedSource, boundedRecoverySourceOrder, browserPreparationOptions, AUTOMATIC_SOURCE_CANDIDATES } from '../public/discover.js';
import { sourceHints } from '../public/source-client.js';
import { applySourceMemory } from '../public/source-memory.js';

test('audio monitoring is available only for a readable native decoded-byte counter', () => {
  for (const bytes of [0, 1024]) assert.equal(supportsAudioDecodeCounter({ webkitAudioDecodedByteCount: bytes }), true);
  for (const bytes of [undefined, null, NaN, Infinity, -1, '0']) assert.equal(supportsAudioDecodeCounter({ webkitAudioDecodedByteCount: bytes }), false);
  assert.equal(supportsAudioDecodeCounter(null), false);
  assert.equal(supportsAudioDecodeCounter({ get webkitAudioDecodedByteCount() { throw new Error('unavailable'); } }), false);
});

test('torrent-wide Sound works feedback cannot attest an unknown prepared episode file', () => {
  const source = { hash: 'a'.repeat(40), filename: 'Fixture.Show.S01.H264.mkv', memoryAudio: 'good' };
  const unknown = { file: { title: 'Fixture.Show.S01E02.H264.mkv' } };
  assert.throws(() => validatePreparedSource(source, unknown, { unattended: true, requireCompatibleAudio: true }), { code: 'AUDIO_COMPATIBILITY_UNCONFIRMED' });
  assert.equal(validatePreparedSource(source, unknown, { unattended: true }).audioCompatible, false, 'native audio monitoring can still test a bounded unknown source');
  const compatible = { file: { title: 'Fixture.Show.S01E02.H264.AAC.mkv' } };
  assert.equal(validatePreparedSource(source, compatible, { unattended: true, requireCompatibleAudio: true }).audioCompatible, true);
});

test('all automatic recovery paths prefer available sound across resolution tiers', () => {
  const row = (hash, filename) => ({ hash: hash.repeat(40), filename, cached: true, ...sourceHints({ filename }) });
  const current = row('a', 'Current.720p.H264.AAC.mp4');
  const unknown = row('b', 'Other.480p.H264.mkv');
  const compatible = row('c', 'Alternative.1080p.H264.AAC.mp4');
  for (const audioRecovery of [false, true]) {
    const context = { sourceInfo: current, resolution: '720p', audioRecovery };
    assert.deepEqual(recoverySourceOrder([unknown, current, compatible], context).map(source => source.hash), [compatible.hash, unknown.hash]);
  }
});

function candidate(id, { audio = false, memoryAudio = 'unknown' } = {}) {
  const filename = `Fixture.Show.S01E02.720p.H264${audio ? '.AAC' : ''}.mkv`;
  return { id: String(id), hash: id.toString(16).padStart(40, '0'), filename, cached: true,
    cachedBrowserPlayable: true, memoryAudio, ...sourceHints({ filename }) };
}

test('strict audio ordering preserves stored feedback and ordinary counter-aware ranking', () => {
  const unknown = Object.freeze(candidate(1, { memoryAudio: 'good' }));
  const compatible = Object.freeze(candidate(2, { audio: true, memoryAudio: 'good' }));
  const rows = Object.freeze([unknown, compatible]);
  assert.equal(sourcesForAudioRequirement(rows), rows);
  const strict = sourcesForAudioRequirement(rows, true);
  assert.equal(strict[0].memoryAudio, 'unknown');
  assert.equal(unknown.memoryAudio, 'good', 'the original source and saved feedback must not be changed');
  assert.notEqual(strict[0], unknown);
  assert.equal(strict[1], compatible, 'compatible sound retains its additional positive feedback');
  assert.equal(sourcesForAudioRequirement(rows, false)[0].memoryAudio, 'good');
  assert.deepEqual(sourcesForAudioRequirement(null, true), []);
});

test('eight stale sound confirmations cannot hide compatible audio beyond the strict preparation cap', async () => {
  const stale = Array.from({ length: AUTOMATIC_SOURCE_CANDIDATES }, (_, index) => candidate(index + 1, { memoryAudio: 'good' }));
  const aac = candidate(9, { audio: true }), rows = [...stale, aac], tried = [];
  assert.equal(automaticCachedSourceOrder(sourcesForAudioRequirement(rows, false))[0].id, stale[0].id,
    'normal observable playback retains the existing confirmation preference');
  const result = await resolveAutomaticCachedSource(sourcesForAudioRequirement(rows, true), { type: 'series' }, '720p', {
    prepare: async source => {
      tried.push(source.id);
      const prepared = { state: 'ready', file: { id: source.id, title: source.filename } };
      validatePreparedSource(source, prepared, { unattended: true, requireCompatibleAudio: true });
      return prepared;
    }
  });
  assert.equal(result.source.id, aac.id);
  assert.deepEqual(tried, [aac.id]);
  assert.ok(stale.every(source => source.memoryAudio === 'good'));
});

test('two stale confirmations cannot consume the remaining audio-recovery slots ahead of AAC', () => {
  const current = candidate(1), stale = [candidate(2, { memoryAudio: 'good' }), candidate(3, { memoryAudio: 'good' })];
  const aac = candidate(4, { audio: true }), context = { sourceInfo: current, resolution: '720p', audioRecovery: true };
  const selected = boundedRecoverySourceOrder(sourcesForAudioRequirement([...stale, aac], true), context);
  assert.equal(selected.length, 2, 'the existing three-source total attempt limit is unchanged');
  assert.equal(selected[0].id, aac.id);
  assert.equal(validatePreparedSource(selected[0], { file: { title: selected[0].filename } },
    { unattended: true, requireCompatibleAudio: true }).audioCompatible, true);
  assert.ok(stale.every(source => source.memoryAudio === 'good'));
});

test('strict ranking still permits a bounded unknown candidate when its actual prepared file establishes AAC', async () => {
  const unknown = candidate(1, { memoryAudio: 'good' });
  const result = await resolveAutomaticCachedSource(sourcesForAudioRequirement([unknown], true), { type: 'series' }, '720p', {
    prepare: async source => {
      const prepared = { state: 'ready', file: { id: 'actual-file', title: 'Fixture.Show.S01E02.720p.H264.AAC.mkv' } };
      assert.equal(validatePreparedSource(source, prepared, { unattended: true, requireCompatibleAudio: true }).audioCompatible, true);
      return prepared;
    }
  });
  assert.equal(result.result.file.id, 'actual-file');
  assert.equal(unknown.memoryAudio, 'good');
});

test('strict fallback offers uncached AAC within three choices while preserving explicit foreign choices and saved feedback', () => {
  const target = { type: 'series', id: 'tt1234567', season: 1, episode: 2 };
  const stale = [candidate(1), candidate(2), candidate(3)];
  const aac = { ...candidate(4, { audio: true }), cached: false, languages: ['en'] };
  const foreign = { ...candidate(5, { audio: true }), languages: ['fr'] };
  const key = 'torbox-source-memory-v1';
  const saved = JSON.stringify({ titles: { 'series:tt1234567': {
    sources: Object.fromEntries(stale.map(source => [source.hash, { audio: 'good', successes: 3 }]))
  } } });
  const data = new Map([[key, saved]]), writes = [];
  const store = { getItem: key => data.get(key), setItem: (key, value) => { writes.push(key); data.set(key, value); } };
  const remembered = applySourceMemory(target, [...stale, aac, foreign], store);
  const choices = browserPreparationOptions(sourcesForAudioRequirement(remembered, true), 'series', '720p', 'balanced', 3);
  assert.equal(choices.length, 3);
  assert.equal(choices[0].id, aac.id, 'compatible uncached audio must remain available through explicit Prepare & Play');
  assert.ok(choices.some(source => source.id === foreign.id), 'foreign-only audio remains an explicit choice');
  assert.ok(remembered.slice(0, 3).every(source => source.memoryAudio === 'good'));
  assert.deepEqual(writes, []);
  assert.equal(data.get(key), saved);
  const unattended = automaticCachedSourceOrder(sourcesForAudioRequirement(remembered, true), 'series', '720p');
  assert.ok(unattended.every(source => source.id !== aac.id && source.id !== foreign.id),
    'uncached and foreign-only choices must still be excluded from unattended playback');
});

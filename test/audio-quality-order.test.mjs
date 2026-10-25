import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceHints } from '../public/source-client.js';
import { automaticCachedSourceOrder, browserPreparationOptions, resolveAutomaticCachedSource, AUTOMATIC_SOURCE_CANDIDATES } from '../public/discover.js';

function source(id, { resolution = '720p', audio = '', ...extra } = {}) {
  const filename = `Fixture.Show.S01E01.${resolution}.H264${audio ? '.' + audio : ''}.${audio === 'AAC' ? 'mp4' : 'mkv'}`;
  const row = { id: String(id), hash: id.toString(16).padStart(40, '0'), filename, title: filename,
    resolution, cached: true, cachedBrowserPlayable: true, languages: ['en'], ...extra };
  return { ...row, ...sourceHints(row) };
}

test('initial playback puts compatible audio ahead of eight unknown copies at the requested quality', () => {
  const unknown = Array.from({ length: AUTOMATIC_SOURCE_CANDIDATES }, (_, index) => source(index + 1));
  const aac = source(9, { resolution: '1080p', audio: 'AAC' });
  const ordered = automaticCachedSourceOrder([...unknown, aac], 'series', '720p');
  assert.equal(ordered[0].id, aac.id);
  assert.equal(ordered.length, unknown.length + 1);
  assert.ok(ordered.slice(0, AUTOMATIC_SOURCE_CANDIDATES).some(row => row.id === aac.id));
});

test('the bounded automatic preparation reaches AAC that previously fell beyond its candidate cap', async () => {
  const unknown = Array.from({ length: AUTOMATIC_SOURCE_CANDIDATES }, (_, index) => source(index + 1));
  const aac = source(9, { resolution: '1080p', audio: 'AAC' }), tried = [];
  const result = await resolveAutomaticCachedSource([...unknown, aac], { type: 'series' }, '720p', {
    prepare: async row => {
      tried.push(row.id);
      if (row.id !== aac.id) {
        const error = new Error('The prepared file has no compatible audio evidence.');
        error.code = 'AUDIO_COMPATIBILITY_UNCONFIRMED';
        throw error;
      }
      return { state: 'ready', file: { id: 'exact-aac-file', title: aac.filename } };
    }
  });
  assert.equal(result.source.id, aac.id);
  assert.deepEqual(tried, [aac.id]);
});

test('requested quality still wins among equally compatible audio candidates', () => {
  const aac720 = source(1, { audio: 'AAC' }), aac1080 = source(2, { resolution: '1080p', audio: 'AAC' });
  for (const choose of [automaticCachedSourceOrder, browserPreparationOptions]) {
    assert.deepEqual(choose([aac1080, aac720], 'series', '720p').map(row => row.id), [aac720.id, aac1080.id]);
    assert.deepEqual(choose([aac720, aac1080], 'series', '1080p').map(row => row.id), [aac1080.id, aac720.id]);
  }
});

test('confirmed device sound precedes unconfirmed AAC across qualities', () => {
  const aac = source(1, { audio: 'AAC' });
  const confirmed = source(2, { resolution: '1080p', memoryAudio: 'good' });
  for (const choose of [automaticCachedSourceOrder, browserPreparationOptions]) {
    assert.deepEqual(choose([aac, confirmed], 'series', '720p').map(row => row.id), [confirmed.id, aac.id]);
  }
});

test('explicit fallback keeps a three-choice limit while offering compatible audio first across qualities', () => {
  const unknown = Array.from({ length: 8 }, (_, index) => source(index + 1));
  const aac = source(9, { resolution: '1080p', audio: 'AAC' });
  const choices = browserPreparationOptions([...unknown, aac], 'series', '720p', 'balanced', 3);
  assert.equal(choices.length, 3);
  assert.equal(choices[0].id, aac.id);
  assert.equal(browserPreparationOptions([...unknown, aac], 'series', '720p', 'balanced', 0).length, 0);
});

test('audio ordering retains cached-only and foreign-language boundaries for unattended playback', () => {
  const cached = source(1), unavailable = source(2, { audio: 'AAC', cached: false });
  const cacheUnknown = source(3, { audio: 'AAC', cached: null });
  const foreign = source(4, { audio: 'AAC', languages: ['fr'] });
  const rows = [unavailable, foreign, cached, cacheUnknown];
  assert.deepEqual(automaticCachedSourceOrder(rows, 'series', '720p').map(row => row.id), [cacheUnknown.id, cached.id]);
  // These choices remain available only through the existing explicit fallback.
  const explicit = browserPreparationOptions([cached, unavailable, foreign], 'series', '720p');
  assert.deepEqual(new Set(explicit.map(row => row.id)), new Set([cached.id, unavailable.id, foreign.id]));
});

test('positive sound feedback cannot admit known codec risks or rejected sources', () => {
  const aac = source(1, { audio: 'AAC' });
  const rejected = [
    source(2, { audio: 'DDP5.1', memoryAudio: 'good' }),
    { ...source(3, { audio: 'AAC', memoryAudio: 'good' }), videoRisk: true },
    { ...source(4, { audio: 'AAC', memoryAudio: 'good' }), browserUnsupported: true },
    { ...source(5, { audio: 'AAC', memoryAudio: 'good' }), cachedBrowserPlayable: false },
    source(6, { audio: 'AAC', memoryAudio: 'good', memoryBad: true }),
    source(7, { audio: 'AAC', memoryAudio: 'bad' })
  ];
  for (const choose of [automaticCachedSourceOrder, browserPreparationOptions]) {
    assert.deepEqual(choose([...rejected, aac], 'series', '720p').map(row => row.id), [aac.id]);
  }
});

test('cross-quality ordering still deduplicates the same source recovery key', () => {
  const unknown = source(1), compatibleSameKey = source(1, { resolution: '1080p', audio: 'AAC' });
  const other = source(2, { audio: 'AAC' });
  for (const choose of [automaticCachedSourceOrder, browserPreparationOptions]) {
    const choices = choose([unknown, compatibleSameKey, other], 'series', '720p');
    assert.deepEqual(choices.map(row => row.id), [other.id, compatibleSameKey.id]);
    assert.equal(choices.find(row => row.id === compatibleSameKey.id).filename, compatibleSameKey.filename);
  }
});

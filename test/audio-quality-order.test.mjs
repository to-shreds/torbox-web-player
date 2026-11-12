import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceHints } from '../public/source-client.js';
import { automaticCachedSourceOrder, browserPreparationOptions, resolveAutomaticCachedSource, preferSameTorrent, AUTOMATIC_SOURCE_CANDIDATES } from '../public/discover.js';

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

test('the next episode prefers the same cached torrent over an otherwise higher-ranked compatible copy',async()=>{
  const other=source(1,{resolution:'720p',audio:'AAC',size:350000000});
  const pack=source(2,{resolution:'1080p',audio:'AAC',size:2500000000});
  const normally=automaticCachedSourceOrder([other,pack],'series','720p');
  assert.equal(normally[0].hash,other.hash,'ordinary choice still prefers the normal source');
  assert.equal(preferSameTorrent(normally,pack.hash)[0].hash,pack.hash);
  const attempted=[];
  const chosen=await resolveAutomaticCachedSource([other,pack],{type:'series'},'720p',{
    preferredTorrentHash:pack.hash,prepare:async candidate=>{
      attempted.push(candidate.hash);return{state:'ready',file:{id:'exact-episode-file'}};
    }
  });
  assert.equal(chosen.source.hash,pack.hash);assert.deepEqual(attempted,[pack.hash]);
  const movie=await resolveAutomaticCachedSource([other,pack],{type:'movie'},'720p',{
    preferredTorrentHash:pack.hash,prepare:async candidate=>({state:'ready',file:{id:candidate.id}})
  });
  assert.equal(movie.source.hash,other.hash,'same-torrent preference must not affect movies or ordinary playback');
});

test('same-torrent preference never overrides known audio, container, language or cache hazards',()=>{
  const safe=source(1,{audio:'AAC'}),hash=source(2,{audio:'AAC'}).hash;
  for(const unsafe of [
    source(2,{audio:'DDP5.1'}),
    {...source(2,{audio:'AAC'}),cached:false},
    {...source(2,{audio:'AAC'}),cachedBrowserPlayable:false},
    {...source(2,{audio:'AAC'}),memoryBad:true},
    {...source(2,{audio:'AAC'}),memoryAudio:'bad'},
    {...source(2,{audio:'AAC'}),browserUnsupported:true},
    {...source(2,{audio:'AAC'}),videoRisk:true},
    {...source(2,{audio:'AAC'}),languages:['ru']}
  ])assert.deepEqual(preferSameTorrent([safe,unsafe],hash).map(x=>x.id),[safe.id,unsafe.id]);
  assert.equal(preferSameTorrent([safe,source(2)],hash,true)[0].id,safe.id,
    'a browser without decoder telemetry must not promote unknown-audio files');
  assert.equal(preferSameTorrent([safe,source(2,{audio:'AAC'})],hash,true)[0].id,'2');
  assert.equal(preferSameTorrent([safe,source(2,{audio:'AAC'})],'not-a-hash')[0].id,safe.id);
});

test('a preferred season-pack failure still checks a compatible alternative without uncached writes',async()=>{
  const pack=source(2,{resolution:'1080p',audio:'AAC'}),other=source(1,{audio:'AAC'});
  const attempted=[];
  const chosen=await resolveAutomaticCachedSource([other,pack],{type:'series'},'720p',{
    preferredTorrentHash:pack.hash,prepare:async candidate=>{
      attempted.push(candidate.hash);
      if(candidate.hash===pack.hash){const error=new Error('Next episode file not present in this pack');error.code='PREPARED_ITEM_MISSING';throw error;}
      return{state:'ready',file:{id:'the-correct-episode'}};
    }
  });
  assert.equal(chosen.source.hash,other.hash);assert.deepEqual(attempted,[pack.hash,other.hash]);
});

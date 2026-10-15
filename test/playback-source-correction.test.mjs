import test from 'node:test';
import assert from 'node:assert/strict';
import { StremioSourceLookup, PUBLIC_STREMIO_PROVIDERS, normalizeStremioStreams, normalizeIndexRows, mergeProviderSources } from '../lib/source-lookup.mjs';
import { Discovery, cachedBrowserFit } from '../lib/discovery.mjs';
import { browserContainerHints, sourceHints } from '../public/source-client.js';

const HASH = 'a'.repeat(40);
const targets = [
  { type: 'movie', id: 'tt1160419', suffix: 'movie/tt1160419.json' },
  { type: 'series', id: 'tt33043892', season: 1, episode: 2, suffix: 'series/tt33043892:1:2.json' }
];
// Literal deployed endpoint prefixes are intentional: deriving expectations
// through the production URL helper would reproduce its lost-prefix defect.
const endpoints = [
  ['stremthru-main', 'https://stremthru.13377001.xyz/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==/stream/'],
  ['stremthru-elfhosted', 'https://stremthru.elfhosted.com/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==/stream/'],
  ['mediafusion', 'https://mediafusion.elfhosted.com/stream/'],
  ['comet', 'https://comet.elfhosted.com/stream/']
];

for (const [id, endpoint] of endpoints) for (const target of targets) test(`${id} ${target.type} lookup preserves its complete configured resource endpoint`, async () => {
  const provider = PUBLIC_STREMIO_PROVIDERS.find(row => row.id === id);
  assert.ok(provider);
  const calls = [];
  const lookup = new StremioSourceLookup({ ...provider, fetchFn: async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ streams: [{ infoHash: HASH, title: 'Fixture.H264.AAC', behaviorHints: { filename: target.type === 'series' ? 'Fixture.S01E02.H264.AAC.mp4' : 'Fixture.H264.AAC.mp4' } }] });
  } });
  const result = await lookup.lookup({ ...target, apiKey: 'must-not-leave-player', url: 'https://untrusted.invalid' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, endpoint + target.suffix);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(calls[0].options.body, undefined);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.sources[0].hash, HASH);
  assert.equal(result.sources[0].provider, provider.name);
  assert.ok(!JSON.stringify(calls).includes('must-not-leave-player'));
  assert.ok(!JSON.stringify(calls).includes('untrusted.invalid'));
});

test('configured Stremio resources still decline redirects without forwarding credentials or changing destination', async () => {
  for (const [id, endpoint] of endpoints) {
    const provider = PUBLIC_STREMIO_PROVIDERS.find(row => row.id === id);
    const calls = [];
    const lookup = new StremioSourceLookup({ ...provider, fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(null, { status: 307, headers: { location: 'https://untrusted.invalid/configure' } });
    } });
    await assert.rejects(lookup.lookup(targets[0]), error => error.code === 'SOURCE_REQUIRES_CONFIGURATION');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, endpoint + targets[0].suffix);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.credentials, 'omit');
    assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
    await assert.rejects(lookup.lookup(targets[1]), error => error.code === 'SOURCE_PROVIDER_COOLDOWN');
    assert.equal(calls.length, 1, 'a configuration redirect retains the existing provider cooldown');
  }
});

test('Matroska filename and MIME metadata permit a conditional native playback attempt', () => {
  for (const source of [
    { filename: 'Fixture.H264.AAC.mkv', mime: 'application/octet-stream' },
    { container: 'mkv' },
    { mime: 'video/x-matroska' },
    { mime: 'video/matroska; codecs="avc1.42E01E,mp4a.40.2"' }
  ]) {
    assert.deepEqual(browserContainerHints(source), {
      container: 'mkv', browserContainer: true, browserUnsupported: false, containerStatus: 'conditional'
    });
  }
  for (const filename of ['Fixture.mp4', 'Fixture.webm']) assert.equal(browserContainerHints({ filename }).containerStatus, 'supported');
  assert.equal(browserContainerHints({ filename: 'Fixture.H264.AAC.avi' }).browserUnsupported, true);
});

test('conditional Matroska preserves codec risk instead of claiming every MKV will decode', () => {
  for (const audio of ['AAC', 'Opus']) {
    const hints = sourceHints({ filename: `Fixture.H264.${audio}.mkv` });
    assert.equal(hints.browserFriendly, true);
    assert.equal(hints.audioRisk, false);
    assert.equal(hints.videoRisk, false);
    assert.equal(hints.containerStatus, 'conditional');
  }
  const risky = sourceHints({ filename: 'Fixture.HEVC.DTS.mkv' });
  assert.equal(risky.browserUnsupported, false);
  assert.equal(risky.browserFriendly, false);
  assert.equal(risky.audioRisk, true);
  assert.equal(risky.videoRisk, true);
  assert.equal(risky.containerStatus, 'conditional');
});

const episodeTarget = { type: 'series', id: 'tt33043892', season: 1, episode: 2 };
function matroskaFixture({ audio = 'AAC', extension = 'mkv', episode = 2 } = {}) {
  const filename = `Dexter.Resurrection.S01E02.H264.${audio}.mkv`;
  const actualName = `Dexter.Resurrection.S01E0${episode}.H264.${audio}.${extension}`;
  const actualMime = extension === 'avi' ? 'video/x-msvideo' : 'video/x-matroska';
  const cache = { cached: true, files: [{ name: actualName, mime: actualMime }] };
  const calls = [];
  const item = { id: 42, hash: HASH, name: 'Dexter Resurrection', download_finished: true, download_present: true,
    files: [{ id: 7, name: actualName, mimetype: actualMime, size: 100 }] };
  const discovery = new Discovery({
    catalog: { meta: async () => ({ ...episodeTarget, name: 'Dexter: Resurrection', year: '2025', episodes: [{ season: 1, episode: 2, released: '2025-07-18' }] }) },
    gateway: {
      cached: async () => ({ [HASH]: cache }),
      find: async () => null,
      create: async (hash, onlyCached) => { calls.push({ hash, onlyCached }); return 42; },
      item: async () => item
    }
  });
  return { discovery, calls, cache, source: { infoHash: HASH, filename } };
}

for (const audio of ['AAC', 'Opus', 'DTS']) test(`cached H264/${audio} MKV registers and reaches ready while retaining conditional compatibility`, async () => {
  const { discovery, calls, cache, source } = matroskaFixture({ audio });
  assert.equal(cachedBrowserFit(cache, episodeTarget, source), true);
  const registered = await discovery.register({ target: episodeTarget, sources: [source] }, 'owner');
  assert.equal(calls.length, 0, 'registration never adds a torrent');
  const [row] = registered.sources;
  assert.equal(row.cached, true);
  assert.equal(row.cachedBrowserPlayable, true);
  assert.equal(row.browserUnsupported, false);
  assert.equal(row.containerStatus, 'conditional');
  assert.equal(row.audioRisk, audio === 'DTS');
  await assert.rejects(discovery.prepare(row.id, 'other-session', true), error => error.code === 'SOURCE_EXPIRED');
  assert.equal(calls.length, 0);
  const prepared = await discovery.prepare(row.id, 'owner', true);
  assert.equal(prepared.state, 'ready');
  assert.equal(prepared.file.id, 'torrents:42:7');
  assert.equal(prepared.compatibility.containerStatus, 'conditional');
  assert.equal(prepared.compatibility.browserUnsupported, false);
  assert.equal(prepared.compatibility.browserFriendly, audio !== 'DTS');
  assert.equal(prepared.compatibility.audioRisk, audio === 'DTS');
  assert.deepEqual(calls, [{ hash: HASH, onlyCached: true }]);
  assert.equal((await discovery.status(row.id, 'owner')).state, 'ready');
});

test('actual AVI still blocks playback when source metadata claimed a conditional MKV', async () => {
  const { discovery, cache, source } = matroskaFixture({ extension: 'avi' });
  assert.equal(cachedBrowserFit(cache, episodeTarget, source), false);
  const { sources: [row] } = await discovery.register({ target: episodeTarget, sources: [source] }, 'owner');
  assert.equal(row.cachedBrowserPlayable, false);
  const prepared = await discovery.prepare(row.id, 'owner', true);
  assert.equal(prepared.state, 'browser_unsupported');
  assert.equal(prepared.compatibility.container, 'avi');
  assert.equal(prepared.compatibility.browserUnsupported, true);
});

test('conditional MKV support never selects a different episode from the cached package', async () => {
  const { discovery, cache, source } = matroskaFixture({ episode: 3 });
  assert.equal(cachedBrowserFit(cache, episodeTarget, source), null);
  const { sources: [row] } = await discovery.register({ target: episodeTarget, sources: [source] }, 'owner');
  const prepared = await discovery.prepare(row.id, 'owner', true);
  assert.equal(prepared.state, 'unavailable');
  assert.equal(prepared.file, undefined);
});

const streamSource = (extra = {}) => ({ infoHash: HASH, behaviorHints: { filename: 'Dexter.Resurrection.S01E02.H264.AAC.mkv' }, ...extra });
const stremioSources = streams => normalizeStremioStreams({ streams }, episodeTarget, 'Fixture provider');

test('provider audio lines retain English evidence and never mistake subtitle flags for audio', () => {
  const [english] = stremioSources([streamSource({ description: 'Dexter: Resurrection\n🎙️ 🇺🇸 🇬🇧\n💬 🇫🇷 🇩🇪' })]);
  assert.deepEqual(english.languages, ['en']);
  assert.deepEqual(english.languageEvidence, ['description:audio']);
  const [french] = stremioSources([streamSource({ description: '🎙 🇫🇷 💬 🇺🇸\n💬 🇬🇧' })]);
  assert.deepEqual(french.languages, ['fr']);
  const [labelled] = stremioSources([streamSource({ description: 'Audio languages: English / French\nSubtitles: German' })]);
  assert.deepEqual(labelled.languages, ['en', 'fr']);
});

test('unlabelled flags, DUB markers, and release-group names leave audio language unknown', () => {
  for (const description of ['💬 🇺🇸 🇬🇧', '🇺🇸 🇬🇧', 'Dexter.Resurrection.S01E02.DUB.le-production', 'Dexter.Resurrection.S01E02.MULTI.English-release-group']) {
    const [source] = stremioSources([streamSource({ description })]);
    assert.deepEqual(source.languages, []);
    assert.deepEqual(source.languageEvidence, []);
  }
});

test('structured provider audio language aliases survive Stremio and index normalization', () => {
  const [stremio] = stremioSources([streamSource({ languages: ['ENG', 'fra', 'en-US', 'invalid'], language: 'German' })]);
  assert.deepEqual(stremio.languages, ['en', 'fr', 'de']);
  assert.deepEqual(stremio.languageEvidence, ['structured:languages', 'structured:language']);
  const [index] = normalizeIndexRows([{ imdb_id: episodeTarget.id, info_hash: HASH, raw_title: 'Dexter.Resurrection.S01E02.H264.AAC.mkv', languages: 'English, fra / de-DE' }], episodeTarget);
  assert.deepEqual(index.languages, ['en', 'fr', 'de']);
  assert.deepEqual(index.languageEvidence, ['structured:languages']);
});

test('same-hash provider metadata never moves English audio onto a different selected file', () => {
  const [english] = stremioSources([streamSource({ language: 'English' })]);
  for (const language of ['French', undefined]) {
    const [other] = stremioSources([streamSource({ language, behaviorHints: { filename: 'Dexter.Resurrection.S01E02.Alternate.H264.AAC.mkv', videoSize: 1000 } })]);
    const [merged] = mergeProviderSources([[english], [other]]);
    assert.equal(merged.filename, other.filename);
    assert.deepEqual(merged.languages, language ? ['fr'] : []);
    assert.deepEqual(merged.languageEvidence, language ? ['structured:language'] : []);
  }
});

test('same-hash exact-file provider audio evidence combines without inventing a language', () => {
  const [english] = stremioSources([streamSource({ language: 'English' })]);
  const [french] = stremioSources([streamSource({ description: '🎙️ 🇫🇷', behaviorHints: { ...streamSource().behaviorHints, videoSize: 1000 } })]);
  const [merged] = mergeProviderSources([[english], [french]]);
  assert.equal(merged.filename, english.filename);
  assert.deepEqual(new Set(merged.languages), new Set(['en', 'fr']));
  assert.deepEqual(new Set(merged.languageEvidence), new Set(['structured:language', 'description:audio']));
});

test('the forty-result provider cap retains an explicit English MKV ahead of unknown dubbed MP4s', () => {
  const dubbed = Array.from({ length: 50 }, (_, index) => streamSource({
    infoHash: (index + 1).toString(16).padStart(40, '0'),
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.H264.AAC.DUB.le-production.mp4', videoSize: 1000 }
  }));
  const english = streamSource({ description: '🎙️ 🇺🇸', behaviorHints: { filename: 'Dexter.Resurrection.S01E02.H264.AAC.mkv', videoSize: 1000 } });
  const sources = stremioSources([...dubbed, english]);
  assert.equal(sources.length, 40);
  assert.equal(sources[0].hash, HASH);
  assert.deepEqual(sources[0].languages, ['en']);
  assert.equal(sources[0].containerStatus, 'conditional');
  assert.ok(sources.filter(source => source.hash !== HASH).every(source => source.languages.length === 0));
});

test('the combined forty-result cap accounts for English evidence learned from an exact-file provider merge', () => {
  const dubbed = start => Array.from({ length: 20 }, (_, index) => streamSource({
    infoHash: (start + index).toString(16).padStart(40, '0'),
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.H264.AAC.DUB.le-production.mp4', videoSize: 1000 }
  }));
  const first = stremioSources([...dubbed(1), streamSource({ language: 'English' })]);
  const second = stremioSources([...dubbed(21), streamSource({ language: 'French', behaviorHints: { ...streamSource().behaviorHints, videoSize: 1000 } })]);
  const merged = mergeProviderSources([first, second]);
  assert.equal(merged.length, 40);
  const knownEnglish = merged.find(source => source.hash === HASH);
  assert.ok(knownEnglish, 'English-capable exact-file evidence survives the combined bounded list');
  assert.deepEqual(new Set(knownEnglish.languages), new Set(['en', 'fr']));
});

test('explicit provider video and audio markers survive a filename with no codec tags', () => {
  const [source] = stremioSources([streamSource({
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.mkv' },
    description: '💿 WEBRip 🎞️ AVC\n🎧 AAC\n🎙️ 🇬🇧\n💬 🇫🇷'
  })]);
  assert.match(source.videoCodec, /H264/);
  assert.ok(source.audioCodecs.includes('AAC'));
  assert.equal(source.browserFriendly, true);
  assert.equal(source.audioRisk, false);
  assert.equal(source.videoRisk, false);
  assert.deepEqual(source.languages, ['en']);
});

test('real-style HEVC and Atmos DDP description markers cannot become a falsely safe MP4', () => {
  const [source] = stremioSources([streamSource({
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.2160p.WEB-DL.DV.P5[Ben The Men].mp4' },
    description: '💿 WEB-DL 🎞️ HEVC\n📺 DV 🎧 Atmos, DDP | 5.1\n💾 3.0 GB 📦 34 GB 〽️ 1.1 MB/s 👤 9\n🎙️ 🇬🇧\n💬 🇬🇧'
  })]);
  assert.match(source.videoCodec, /HEVC/);
  assert.ok(source.audioCodecs.includes('EAC3'));
  assert.ok(source.audioCodecs.includes('Dolby Atmos'));
  assert.equal(source.browserContainer, true);
  assert.equal(source.browserFriendly, false);
  assert.equal(source.audioRisk, true);
  assert.equal(source.videoRisk, true);
  assert.deepEqual(source.languages, ['en']);
});

test('codec contradictions preserve explicit risks instead of trusting a friendly filename or structured tag', () => {
  const [source] = stremioSources([streamSource({
    videoCodec: 'H264', audioCodecs: ['AAC'],
    description: '🎞️ HEVC\n🎧 DDP, Atmos'
  })]);
  assert.match(source.videoCodec, /H264/);
  assert.match(source.videoCodec, /HEVC/);
  assert.ok(source.audioCodecs.includes('AAC'));
  assert.ok(source.audioCodecs.includes('EAC3'));
  assert.equal(source.browserFriendly, false);
  assert.equal(source.audioRisk, true);
  assert.equal(source.videoRisk, true);
});

test('subtitle and synopsis text do not attest video or audio codecs', () => {
  const [source] = stremioSources([streamSource({
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.mkv' },
    description: '🎙️ 🇬🇧\n💬 🇱🇹 H264 AAC\nSynopsis: a discussion of HEVC, DTS and Atmos.'
  })]);
  assert.equal(source.videoCodec, '');
  assert.deepEqual(source.audioCodecs, []);
  assert.equal(source.browserFriendly, false);
  assert.equal(source.audioRisk, false);
  assert.equal(source.videoRisk, false);
  assert.deepEqual(source.languages, ['en']);
});

test('filename codec fallback remains usable when explicit provider markers are absent', () => {
  const [source] = stremioSources([streamSource()]);
  assert.match(source.videoCodec, /H264/);
  assert.ok(source.audioCodecs.includes('AAC'));
  assert.equal(source.browserFriendly, true);
  assert.equal(source.audioRisk, false);
  assert.equal(source.videoRisk, false);
});

test('Lithuanian audio flags and aliases preserve multilingual English evidence', () => {
  const [flagged] = stremioSources([streamSource({ description: '🎙️ 🇬🇧 🇱🇹\n💬 🇫🇷' })]);
  assert.deepEqual(new Set(flagged.languages), new Set(['en', 'lt']));
  for (const alias of ['Lithuanian', 'lit', 'lt']) {
    const [structured] = stremioSources([streamSource({ languages: ['English', alias] })]);
    assert.deepEqual(structured.languages, ['en', 'lt']);
  }
});

test('bounded codec metadata cannot truncate an explicitly reported HEVC or DDP risk', () => {
  const [source] = stremioSources([streamSource({
    behaviorHints: { filename: 'Dexter.Resurrection.S01E02.mp4' },
    videoCodec: 'x'.repeat(40),
    audioCodecs: ['AAC', 'MP3', 'Opus', 'unknown-one', 'unknown-two', 'unknown-three'],
    description: '🎞️ HEVC\n🎧 DDP'
  })]);
  assert.ok(source.videoCodec.length <= 40);
  assert.ok(source.audioCodecs.length <= 6);
  assert.match(source.videoCodec, /HEVC/);
  assert.ok(source.audioCodecs.includes('EAC3'));
  assert.equal(source.videoRisk, true);
  assert.equal(source.audioRisk, true);
  assert.equal(source.browserFriendly, false);
});

test('richer same-file metadata preserves conflicting codec risks without transferring them to another file', () => {
  const filename = 'Dexter.Resurrection.S01E02.mp4';
  const [risky] = stremioSources([streamSource({ behaviorHints: { filename }, description: '🎞️ HEVC\n🎧 DDP' })]);
  for (const sameFile of [true, false]) {
    const selectedName = sameFile ? filename : 'Dexter.Resurrection.S01E02.Alternate.mp4';
    const [richer] = stremioSources([streamSource({ behaviorHints: { filename: selectedName, videoSize: 1000 }, description: '🎞️ H264\n🎧 AAC' })]);
    const [merged] = mergeProviderSources([[risky], [richer]]);
    assert.equal(merged.filename, selectedName);
    assert.match(merged.videoCodec, /H264/);
    assert.ok(merged.audioCodecs.includes('AAC'));
    assert.equal(merged.videoCodec.includes('HEVC'), sameFile);
    assert.equal(merged.audioCodecs.includes('EAC3'), sameFile);
    assert.equal(merged.videoRisk, sameFile);
    assert.equal(merged.audioRisk, sameFile);
    assert.equal(merged.browserFriendly, !sameFile);
  }
});

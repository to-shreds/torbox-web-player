// Real Family Guy source lists captured from the production providers on
// 2026-10-28. Most real releases never name their audio codec, so ranking and
// recovery must not depend on filename tags alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sourceHints } from '../public/source-client.js';
import {
  automaticSourceOrder, recoverySourceOrder, boundedRecoverySourceOrder, recoveryAttemptLimit, strictAudioCandidates,
  sourceAudioConfidence, sourceAudioRank, unknownAudioLikelihood, releaseLanguageTags, sourceLanguagePreference,
  applyDeviceVideoSupport, hevcPlayableOnDevice, deviceHevcSupport, validatePreparedSource, selectAutomaticVideoFile,
  sourceRecoveryKey, MAX_AUDIO_RECOVERY_ATTEMPTS, MAX_AUTOMATIC_SOURCE_ATTEMPTS,
} from '../public/discover.js';

const captured = JSON.parse(await readFile(new URL('./fixtures/family-guy-sources.json', import.meta.url), 'utf8'));
const rows = key => captured.episodes[key].map((source, index) => ({ ...source, id: `${key}-${index}`, cached: true, ...sourceHints(source) }));
const name = source => source.filename || source.title;
const untouchedWebMkv = source => unknownAudioLikelihood(source) === 0;

test('captured lists reflect real naming: most sources do not state their audio codec', () => {
  for (const key of Object.keys(captured.episodes)) {
    const list = rows(key), unknown = list.filter(source => sourceAudioConfidence(source) === 1).length;
    assert.ok(list.length >= 20, key);
    assert.ok(unknown / list.length > 0.4, `${key}: ${unknown}/${list.length} unknown`);
  }
});

test('automatic order never starts with a likely-Dolby web MKV while likely-AAC versions exist', () => {
  for (const key of Object.keys(captured.episodes)) {
    const order = automaticSourceOrder(rows(key), 'series', 'auto', 'balanced');
    assert.ok(order.length, key);
    const first = order[0];
    const likelyAacAvailable = order.some(source => sourceAudioRank(source) >= 12);
    if (likelyAacAvailable) assert.ok(sourceAudioRank(first) >= 12, `${key} started with ${name(first)}`);
    // Within each confidence level, ranks never increase down the list.
    for (let i = 1; i < order.length; i++) assert.ok(sourceAudioRank(order[i]) <= sourceAudioRank(order[i - 1]), `${key} rank order at ${i}`);
  }
  const s20 = automaticSourceOrder(rows('S20E1'), 'series', 'auto', 'balanced');
  assert.ok(!/web\.h264-cakes/i.test(name(s20[0])), 'the untouched Hulu WEB-DL is no longer the first choice');
});

test('release-tagged dubs never enter automatic playback, while episode titles naming a language do', () => {
  for (const key of Object.keys(captured.episodes)) {
    for (const source of automaticSourceOrder(rows(key), 'series', 'auto', 'balanced')) {
      const tags = releaseLanguageTags(name(source));
      assert.ok(!tags.foreign || tags.english || source.languages?.includes('en'), `${key} dub selected: ${name(source)}`);
    }
  }
  assert.equal(sourceLanguagePreference({ filename: 'Family.Guy.s20e01.WEBRip.x264.Rus.BaibaKo.tv.mp4' }), 0);
  assert.equal(sourceLanguagePreference({ filename: 'family.guy.s20e01.german.dl.1080p.web.h264-wayne.mkv' }), 0);
  assert.equal(sourceLanguagePreference({ filename: 'Family.Guy.S06E07.German.Guy.720p.HDTV.x264.mkv' }), 2);
  assert.equal(sourceLanguagePreference({ filename: 'The.Italian.Job.2003.1080p.BluRay.x264.mp4' }), 2);
  assert.equal(sourceLanguagePreference({ filename: 'I.Griffin.S03E05.WEBMux.1080p.x264.iTA.ENG.AAC.mkv' }), 2);
});

test('after a silent version, recovery offers untagged cached versions for live sound checks', () => {
  for (const key of Object.keys(captured.episodes)) {
    const list = rows(key), order = automaticSourceOrder(list, 'series', 'auto', 'balanced');
    const silent = order[0], context = { audioRecovery: true, sourceInfo: silent, resolution: 'auto', current: { type: 'series' } };
    const limit = recoveryAttemptLimit(context, true);
    assert.equal(limit, MAX_AUDIO_RECOVERY_ATTEMPTS);
    const next = strictAudioCandidates(boundedRecoverySourceOrder(list, context, 'series', 'balanced', limit), false);
    assert.equal(next.length, Math.min(limit - 1, recoverySourceOrder(list, context, 'series', 'balanced').length), key);
    assert.ok(next.every(source => sourceRecoveryKey(source) !== sourceRecoveryKey(silent)));
    assert.ok(next.every(source => sourceAudioConfidence(source) > 0), 'Dolby/DTS-tagged versions are still skipped');
  }
});

test('attempt limits: five sound checks when audio is observable, three otherwise, more on request', () => {
  assert.equal(recoveryAttemptLimit({ audioRecovery: true }, true), MAX_AUDIO_RECOVERY_ATTEMPTS);
  assert.equal(recoveryAttemptLimit({ audioRecovery: true, recoveryAllowance: 9 }, true), 9);
  assert.equal(recoveryAttemptLimit({ audioRecovery: true }, false), MAX_AUTOMATIC_SOURCE_ATTEMPTS);
  assert.equal(recoveryAttemptLimit({ audioRecovery: false }, true), MAX_AUTOMATIC_SOURCE_ATTEMPTS);
  const ordered = [{ id: 'a', filename: 'A.x264.mp4' }, { id: 'b', filename: 'B.AAC.mp4' }, { id: 'c', filename: 'C.mkv' }];
  assert.equal(strictAudioCandidates(ordered, true, Infinity).length, 3);
});

test('recovery skips versions that failed preparation without counting them as played', () => {
  const list = rows('S20E1'), order = automaticSourceOrder(list, 'series', 'auto', 'balanced');
  const context = { audioRecovery: true, sourceInfo: order[0], recoverySkipped: [sourceRecoveryKey(order[1])] };
  const next = recoverySourceOrder(list, context, 'series', 'balanced');
  assert.ok(next.every(source => sourceRecoveryKey(source) !== sourceRecoveryKey(order[1])));
  assert.equal(boundedRecoverySourceOrder(list, context, 'series', 'balanced', 5).length, 4);
});

test('HEVC MP4 with AAC becomes eligible only when this device reports HEVC decoding', () => {
  const support = { main: true, main10: false };
  for (const key of Object.keys(captured.episodes)) {
    const list = rows(key);
    const without = automaticSourceOrder(list, 'series', 'auto', 'balanced');
    const withHevc = automaticSourceOrder(applyDeviceVideoSupport(list, support), 'series', 'auto', 'balanced');
    assert.ok(without.every(source => !/(?:^|[^a-z0-9])(?:hevc|x265|h[ ._-]?265)(?:[^a-z0-9]|$)/i.test(`${name(source)} ${source.videoCodec || ''}`)), key);
    assert.ok(withHevc.filter(source => sourceAudioConfidence(source) >= 2).length >= without.filter(source => sourceAudioConfidence(source) >= 2).length, key);
  }
  assert.ok(sourceAudioConfidence(automaticSourceOrder(applyDeviceVideoSupport(rows('S8E1'), support), 'series', 'auto', 'balanced')[0]) >= 2);
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 1080p x265 AAC-MeGusta.mp4' }, support), true);
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 1080p x265 AAC.mkv' }, support), false, 'MKV HEVC stays excluded');
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 2160p HDR x265 AAC.mp4' }, support), false, 'HDR stays excluded');
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 1080p x265 10bit AAC.mp4' }, support), false);
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 1080p x265 10bit AAC.mp4' }, { main: true, main10: true }), true);
  assert.equal(hevcPlayableOnDevice({ filename: 'Family Guy S20E01 1080p x265 AAC.mp4' }, { main: false }), false);
  assert.deepEqual(applyDeviceVideoSupport(rows('S8E1'), { main: false }).filter(source => source.videoRisk === false && source.deviceVideoSupport), []);
});

test('device HEVC detection asks the browser and fails closed', () => {
  assert.deepEqual({ ...deviceHevcSupport({ canPlayType: type => type.includes('hvc1.1.6') ? 'probably' : '' }) }, { main: true, main10: false });
  assert.deepEqual({ ...deviceHevcSupport({ canPlayType: () => 'maybe' }) }, { main: false, main10: false });
  assert.deepEqual({ ...deviceHevcSupport({ canPlayType: () => { throw new Error('unavailable'); } }) }, { main: false, main10: false });
  assert.deepEqual({ ...deviceHevcSupport(null) }, { main: false, main10: false });
});

test('prepared HEVC files pass validation and package selection only with device support', () => {
  const support = { main: true, main10: false };
  const source = { id: 'x', filename: 'Family Guy S20E01 1080p x265 AAC.mp4', deviceVideoSupport: support };
  const ready = { state: 'ready', file: { id: 'f', title: 'Family Guy S20E01 1080p x265 AAC.mp4' } };
  assert.equal(validatePreparedSource(source, ready, { unattended: true }).videoRisk, false);
  assert.throws(() => validatePreparedSource({ ...source, deviceVideoSupport: undefined }, ready, { unattended: true }), { code: 'BROWSER_VIDEO_UNSUPPORTED' });
  assert.throws(() => validatePreparedSource(source, { state: 'ready', file: { id: 'f', title: 'Family Guy S20E01 1080p x265 AAC.mkv' } }, { unattended: true }), { code: 'BROWSER_VIDEO_UNSUPPORTED' });
  const files = [{ id: 'hevc', title: 'Family.Guy.S20E01.1080p.x265.AAC.mp4' }, { id: 'eac3', title: 'Family.Guy.S20E01.1080p.WEB.DDP5.1.H264.mkv' }];
  assert.equal(selectAutomaticVideoFile(files, support)?.id, 'hevc');
  assert.equal(selectAutomaticVideoFile(files), null);
});

test('fansub and Cyrillic-named releases are a last resort, not a first choice', () => {
  assert.equal(sourceLanguagePreference({ filename: '恶搞之家.Family.Guy.S20E01.LASIK.Instinct.1080p-漫迪字幕组.mp4' }), 1);
  assert.equal(sourceLanguagePreference({ filename: 'Гриффины.Family.Guy.S20E01.mp4' }), 1);
  const first = automaticSourceOrder(rows('S20E1'), 'series', 'auto', 'balanced')[0];
  assert.ok(!/[㐀-鿿]/.test(name(first)), name(first));
});

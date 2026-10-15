// Offline only: replay sanitized real provider metadata through current code.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeStremioStreams, mergeProviderSources } from '../../../lib/source-lookup.mjs';
import { normalizeSources } from '../../../public/source-client.js';
import { sourceIdentityFit, sourceEpisodeTitleFit } from '../../../lib/discovery.mjs';
import { automaticCachedSourceOrder, browserPreparationOptions } from '../../../public/discover.js';

globalThis.fetch = () => { throw new Error('This evidence replay must never use the network'); };
const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const hashFile = async path => createHash('sha256').update(await readFile(new URL('../../../' + path, import.meta.url))).digest('hex');
const codeFiles = ['lib/source-lookup.mjs', 'lib/discovery.mjs', 'public/source-client.js', 'public/discover.js'];
const codeHashes = Object.fromEntries(await Promise.all(codeFiles.map(async path => [path, await hashFile(path)])));
const raw = await readJson('../../../test/fixtures/dexter-resurrection-s01e02-streams.json');
const historical = await readJson('./fixed-worktree-e01-e03-normalized.json');
const target = raw.target, meta = historical.meta;
const beforeCap = raw.streams.flatMap(stream => normalizeStremioStreams({ streams: [stream] }, target, raw.provider));
const capped = normalizeStremioStreams(raw, target, raw.provider);
const identityAccepted = capped.filter(source => sourceIdentityFit(meta, target, source) !== false && sourceEpisodeTitleFit(meta, target, source) !== false);
const projection = source => ({
  syntheticHash: source.hash, filename: source.filename, container: source.container,
  languages: source.languages, languageEvidence: source.languageEvidence,
  videoCodec: source.videoCodec, audioCodecs: source.audioCodecs,
  browserFriendly: source.browserFriendly, audioRisk: source.audioRisk, videoRisk: source.videoRisk,
  containerStatus: source.containerStatus
});
const choices = rows => browserPreparationOptions(rows.map(source => ({ ...source, cached: false })), 'series', 'auto', 'balanced', 1000);
const summarize = rows => {
  const english = rows.filter(source => source.languages.includes('en'));
  const eligible = choices(rows);
  return {
    count: rows.length,
    englishAttested: english.length,
    englishOnlyAttested: english.filter(source => source.languages.length === 1).length,
    multilingualEnglishAttested: english.filter(source => source.languages.length > 1).length,
    audioLanguageUnknown: rows.filter(source => !source.languages.length).length,
    knownNonEnglish: rows.filter(source => source.languages.length && !source.languages.includes('en')).length,
    containers: Object.fromEntries([...new Set(rows.map(source => source.container || 'unknown'))].sort().map(container => [container, rows.filter(source => (source.container || 'unknown') === container).length])),
    englishBrowserFriendly: english.filter(source => source.browserFriendly && !source.audioRisk && !source.videoRisk).length,
    englishPreparationEligible: eligible.filter(source => source.languages.includes('en')).length,
    englishPreparationEligibleMp4: eligible.filter(source => source.languages.includes('en') && source.container === 'mp4').length,
    englishPreparationEligibleMkv: eligible.filter(source => source.languages.includes('en') && source.container === 'mkv').length,
    englishPreparationEligibleUnknownAudioCodec: eligible.filter(source => source.languages.includes('en') && !source.audioCodecs.length).length,
    allPreparationEligible: eligible.length,
    automaticCandidatesWithMockCacheUnknown: automaticCachedSourceOrder(rows.map(source => ({ ...source, cached: null })), 'series', 'auto', 'balanced').length
  };
};
const historicalEpisodes = [1, 2, 3].map(episode => {
  const groups = historical.replays.filter(row => row.target.episode === episode).map(row => normalizeSources(row.sources));
  const sources = mergeProviderSources(groups);
  return {
    episode, boundedHistoricalProviderRows: groups.reduce((sum, rows) => sum + rows.length, 0), finalMergedCount: sources.length,
    mp4: sources.filter(source => source.container === 'mp4').length,
    mkv: sources.filter(source => source.container === 'mkv').length,
    englishSafeCount: null,
    limitation: 'Earlier snapshot discarded raw audio-language and codec descriptions before its provider cap. English-safe counts cannot be reconstructed or treated as zero. These counts only describe current re-ranking of the retained historical rows.'
  };
});
for (const path of codeFiles) if (codeHashes[path] !== await hashFile(path)) throw new Error('Code changed during evidence replay: ' + path);
const report = {
  recordedAt: new Date().toISOString(), networkRequests: 0, codeHashes,
  rawFixture: 'test/fixtures/dexter-resurrection-s01e02-streams.json',
  rawFixtureSha256: await hashFile('test/fixtures/dexter-resurrection-s01e02-streams.json'),
  capture: { capturedAt: raw.capturedAt, provider: raw.provider, elapsedMs: raw.elapsedMs, status: raw.status, rawCount: raw.rawCount },
  target, beforeProviderCap: summarize(beforeCap), afterProviderCap: summarize(capped), afterIdentityChecks: summarize(identityAccepted),
  firstPreparationChoices: choices(identityAccepted).slice(0, 8).map(projection),
  correctlyRiskFlaggedEnglishMp4: beforeCap.filter(source => source.languages.includes('en') && source.container === 'mp4').map(projection),
  historicalEpisodes,
  scope: 'Public metadata replay only. Cache states are deliberately mocked. No TorBox account, cache availability, actual source file, audio track selection, or playback was tested. English-attested H.264 MKV with unknown audio codecs is a conditional native trial, not a guaranteed safe playback claim. An absent provider audio-language attestation remains unknown.'
};
await writeFile(new URL('./final-normalization.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ beforeProviderCap: report.beforeProviderCap, afterProviderCap: report.afterProviderCap, afterIdentityCount: identityAccepted.length, firstPreparationChoices: report.firstPreparationChoices.slice(0, 3), historicalEpisodes }, null, 2));

// Public metadata only: node docs/evidence/playback-source-correction/public-source-probe.mjs
// Does not contact TorBox, add torrents, or establish cache availability/playability.
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Catalog } from '../../../lib/catalog.mjs';
import { SourceLookup, TorrentioSourceLookup, TorznabSourceLookup, StremioSourceLookup, ACTIVE_STREMIO_PROVIDERS, mergeProviderSources } from '../../../lib/source-lookup.mjs';
import { sourceIdentityFit, sourceEpisodeTitleFit } from '../../../lib/discovery.mjs';
import { automaticCachedSourceOrder, browserPreparationOptions } from '../../../public/discover.js';

const titleId = 'tt33043892', timeoutMs = 10000;
const http = [], replays = [], aliases = new Map();
const alias = hash => {
  if (!aliases.has(hash)) aliases.set(hash, String(aliases.size + 1).padStart(40, '0'));
  return aliases.get(hash);
};
function trackedFetch(name, configuredOrigin, legacyRoot = false) {
  return async (url, options) => {
    if (new URL(url).hostname === 'api.torbox.app') throw new Error('TorBox is outside this public probe');
    const requested = new URL(url);
    const streamPath = /\/stream\/.*$/.exec(requested.pathname)?.[0];
    const actual = configuredOrigin && streamPath
      ? legacyRoot ? new URL(streamPath, configuredOrigin) : new URL(streamPath.slice(1), configuredOrigin + '/') : requested;
    const started = performance.now();
    try {
      const response = await fetch(actual, options);
      const text = await response.clone().text();
      let data; try { data = JSON.parse(text); } catch {}
      const rows = Array.isArray(data) ? data : data?.streams;
      http.push({ provider: name, path: actual.pathname.replace(/\/eyJ[^/]+\//, '/<public-p2p-config>/'), query: actual.search, status: response.status, elapsedMs: Math.round(performance.now() - started), rawCount: Array.isArray(rows) ? rows.length : (text.match(/<item\b/g) || []).length });
      return response;
    } catch (error) {
      http.push({ provider: name, path: actual.pathname.replace(/\/eyJ[^/]+\//, '/<public-p2p-config>/'), query: actual.search, elapsedMs: Math.round(performance.now() - started), error: error.name });
      throw error;
    }
  };
}
const providers = [
  { mode: 'current', name: 'Zilean', provider: new SourceLookup({ timeoutMs, fetchFn: trackedFetch('Zilean') }) },
  { mode: 'current', name: 'Torrentio', provider: new TorrentioSourceLookup({ timeoutMs, fetchFn: trackedFetch('Torrentio') }) },
  { mode: 'current', name: 'MediaFusion Torznab', provider: new TorznabSourceLookup({ timeoutMs, fetchFn: trackedFetch('MediaFusion Torznab') }) },
  ...ACTIVE_STREMIO_PROVIDERS.flatMap(row => [
    { mode: 'legacy-root-path', name: row.name, provider: new StremioSourceLookup({ ...row, timeoutMs, fetchFn: trackedFetch(row.name + ' legacy root', row.origin, true) }) },
    { mode: 'configured-path-only', name: row.name, provider: new StremioSourceLookup({ ...row, timeoutMs, fetchFn: trackedFetch(row.name + ' configured path', row.origin) }) }
  ])
];
const meta = await new Catalog().meta('series', titleId);
const counts = rows => ({
  total: rows.length,
  containers: rows.reduce((out, row) => { const key = row.container || 'unknown'; out[key] = (out[key] || 0) + 1; return out; }, {}),
  browserContainer: rows.filter(row => row.browserContainer).length,
  browserFriendly: rows.filter(row => row.browserFriendly).length,
  browserUnsupported: rows.filter(row => row.browserUnsupported).length,
  audioRisk: rows.filter(row => row.audioRisk).length,
  videoRisk: rows.filter(row => row.videoRisk).length
});
function classify(sources, target) {
  const accepted = sources.filter(source => sourceIdentityFit(meta, target, source) !== false && sourceEpisodeTitleFit(meta, target, source) !== false);
  return {
    normalized: counts(sources),
    rejectedYear: sources.filter(source => sourceIdentityFit(meta, target, source) === false).length,
    rejectedEpisodeTitle: sources.filter(source => sourceEpisodeTitleFit(meta, target, source) === false).length,
    accepted: counts(accepted),
    assumedCachedAutomaticCandidates: automaticCachedSourceOrder(accepted.map(source => ({ ...source, cached: true, cachedBrowserPlayable: null })), 'series', 'auto', 'balanced').length,
    assumedUncachedPreparationOptions: browserPreparationOptions(accepted.map(source => ({ ...source, cached: false, cachedBrowserPlayable: null })), 'series', 'auto', 'balanced', 40).length,
    examples: accepted.slice(0, 5).map(({ title, filename, container, videoCodec, audioCodecs, browserUnsupported, audioRisk, videoRisk }) => ({ title: title.slice(0, 220), filename, container, videoCodec, audioCodecs, browserUnsupported, audioRisk, videoRisk }))
  };
}
const episodes = [];
for (let start = 1; start <= 3; start += 2) {
  const batch = await Promise.all([start, start + 1].filter(episode => episode <= 3).map(async episode => {
    const target = { type: 'series', id: titleId, season: 1, episode };
    const results = await Promise.all(providers.map(async ({ mode, name, provider }) => {
      const started = performance.now();
      try {
        const result = await provider.lookup(target);
        replays.push({ target, mode, provider: name, sources: result.sources.map(source => ({ ...source, hash: alias(source.hash) })) });
        return { mode, name, elapsedMs: Math.round(performance.now() - started), sources: result.sources, classification: classify(result.sources, target) };
      } catch (error) { return { mode, name, elapsedMs: Math.round(performance.now() - started), error: error.code || error.name, sources: [] }; }
    }));
    const current = mergeProviderSources(results.filter(row => row.mode !== 'configured-path-only').map(row => row.sources));
    const repaired = mergeProviderSources(results.filter(row => row.mode === 'configured-path-only' || !row.name.startsWith('StremThru')).map(row => row.sources));
    return { episode, current: classify(current, target), configuredPathOnly: classify(repaired, target), providers: results.map(({ sources, ...row }) => row) };
  }));
  episodes.push(...batch);
  console.log(JSON.stringify(batch.map(row => ({ episode: row.episode, current: row.current.accepted, configuredPathOnly: row.configuredPathOnly.accepted, preparationOptionsBefore: row.current.assumedUncachedPreparationOptions, preparationOptionsAfter: row.configuredPathOnly.assumedUncachedPreparationOptions }))));
}
const sourceHashes = {};
for (const file of ['lib/source-lookup.mjs', 'lib/discovery.mjs', 'public/source-client.js', 'public/discover.js']) sourceHashes[file] = createHash('sha256').update(await readFile(new URL('../../../' + file, import.meta.url))).digest('hex');
const report = { timestamp: new Date().toISOString(), titleId, season: 1, scope: 'Live public source metadata and current normalization. Legacy-root-path and configured-path-only StremThru paths are explicitly selected by the diagnostic fetch wrapper. Cache candidate counts are explicitly simulated, never actual TorBox availability. No media downloaded.', sourceHashes, timeoutMs, episodes, http, diagnostics: providers.map(({ mode, name, provider }) => ({ mode, name, ...provider.diagnostics() })) };
await writeFile(new URL('./public-source-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
await writeFile('/workspace/scratch/6fec2436cb96/playback-source-replay.json', JSON.stringify({ meta, note: 'Hashes replaced with stable synthetic 40-character IDs; public title/codec metadata unchanged.', replays }, null, 2));

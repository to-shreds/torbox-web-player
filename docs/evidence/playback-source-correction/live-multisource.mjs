// One real bounded lookup, no account key, cache query, torrent addition or media.
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MultiSourceLookup } from '../../../lib/source-lookup.mjs';
import { Catalog } from '../../../lib/catalog.mjs';
import { sourceIdentityFit, sourceEpisodeTitleFit } from '../../../lib/discovery.mjs';
import { automaticCachedSourceOrder, browserPreparationOptions } from '../../../public/discover.js';

const target = { type: 'series', id: 'tt33043892', season: 1, episode: 1 };
const meta = await new Catalog().meta(target.type, target.id);
const requests = [], examples = [];
const redact = value => typeof value === 'string' ? value.replace(/[a-f0-9]{40}/gi, '<torrent-hash-redacted>') : value;
const safeStream = stream => Object.fromEntries(Object.entries(stream).filter(([key]) => !['infoHash', 'hash', 'url', 'sources'].includes(key)).map(([key, value]) => [key, value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redact(item)])) : redact(value)]));
const fetchFn = async (url, options) => {
  const endpoint = new URL(url);
  if (endpoint.hostname === 'api.torbox.app') throw new Error('Unexpected account request');
  const started = performance.now();
  try {
    const response = await fetch(url, options);
    const text = await response.clone().text();
    let data; try { data = JSON.parse(text); } catch {}
    const rows = Array.isArray(data) ? data : data?.streams;
    requests.push({ host: endpoint.hostname, path: endpoint.pathname.replace(/\/eyJ[^/]+\//, '/<public-p2p-config>/'), status: response.status, elapsedMs: Math.round(performance.now() - started), rawCount: Array.isArray(rows) ? rows.length : (text.match(/<item\b/g) || []).length });
    if (Array.isArray(data?.streams)) {
      const mp4 = data.streams.filter(stream => /\.mp4$/i.test(stream.behaviorHints?.filename || stream.filename || ''));
      const dub = mp4.filter(stream => /\bDUB\b/i.test(JSON.stringify(stream)));
      const other = mp4.filter(stream => !/\bDUB\b/i.test(JSON.stringify(stream)));
      examples.push({ providerHost: endpoint.hostname, mp4CountBeforeNormalization: mp4.length, selectedDubExamples: dub.slice(0, 2).map(safeStream), selectedNonDubExamples: other.slice(0, 3).map(safeStream) });
    }
    return response;
  } catch (error) {
    requests.push({ host: endpoint.hostname, elapsedMs: Math.round(performance.now() - started), error: error.name });
    throw error;
  }
};
const sourceHash = createHash('sha256').update(await readFile(new URL('../../../lib/source-lookup.mjs', import.meta.url))).digest('hex');
const lookup = new MultiSourceLookup({ fetchFn, timeoutMs: 10000 });
const started = performance.now();
let report;
try {
  const result = await lookup.lookup(target, { complete: true });
  const accepted = result.sources.filter(source => sourceIdentityFit(meta, target, source) !== false && sourceEpisodeTitleFit(meta, target, source) !== false);
  report = {
    timestamp: new Date().toISOString(), target, sourceHash, elapsedMs: Math.round(performance.now() - started), complete: result.complete,
    providers: result.providers, count: result.sources.length, identityAccepted: accepted.length,
    mp4Count: accepted.filter(row => row.container === 'mp4').length,
    browserFriendlyCount: accepted.filter(row => row.browserFriendly).length,
    cachedUnknownAutomaticCandidates: automaticCachedSourceOrder(accepted.map(source => ({ ...source, cached: null })), 'series', 'auto', 'balanced').length,
    assumedUncachedPreparationOptions: browserPreparationOptions(accepted.map(source => ({ ...source, cached: false })), 'series', 'auto', 'balanced', 40).length,
    sources: accepted.map(({ title, filename, container, videoCodec, audioCodecs, browserFriendly, audioRisk, videoRisk, providers }) => ({ title, filename, container, videoCodec, audioCodecs, browserFriendly, audioRisk, videoRisk, providers })),
    requests, examples, diagnostics: lookup.diagnostics(),
    scope: 'Actual live MultiSourceLookup with its ten-second budget and current normalization. No TorBox cache or playback evidence; null/false cache candidate counts are simulated. Raw stream examples retain provider language hints but omit hashes and torrent links.'
  };
} catch (error) { report = { timestamp: new Date().toISOString(), target, sourceHash, elapsedMs: Math.round(performance.now() - started), error: error.code || error.name, requests, examples }; process.exitCode = 1; }
await writeFile(new URL('./live-multisource.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ elapsedMs: report.elapsedMs, complete: report.complete, count: report.count, identityAccepted: report.identityAccepted, mp4Count: report.mp4Count, browserFriendlyCount: report.browserFriendlyCount, cachedUnknownAutomaticCandidates: report.cachedUnknownAutomaticCandidates, assumedUncachedPreparationOptions: report.assumedUncachedPreparationOptions, examples, error: report.error }, null, 2));

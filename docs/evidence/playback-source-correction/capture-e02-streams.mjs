// Optional live recapture: exactly one public metadata request, no account or media.
import { writeFile } from 'node:fs/promises';
import { STREMTHRU_MAIN_TORZ_ORIGIN } from '../../../lib/source-lookup.mjs';

const target = { type: 'series', id: 'tt33043892', season: 1, episode: 2 };
const url = new URL('stream/series/tt33043892:1:2.json', STREMTHRU_MAIN_TORZ_ORIGIN + '/');
const started = performance.now();
const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
if (!response.ok) throw new Error(`Public metadata HTTP ${response.status}`);
const text = await response.text();
if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('Public metadata response too large');
const data = JSON.parse(text);
if (!Array.isArray(data.streams)) throw new Error('Public metadata has no streams');
const hashes = [...new Set(data.streams.map(row => row.infoHash || row.hash).filter(hash => /^[a-f0-9]{40}$/i.test(hash || '')).map(hash => hash.toLowerCase()))].sort();
const syntheticHash = new Map(hashes.map((hash, index) => [hash, (index + 1000000).toString(16).padStart(40, '0')]));
const safeText = value => value.replace(/magnet:\?[^\s]+|https?:\/\/[^\s]+/gi, '<link-removed>').replace(/[a-f0-9]{40}/gi, '<hash-removed>');
const safeValue = value => typeof value === 'string' ? safeText(value) : Array.isArray(value) ? value.filter(item => typeof item === 'string').map(safeText) : typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const streams = data.streams.map(row => {
  const stream = {};
  const hash = String(row.infoHash || row.hash || '').toLowerCase();
  if (syntheticHash.has(hash)) stream.infoHash = syntheticHash.get(hash);
  for (const key of ['name', 'description', 'title', 'filename', 'fileIdx', 'videoCodec', 'audioCodecs', 'languages', 'language', 'size']) {
    const value = safeValue(row[key]);
    if (value !== undefined) stream[key] = value;
  }
  const behaviorHints = {};
  for (const key of ['filename', 'videoSize']) {
    const value = safeValue(row.behaviorHints?.[key]);
    if (value !== undefined) behaviorHints[key] = value;
  }
  if (Object.keys(behaviorHints).length) stream.behaviorHints = behaviorHints;
  return stream;
});
const capture = {
  capturedAt: new Date().toISOString(), provider: 'StremThru Torz Main',
  publicEndpoint: `${url.origin}/stremio/torz/<public-p2p-config>/stream/series/tt33043892:1:2.json`,
  target, status: response.status, elapsedMs: Math.round(performance.now() - started),
  requestCount: 1, rawCount: streams.length, uniqueSyntheticHashes: hashes.length,
  note: 'Actual public provider metadata. Torrent hashes replaced with deterministic synthetic IDs, preserving same-hash relationships. Links and unrelated provider fields removed. Audio language is attested only where the original structured language fields or microphone audio lines state it. Subtitle flags and DUB labels do not attest audio language. No TorBox account, cache check, download, or media request.'
};
await writeFile(new URL('../../../test/fixtures/dexter-resurrection-s01e02-streams.json', import.meta.url), JSON.stringify({ ...capture, streams }, null, 2) + '\n');
await writeFile(new URL('./raw-e02-capture.json', import.meta.url), JSON.stringify(capture, null, 2) + '\n');
console.log(JSON.stringify(capture, null, 2));

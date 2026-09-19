import { targetOf, normalizeSources, cleanText } from '../public/source-client.js';

// Public torrent metadata only. This adapter has no TorBox key or cookie input.
export const INDEX_ORIGIN = 'https://zileanfortheweebs.midnightignite.me';
export class SourceLookupError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
function target(input) {
  try { return targetOf(input); }
  catch { throw new SourceLookupError('INVALID_TARGET', 'Choose a valid movie or episode.', 400); }
}
export function normalizeIndexRows(data, input) {
  const selected = target(input);
  if (!Array.isArray(data)) throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source index returned an unreadable result. No torrent has been added.');
  const rows = [];
  for (const row of data.slice(0, 2000)) {
    if (!row || row.imdb_id !== selected.id || !/^[a-f0-9]{40}$/i.test(row.info_hash || '') || typeof row.raw_title !== 'string') continue;
    if (selected.type === 'series') {
      if (Array.isArray(row.seasons) && row.seasons.length && !row.seasons.includes(selected.season)) continue;
      if (Array.isArray(row.episodes) && row.episodes.length && !row.episodes.includes(selected.episode)) continue;
    }
    const hint = [row.resolution, row.codec, ...(Array.isArray(row.audio) ? row.audio.slice(0, 5) : [])].filter(v => typeof v === 'string').map(v => cleanText(v, 30)).join(' ');
    rows.push({
      hash: row.info_hash, title: cleanText(row.raw_title, 450), label: 'Zilean ' + hint,
      videoCodec: cleanText(row.codec, 40),
      audioCodecs: (Array.isArray(row.audio) ? row.audio : []).filter(v => typeof v === 'string').slice(0, 6).map(v => cleanText(v, 40)),
      resolution: cleanText(row.resolution, 20),
      // An index release title is not necessarily a filename. Resolve files in TorBox.
      filename: '', fileIdx: null, size: Number.isSafeInteger(row.size) && row.size > 0 ? row.size : null
    });
  }
  const sources = normalizeSources(rows);
  if (data.length && !sources.length) throw new SourceLookupError('SOURCE_IDENTITY_MISMATCH', 'The index returned results, but none could be matched safely to this title or episode. No torrent has been added.');
  return sources;
}
async function readJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source index returned an empty response.');
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new SourceLookupError('SOURCE_RESPONSE_TOO_LARGE', 'The source index returned too much data. Try another title.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source index returned an unreadable response. No torrent has been added.'); }
}
export class SourceLookup {
  constructor({ fetchFn = fetch, now = Date.now, timeoutMs = 35000, provider = 'zilean' } = {}) {
    Object.assign(this, { fetchFn, now, timeoutMs, provider });
    this.cache = new Map(); this.inflight = new Map(); this.cooldownUntil = 0;
  }
  async lookup(input) {
    const selected = target(input);
    if (this.provider !== 'zilean') throw new SourceLookupError('SOURCE_NOT_CONFIGURED', 'The server source provider is not configured.', 503);
    const key = JSON.stringify(selected), old = this.cache.get(key);
    if (old && old.until > this.now()) {
      if (old.error) throw old.error;
      return old.value;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.now() < this.cooldownUntil) throw new SourceLookupError('SOURCE_RATE_LIMITED', 'The source index asked this player to slow down. Try again later. No torrent has been added.', 429);
    if (this.inflight.size >= 4) throw new SourceLookupError('SOURCE_BUSY', 'Other source searches are still running. Try again shortly.', 429);
    const operation = this.request(selected).then(sources => {
      const value = { sources, provider: 'Zilean' };
      this.remember(key, { value, until: this.now() + (sources.length ? 15 * 60000 : 60000) });
      return value;
    }).catch(error => {
      this.remember(key, { error, until: this.now() + 15000 });
      throw error;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, operation); return operation;
  }
  remember(key, row) {
    if (this.cache.size >= 128 && !this.cache.has(key)) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, row);
  }
  async request(selected) {
    const url = new URL('/dmm/filtered', INDEX_ORIGIN);
    url.searchParams.set('ImdbId', selected.id);
    if (selected.type === 'series') { url.searchParams.set('Season', selected.season); url.searchParams.set('Episode', selected.episode); }
    let response;
    try {
      response = await this.fetchFn(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = Number(retry);
        const delay = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry || '') - this.now();
        this.cooldownUntil = this.now() + Math.min(86400000, Math.max(60000, Number.isFinite(delay) ? delay : 60000));
        throw new SourceLookupError('SOURCE_RATE_LIMITED', 'The source index is rate limiting this player. Try again later. No torrent has been added.', 429);
      }
      if ([401, 403].includes(response.status)) throw new SourceLookupError('SOURCE_ACCESS_DENIED', 'The source index declined this server request. No torrent has been added.');
      if (!response.ok) throw new SourceLookupError('SOURCE_UNAVAILABLE', `The source index is unavailable (HTTP ${response.status}). This is not a no-sources result. No torrent has been added.`);
      return normalizeIndexRows(await readJson(response), selected);
    } catch (e) {
      if (e instanceof SourceLookupError) throw e;
      if (['TimeoutError', 'AbortError'].includes(e?.name)) throw new SourceLookupError('SOURCE_TIMEOUT', 'Source lookup timed out on the server. Try again; no torrent has been added.', 504);
      throw new SourceLookupError('SOURCE_UNAVAILABLE', 'The server could not reach the source index. No torrent has been added.');
    } finally { try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {} }
  }
}

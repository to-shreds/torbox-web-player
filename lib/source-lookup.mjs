import { targetOf, normalizeSources, cleanText, parseSizeBytes } from '../public/source-client.js';

// Public torrent metadata only. These adapters never receive the TorBox key or browser credentials.
export const INDEX_ORIGIN = 'https://zileanfortheweebs.midnightignite.me';
export const STREMTHRU_MAIN_TORZ_ORIGIN = 'https://stremthru.13377001.xyz/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==';
export const STREMTHRU_ELFHOSTED_TORZ_ORIGIN = 'https://stremthru.elfhosted.com/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==';
export const PUBLIC_STREMIO_PROVIDERS = Object.freeze([
  Object.freeze({ id: 'stremthru-main', name: 'StremThru Torz Main', origin: STREMTHRU_MAIN_TORZ_ORIGIN }),
  Object.freeze({ id: 'stremthru-elfhosted', name: 'StremThru Torz ElfHosted', origin: STREMTHRU_ELFHOSTED_TORZ_ORIGIN }),
  Object.freeze({ id: 'mediafusion', name: 'MediaFusion', origin: 'https://mediafusion.elfhosted.com' }),
  Object.freeze({ id: 'comet', name: 'Comet', origin: 'https://comet.elfhosted.com' })
]);
export const ACTIVE_STREMIO_PROVIDERS = Object.freeze(PUBLIC_STREMIO_PROVIDERS.filter(row => row.id.startsWith('stremthru-')));
export const MEDIAFUSION_TORZNAB_ORIGIN = 'https://mediafusion.elfhosted.com/torznab';

const MAX_PROVIDER_RESPONSE = 8 * 1024 * 1024;
const TARGET_SOURCE_COUNT = 20;
const TARGET_BROWSER_SOURCE_COUNT = 3;
export const browserSourceCount = sources => (Array.isArray(sources) ? sources : []).filter(source => source?.browserContainer === true || source?.browserFriendly === true).length;

export class SourceLookupError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}

function target(input) {
  try { return targetOf(input); }
  catch { throw new SourceLookupError('INVALID_TARGET', 'Choose a valid movie or episode.', 400); }
}

function retryDelay(response, now, fallback = 60000) {
  const retry = response.headers.get('retry-after');
  const seconds = Number(retry);
  const value = retry && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry || '') - now();
  return Math.min(86400000, Math.max(fallback, Number.isFinite(value) ? value : fallback));
}

async function readText(response, maxBytes = MAX_PROVIDER_RESPONSE) {
  const reader = response.body?.getReader();
  if (!reader) throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source index returned an empty response.');
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) throw new SourceLookupError('SOURCE_RESPONSE_TOO_LARGE', 'The source index returned too much data. Try another title.');
      chunks.push(Buffer.from(result.value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
async function readJson(response, maxBytes = MAX_PROVIDER_RESPONSE) {
  const text = await readText(response, maxBytes);
  try { return JSON.parse(text); }
  catch { throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source index returned an unreadable response. No torrent has been added.'); }
}

function explicitSeeders(stream) {
  for (const value of [stream?.seeders, stream?.seeds, stream?.seedersCount, stream?.behaviorHints?.seeders]) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  const text = [stream?.description, stream?.title, stream?.name].filter(v => typeof v === 'string').join(' ');
  const match = /(?:👤|\bseed(?:er)?s?\b\s*[:=]?)\s*([0-9][0-9,]*)/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function inferredResolution(text) {
  const match = /\b(2160p|1440p|1080p|720p|576p|480p|360p|4k)\b/i.exec(text || '');
  if (!match) return '';
  return match[1].toUpperCase() === '4K' ? '4K' : match[1].toLowerCase();
}

function inferredQuality(text) {
  const match = /\b(WEB[ ._-]?DL|WEBRip|BluRay|BDRip|BRRip|HDRip|HDTV|DVDRip|REMUX|CAM|TS)\b/i.exec(text || '');
  return match ? cleanText(match[1].replace(/[ ._-]+/g, '-'), 40) : '';
}

function inferredContainer(filename) {
  const match = /\.([a-z0-9]{2,6})$/i.exec(filename || '');
  return match ? match[1].toLowerCase() : '';
}


function xmlDecode(value) {
  return String(value || '').replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function xmlTagText(block, tag) {
  const match = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block || '');
  return match ? cleanText(xmlDecode(match[1].trim()), 700) : '';
}
function torznabAttributes(block) {
  const attrs = {};
  const tags = String(block || '').match(/<torznab:attr\b[^>]*\/?\s*>/gi) || [];
  for (const tag of tags) {
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const value = /\bvalue=["']([^"']*)["']/i.exec(tag)?.[1];
    if (name && value !== undefined && !Object.hasOwn(attrs, name)) attrs[name] = xmlDecode(value);
  }
  return attrs;
}
export function normalizeTorznabXml(xml, input, providerName = 'MediaFusion Torznab') {
  const selected = target(input);
  if (typeof xml !== 'string') throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The torrent index returned an unreadable response.');
  const rows = [];
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const item of items.slice(0, 500)) {
    const attrs = torznabAttributes(item);
    const hash = attrs.infohash;
    if (!/^[a-f0-9]{40}$/i.test(hash || '')) continue;
    if (/^tt[0-9]{5,12}$/.test(attrs.imdb || '') && attrs.imdb !== selected.id) continue;
    const title = xmlTagText(item, 'title');
    if (!title) continue;
    const seedersValue = Number(attrs.seeders);
    const seeders = Number.isSafeInteger(seedersValue) && seedersValue >= 0 ? seedersValue : null;
    const size = parseSizeBytes(xmlTagText(item, 'size') || attrs.size);
    rows.push({
      hash,
      title,
      filename: '',
      label: cleanText(providerName, 80),
      provider: cleanText(providerName, 60),
      fileIdx: null,
      size,
      seeders,
      resolution: inferredResolution(title),
      releaseQuality: inferredQuality(title),
      container: inferredContainer(title),
      videoCodec: '',
      audioCodecs: []
    });
  }
  return normalizeSources(rows);
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
    const hint = [row.resolution, row.codec, ...(Array.isArray(row.audio) ? row.audio.slice(0, 5) : [])]
      .filter(v => typeof v === 'string').map(v => cleanText(v, 30)).join(' ');
    rows.push({
      hash: row.info_hash,
      title: cleanText(row.raw_title, 450),
      label: 'Zilean ' + hint,
      provider: 'Zilean',
      videoCodec: cleanText(row.codec, 40),
      audioCodecs: (Array.isArray(row.audio) ? row.audio : []).filter(v => typeof v === 'string').slice(0, 6).map(v => cleanText(v, 40)),
      resolution: cleanText(row.resolution, 20),
      releaseQuality: cleanText(row.quality, 40),
      container: cleanText(row.container || row.extension, 24),
      seeders: Number.isSafeInteger(row.seeders) && row.seeders >= 0 ? row.seeders : null,
      filename: '',
      fileIdx: null,
      size: parseSizeBytes(row.size)
    });
  }
  const sources = normalizeSources(rows);
  if (data.length && !sources.length) throw new SourceLookupError('SOURCE_IDENTITY_MISMATCH', 'The index returned results, but none could be matched safely to this title or episode. No torrent has been added.');
  return sources;
}

export function normalizeStremioStreams(data, input, providerName) {
  target(input);
  if (!data || !Array.isArray(data.streams)) throw new SourceLookupError('SOURCE_RESPONSE_INVALID', 'The source add-on returned an unreadable stream response. No torrent has been added.');
  const name = cleanText(providerName, 60) || 'Source index';
  const rows = [];
  for (const stream of data.streams.slice(0, 1500)) {
    const hash = stream?.infoHash || stream?.hash;
    if (!/^[a-f0-9]{40}$/i.test(hash || '')) continue;
    const filename = cleanText(stream.behaviorHints?.filename || stream.filename, 350);
    const text = [filename, stream.description, stream.title, stream.name].filter(v => typeof v === 'string').join(' ');
    const display = filename || cleanText(stream.description || stream.title || stream.name, 450) || 'Torrent source';
    rows.push({
      hash,
      filename,
      title: display,
      label: name,
      provider: name,
      fileIdx: Number.isSafeInteger(stream.fileIdx) && stream.fileIdx >= 0 ? stream.fileIdx : null,
      size: parseSizeBytes(stream.behaviorHints?.videoSize ?? stream.size),
      seeders: explicitSeeders(stream),
      resolution: inferredResolution(text),
      releaseQuality: inferredQuality(text),
      container: inferredContainer(filename),
      videoCodec: cleanText(stream.videoCodec, 40),
      audioCodecs: (Array.isArray(stream.audioCodecs) ? stream.audioCodecs : []).filter(v => typeof v === 'string').slice(0, 6).map(v => cleanText(v, 40))
    });
  }
  return normalizeSources(rows);
}

class CachedProvider {
  constructor({ fetchFn = fetch, now = Date.now, timeoutMs = 35000, name, cooldownCode = 'SOURCE_PROVIDER_COOLDOWN' }) {
    Object.assign(this, { fetchFn, now, timeoutMs, name, cooldownCode });
    this.cache = new Map();
    this.inflight = new Map();
    this.cooldownUntil = 0;
    this.lastOutcome = 'unused';
    this.lastStatus = null;
  }

  remember(key, row) {
    if (this.cache.size >= 128 && !this.cache.has(key)) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, row);
  }

  diagnostics() {
    return {
      name: this.name,
      outcome: this.lastOutcome,
      status: this.lastStatus,
      cooldownMs: Math.max(0, this.cooldownUntil - this.now())
    };
  }

  cachedLookup(input, requestFn) {
    const selected = target(input);
    const key = JSON.stringify(selected);
    const old = this.cache.get(key);
    if (old && old.until > this.now()) {
      if (old.error) return Promise.reject(old.error);
      return Promise.resolve(old.value);
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.now() < this.cooldownUntil) return Promise.reject(new SourceLookupError(this.cooldownCode, this.name + ' is temporarily cooling down.', this.cooldownCode === 'SOURCE_RATE_LIMITED' ? 429 : 503));
    if (this.inflight.size >= 4) return Promise.reject(new SourceLookupError('SOURCE_BUSY', 'Other source searches are still running. Try again shortly.', 429));

    const operation = requestFn(selected).then(sources => {
      this.lastOutcome = sources.length ? 'ok' : 'empty';
      const value = { sources, provider: this.name, providers: [this.name] };
      this.remember(key, { value, until: this.now() + (sources.length ? 15 * 60000 : 60000) });
      return value;
    }).catch(error => {
      this.lastOutcome = error?.code || 'error';
      this.remember(key, { error, until: this.now() + 15000 });
      throw error;
    }).finally(() => this.inflight.delete(key));

    this.inflight.set(key, operation);
    return operation;
  }
}

export class SourceLookup extends CachedProvider {
  constructor({ fetchFn = fetch, now = Date.now, timeoutMs = 35000, provider = 'zilean' } = {}) {
    super({ fetchFn, now, timeoutMs, name: 'Zilean', cooldownCode: 'SOURCE_RATE_LIMITED' });
    this.provider = provider;
  }

  async lookup(input) {
    if (this.provider !== 'zilean') throw new SourceLookupError('SOURCE_NOT_CONFIGURED', 'The server source provider is not configured.', 503);
    return this.cachedLookup(input, selected => this.request(selected));
  }

  async request(selected) {
    const url = new URL('/dmm/filtered', INDEX_ORIGIN);
    url.searchParams.set('ImdbId', selected.id);
    if (selected.type === 'series') {
      url.searchParams.set('Season', selected.season);
      url.searchParams.set('Episode', selected.episode);
    }
    let response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.lastStatus = response.status;
      if (response.status === 429) {
        this.cooldownUntil = this.now() + retryDelay(response, this.now, 60000);
        throw new SourceLookupError('SOURCE_RATE_LIMITED', 'Zilean is rate limiting this player. A backup source index will be tried.', 429);
      }
      if ([401, 403].includes(response.status)) {
        this.cooldownUntil = this.now() + 6 * 3600000;
        throw new SourceLookupError('SOURCE_ACCESS_DENIED', 'Zilean declined this server request. A backup source index will be tried.');
      }
      if (!response.ok) {
        if (response.status >= 500) this.cooldownUntil = this.now() + 5 * 60000;
        throw new SourceLookupError('SOURCE_UNAVAILABLE', 'Zilean is unavailable (HTTP ' + response.status + ').');
      }
      return normalizeIndexRows(await readJson(response, 4 * 1024 * 1024), selected);
    } catch (e) {
      if (e instanceof SourceLookupError) throw e;
      if (['TimeoutError', 'AbortError'].includes(e?.name)) {
        this.cooldownUntil = this.now() + 5 * 60000;
        throw new SourceLookupError('SOURCE_TIMEOUT', 'Zilean timed out. A backup source index will be tried.', 504);
      }
      this.cooldownUntil = this.now() + 5 * 60000;
      throw new SourceLookupError('SOURCE_UNAVAILABLE', 'Zilean could not be reached. A backup source index will be tried.');
    } finally {
      try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
    }
  }
}

export class StremioSourceLookup extends CachedProvider {
  constructor({ id, name, origin, fetchFn = fetch, now = Date.now, timeoutMs = 30000 } = {}) {
    if (!PUBLIC_STREMIO_PROVIDERS.some(row => row.id === id && row.name === name && row.origin === origin)) throw new Error('Unapproved Stremio source provider');
    super({ fetchFn, now, timeoutMs, name });
    this.id = id;
    this.origin = origin;
  }

  async lookup(input) { return this.cachedLookup(input, selected => this.request(selected)); }

  async request(selected) {
    const resourceId = selected.type === 'series' ? selected.id + ':' + selected.season + ':' + selected.episode : selected.id;
    const url = new URL('/stream/' + selected.type + '/' + resourceId + '.json', this.origin);
    let response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.lastStatus = response.status;
      if (response.status === 429) {
        this.cooldownUntil = this.now() + retryDelay(response, this.now, 60000);
        throw new SourceLookupError('SOURCE_RATE_LIMITED', this.name + ' is rate limiting this server.', 429);
      }
      if ([401, 403].includes(response.status)) {
        this.cooldownUntil = this.now() + 6 * 3600000;
        throw new SourceLookupError('SOURCE_ACCESS_DENIED', this.name + ' declined this server request.');
      }
      if (response.status >= 300 && response.status < 400) {
        this.cooldownUntil = this.now() + 6 * 3600000;
        throw new SourceLookupError('SOURCE_REQUIRES_CONFIGURATION', this.name + ' redirected instead of returning anonymous streams.');
      }
      if (!response.ok) {
        this.cooldownUntil = this.now() + (response.status >= 500 ? 5 * 60000 : 60 * 60000);
        throw new SourceLookupError('SOURCE_UNAVAILABLE', this.name + ' is unavailable (HTTP ' + response.status + ').');
      }
      return normalizeStremioStreams(await readJson(response), selected, this.name);
    } catch (e) {
      if (e instanceof SourceLookupError) throw e;
      if (['TimeoutError', 'AbortError'].includes(e?.name)) {
        this.cooldownUntil = this.now() + 5 * 60000;
        throw new SourceLookupError('SOURCE_TIMEOUT', this.name + ' timed out.', 504);
      }
      this.cooldownUntil = this.now() + 5 * 60000;
      throw new SourceLookupError('SOURCE_UNAVAILABLE', this.name + ' could not be reached.');
    } finally {
      try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
    }
  }
}

export class TorznabSourceLookup extends CachedProvider {
  constructor({ fetchFn = fetch, now = Date.now, timeoutMs = 30000 } = {}) {
    super({ fetchFn, now, timeoutMs, name: 'MediaFusion Torznab' });
    this.origin = MEDIAFUSION_TORZNAB_ORIGIN;
  }

  async lookup(input) { return this.cachedLookup(input, selected => this.request(selected)); }

  async request(selected) {
    const url = new URL(this.origin);
    url.searchParams.set('t', selected.type === 'series' ? 'tvsearch' : 'movie');
    url.searchParams.set('imdbid', selected.id);
    url.searchParams.set('limit', '100');
    if (selected.type === 'series') {
      url.searchParams.set('season', String(selected.season));
      url.searchParams.set('ep', String(selected.episode));
    }
    let response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
        credentials: 'omit',
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.lastStatus = response.status;
      if (response.status === 429) {
        this.cooldownUntil = this.now() + retryDelay(response, this.now, 60000);
        throw new SourceLookupError('SOURCE_RATE_LIMITED', 'MediaFusion Torznab is rate limiting source queries.', 429);
      }
      if ([401, 403].includes(response.status)) {
        this.cooldownUntil = this.now() + 6 * 3600000;
        throw new SourceLookupError('SOURCE_ACCESS_DENIED', 'MediaFusion Torznab declined this anonymous source query.');
      }
      if (response.status >= 300 && response.status < 400) {
        this.cooldownUntil = this.now() + 6 * 3600000;
        throw new SourceLookupError('SOURCE_REQUIRES_CONFIGURATION', 'MediaFusion Torznab redirected instead of returning anonymous search results.');
      }
      if (!response.ok) {
        this.cooldownUntil = this.now() + (response.status >= 500 ? 5 * 60000 : 60 * 60000);
        throw new SourceLookupError('SOURCE_UNAVAILABLE', 'MediaFusion Torznab is unavailable (HTTP ' + response.status + ').');
      }
      return normalizeTorznabXml(await readText(response, 4 * 1024 * 1024), selected, this.name);
    } catch (e) {
      if (e instanceof SourceLookupError) throw e;
      if (['TimeoutError', 'AbortError'].includes(e?.name)) {
        this.cooldownUntil = this.now() + 5 * 60000;
        throw new SourceLookupError('SOURCE_TIMEOUT', 'MediaFusion Torznab timed out.', 504);
      }
      this.cooldownUntil = this.now() + 5 * 60000;
      throw new SourceLookupError('SOURCE_UNAVAILABLE', 'MediaFusion Torznab could not be reached.');
    } finally {
      try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
    }
  }
}


function richness(source) {
  return (source.filename ? 5 : 0) + (source.size ? 4 : 0) + (source.seeders != null ? 3 : 0) +
    (source.resolution ? 3 : 0) + (source.videoCodec ? 2 : 0) + (source.audioCodecs?.length ? 2 : 0) +
    (source.releaseQuality ? 1 : 0);
}

export function mergeProviderSources(groups) {
  const byHash = new Map();
  for (const source of groups.flat()) {
    if (!source?.hash) continue;
    const old = byHash.get(source.hash);
    if (!old) {
      byHash.set(source.hash, {
        ...source,
        providers: [...new Set([...(source.providers || []), source.provider].filter(Boolean))]
      });
      continue;
    }
    const preferred = richness(source) > richness(old) ? source : old;
    const other = preferred === source ? old : source;
    const providers = [...new Set([...(old.providers || []), old.provider, ...(source.providers || []), source.provider].filter(Boolean))].slice(0, 6);
    byHash.set(source.hash, {
      ...preferred,
      filename: preferred.filename || other.filename,
      title: preferred.title || other.title,
      size: preferred.size || other.size,
      seeders: preferred.seeders ?? other.seeders,
      resolution: preferred.resolution || other.resolution,
      releaseQuality: preferred.releaseQuality || other.releaseQuality,
      container: preferred.container || other.container,
      videoCodec: preferred.videoCodec || other.videoCodec,
      audioCodecs: preferred.audioCodecs?.length ? preferred.audioCodecs : other.audioCodecs,
      provider: providers.join(' + '),
      providers
    });
  }
  return [...byHash.values()].sort((a, b) => b.score - a.score || (a.size || Infinity) - (b.size || Infinity)).slice(0, 40);
}

export class MultiSourceLookup {
  constructor({ fetchFn = fetch, now = Date.now, timeoutMs = 30000, providers, primaryCount } = {}) {
    this.now = now;
    this.cache = new Map();
    this.inflight = new Map();
    const supplied = Array.isArray(providers);
    this.providers = supplied ? providers : [
      new SourceLookup({ fetchFn, now, timeoutMs: Math.min(timeoutMs, 20000) }),
      new TorznabSourceLookup({ fetchFn, now, timeoutMs }),
      ...ACTIVE_STREMIO_PROVIDERS.map(row => new StremioSourceLookup({ ...row, fetchFn, now, timeoutMs }))
    ];
    this.primaryCount = Math.max(1, Math.min(primaryCount ?? (supplied ? 1 : 2), this.providers.length));
  }

  diagnostics() {
    return this.providers.map(provider => provider.diagnostics?.() || { name: provider.name || 'Source provider' });
  }

  remember(key, row) {
    if (this.cache.size >= 128 && !this.cache.has(key)) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, row);
  }

  async lookup(input) {
    const selected = target(input);
    const key = JSON.stringify(selected);
    const old = this.cache.get(key);
    if (old && old.until > this.now()) {
      if (old.error) throw old.error;
      return old.value;
    }
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= 4) throw new SourceLookupError('SOURCE_BUSY', 'Other source searches are still running. Try again shortly.', 429);

    const operation = this.run(selected).then(value => {
      this.remember(key, { value, until: this.now() + (value.sources.length ? 15 * 60000 : 60000) });
      return value;
    }).catch(error => {
      this.remember(key, { error, until: this.now() + 15000 });
      throw error;
    }).finally(() => this.inflight.delete(key));

    this.inflight.set(key, operation);
    return operation;
  }

  async run(selected) {
    const groups = [];
    const providersTried = [];
    const providersUsed = [];
    const failures = [];
    let successfulProviders = 0;

    const collect = (provider, outcome) => {
      const name = provider.name || 'Source provider';
      providersTried.push(name);
      if (outcome.status === 'fulfilled') {
        successfulProviders++;
        const sources = outcome.value?.sources || [];
        if (sources.length) {
          groups.push(sources);
          providersUsed.push(name);
        }
      } else {
        failures.push({ name, code: outcome.reason?.code || 'SOURCE_UNAVAILABLE' });
      }
    };

    const primaries = this.providers.slice(0, this.primaryCount);
    const primaryResults = await Promise.allSettled(primaries.map(provider => provider.lookup(selected)));
    primaryResults.forEach((outcome, index) => collect(primaries[index], outcome));

    let merged = mergeProviderSources(groups);
    let fallbackUsed = false;
    if (merged.length < TARGET_SOURCE_COUNT || browserSourceCount(merged) < TARGET_BROWSER_SOURCE_COUNT) {
      for (const provider of this.providers.slice(this.primaryCount)) {
        fallbackUsed = true;
        const outcome = await Promise.resolve().then(() => provider.lookup(selected))
          .then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
        collect(provider, outcome);
        merged = mergeProviderSources(groups);
        if (merged.length >= TARGET_SOURCE_COUNT && browserSourceCount(merged) >= TARGET_BROWSER_SOURCE_COUNT) break;
      }
    }

    if (!successfulProviders && failures.length === providersTried.length) {
      throw new SourceLookupError('SOURCE_ALL_UNAVAILABLE', 'All configured anonymous source indexes are temporarily unavailable. No torrent has been added.', 503);
    }

    return {
      sources: merged,
      provider: providersUsed.join(' + ') || 'Anonymous source indexes',
      providers: providersUsed,
      providersTried,
      fallbackUsed,
      warning: failures.length ? 'Some anonymous source indexes were unavailable, but the search completed with the remaining providers.' : ''
    };
  }
}

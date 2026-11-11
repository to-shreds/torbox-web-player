// Optional, dated Tomatometer snapshots from Wikidata's public CC0 dataset.
// Importing this module never starts a request. The caller decides when a
// details page is open and must show recordedAt/provider alongside the score.
export const WIKIDATA_RATINGS_ORIGIN = 'https://query.wikidata.org';
export const WIKIDATA_RATINGS_STORAGE_KEY = 'torbox.wikidata-ratings.v1';
export const WIKIDATA_RATINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WIKIDATA_RATINGS_MISSING_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ROWS = 100;
const SOURCE_ID = 'Q105584';
const METHOD_ID = 'Q108403393';
const entity = (value, id) => value === `http://www.wikidata.org/entity/${id}` || value === `https://www.wikidata.org/entity/${id}`;
const identity = (id, type) => typeof id === 'string' && /^tt[0-9]{5,12}$/.test(id) && ['movie', 'series'].includes(type);
const cacheKey = (id, type) => `${type}:${id}`;
const copyRating = rating => rating ? { ...rating } : null;

function aborted(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Ratings request cancelled.', 'AbortError');
}
function failure(message = 'Recorded ratings are unavailable right now.') { return new Error(message); }
function storageOrNull() { try { return globalThis.localStorage || null; } catch { return null; } }

function recordedDate(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const date = new Date(value), stamp = date.getTime();
  if (!Number.isFinite(stamp) || stamp > now || date.getUTCFullYear() < 1900) return null;
  // Date.parse normalizes impossible dates such as February 30. Reject them.
  if (date.toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return date.toISOString();
}

export function rottenTomatoesSnapshotUrl(slug, type) {
  if (typeof slug !== 'string' || !['movie', 'series'].includes(type)) return '';
  const prefix = type === 'movie' ? 'm' : 'tv';
  if (!new RegExp(`^${prefix}/[a-zA-Z0-9][a-zA-Z0-9_-]{0,179}$`).test(slug)) return '';
  return `https://www.rottentomatoes.com/${slug}`;
}

function safeCachedUrl(value, type) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.rottentomatoes.com' || url.username || url.password || url.port || url.search || url.hash) return '';
    const clean = rottenTomatoesSnapshotUrl(url.pathname.slice(1), type);
    return clean === value ? clean : '';
  } catch { return ''; }
}

export function wikidataRatingQuery(id) {
  if (!identity(id, 'movie')) throw new TypeError('Choose a valid IMDb title.');
  // Every row repeats the source and method so the response boundary verifies
  // them independently of the query. No text search or title/year guessing.
  return `SELECT ?item ?imdb ?score ?source ?method ?recordedAt ?rt ?rank WHERE {
  VALUES ?imdb { "${id}" }
  ?item wdt:P345 ?imdb; wdt:P1258 ?rt; p:P444 ?statement.
  ?statement ps:P444 ?score; pq:P447 ?source; pq:P459 ?method; pq:P585 ?recordedAt; wikibase:rank ?rank.
  FILTER(?source = wd:${SOURCE_ID} && ?method = wd:${METHOD_ID} && ?rank != wikibase:DeprecatedRank)
} ORDER BY DESC(?recordedAt) LIMIT ${MAX_ROWS}`;
}

export function normalizeWikidataRating(payload, meta, fetchedAt = Date.now()) {
  const { id, type } = meta || {};
  if (!identity(id, type) || !Number.isFinite(fetchedAt) || fetchedAt < 0) throw new TypeError('Choose a valid IMDb title.');
  const rows = payload?.results?.bindings;
  if (!Array.isArray(rows) || rows.length >= MAX_ROWS) throw failure('Recorded ratings could not be verified.');
  const candidates = [];
  for (const row of rows) {
    if (row?.imdb?.type !== 'literal' || row.imdb.value !== id || row?.source?.type !== 'uri' || !entity(row.source.value, SOURCE_ID) || row?.method?.type !== 'uri' || !entity(row.method.value, METHOD_ID)) continue;
    if (row?.item?.type !== 'uri' || !/^https?:\/\/www\.wikidata\.org\/entity\/Q[1-9][0-9]{0,11}$/.test(row.item.value || '')) continue;
    if (row?.rank?.type !== 'uri' || !['http://wikiba.se/ontology#NormalRank', 'http://wikiba.se/ontology#PreferredRank'].includes(row.rank.value)) continue;
    const value = row?.score?.type === 'literal' && typeof row.score.value === 'string' ? row.score.value.trim() : '';
    if (!/^(?:100|[1-9]?[0-9])%$/.test(value)) continue;
    const date = row?.recordedAt?.type === 'literal' && row.recordedAt.datatype === 'http://www.w3.org/2001/XMLSchema#dateTime' ? recordedDate(row.recordedAt.value, fetchedAt) : null;
    const url = row?.rt?.type === 'literal' ? rottenTomatoesSnapshotUrl(row.rt.value, type) : '';
    if (!date || !url) continue;
    candidates.push({ score: Number(value.slice(0, -1)), recordedAt: date, url, item: row.item.value.replace('https:', 'http:') });
  }
  if (!candidates.length) {
    if (rows.length) throw failure('Recorded ratings could not be verified.');
    return null;
  }
  // A duplicated IMDb identity across different entities is not a safe match.
  if (new Set(candidates.map(row => row.item)).size !== 1) throw failure('Recorded ratings could not be verified.');
  candidates.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const latest = candidates[0];
  if (candidates.some(row => row.recordedAt === latest.recordedAt && (row.score !== latest.score || row.url !== latest.url))) throw failure('Recorded ratings could not be verified.');
  return { id, type, score: latest.score, source: 'Rotten Tomatoes', provider: 'Wikidata', recordedAt: latest.recordedAt, url: latest.url, fetchedAt };
}

function abortable(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(aborted(signal)); }
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(aborted(signal)); };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', cancel); resolve(value); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

async function readJson(response, signal) {
  const stated = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(stated) && stated > MAX_BODY_BYTES) { await response.body?.cancel?.().catch(() => {}); throw failure(); }
  const reader = response.body?.getReader?.();
  let text;
  if (reader) {
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await abortable(reader.read(), signal);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw failure();
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      text = new TextDecoder().decode(bytes);
    } finally { void reader.cancel().catch(() => {}); }
  } else {
    text = await abortable(response.text(), signal);
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw failure();
  }
  if (signal.aborted) throw aborted(signal);
  try { return JSON.parse(text); } catch { throw failure('Recorded ratings could not be read.'); }
}

function validSavedRating(value, id, type, fetchedAt) {
  if (!value || value.id !== id || value.type !== type || value.source !== 'Rotten Tomatoes' || value.provider !== 'Wikidata' || value.fetchedAt !== fetchedAt || !Number.isInteger(value.score) || value.score < 0 || value.score > 100) return null;
  const date = recordedDate(value.recordedAt, fetchedAt), url = safeCachedUrl(value.url, type);
  return date && url ? { id, type, score: value.score, source: 'Rotten Tomatoes', provider: 'Wikidata', recordedAt: date, url, fetchedAt } : null;
}

export function createWikidataRatingsClient({ fetchFn = globalThis.fetch, now = Date.now, storage = storageOrNull(), timeoutMs = 4500 } = {}) {
  const cache = new Map(), jobs = new Map(), queue = [];
  const timeout = Math.max(1, Math.min(4500, Number(timeoutMs) || 4500));
  let active = 0, cooldownUntil = 0;
  try {
    const serialized = storage?.getItem(WIKIDATA_RATINGS_STORAGE_KEY);
    if (serialized && serialized.length <= MAX_BODY_BYTES) {
      const saved = JSON.parse(serialized);
      if (saved?.version === 1 && Array.isArray(saved.entries)) for (const entry of saved.entries.slice(-MAX_ENTRIES)) {
        if (!identity(entry?.id, entry?.type) || !Number.isFinite(entry.fetchedAt) || entry.fetchedAt < 0 || entry.fetchedAt > now() || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now()) continue;
        const ttl = entry.value === null ? WIKIDATA_RATINGS_MISSING_TTL_MS : WIKIDATA_RATINGS_TTL_MS;
        if (entry.expiresAt > entry.fetchedAt + ttl) continue;
        const value = entry.value === null ? null : validSavedRating(entry.value, entry.id, entry.type, entry.fetchedAt);
        if (entry.value !== null && !value) continue;
        cache.set(cacheKey(entry.id, entry.type), { id: entry.id, type: entry.type, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt, value });
      }
    }
  } catch { /* Storage can be disabled or contain an obsolete value. */ }

  const cached = (id, type) => {
    const key = cacheKey(id, type), entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now() || entry.fetchedAt > now()) { cache.delete(key); return undefined; }
    cache.delete(key); cache.set(key, entry);
    return entry;
  };
  const remember = (meta, value) => {
    const fetchedAt = value?.fetchedAt ?? now(), key = cacheKey(meta.id, meta.type);
    cache.delete(key);
    cache.set(key, { id: meta.id, type: meta.type, fetchedAt, expiresAt: fetchedAt + (value ? WIKIDATA_RATINGS_TTL_MS : WIKIDATA_RATINGS_MISSING_TTL_MS), value });
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
    try { storage?.setItem(WIKIDATA_RATINGS_STORAGE_KEY, JSON.stringify({ version: 1, entries: [...cache.values()] })); } catch { /* Memory cache still works. */ }
  };

  function finish(job, value, error) {
    if (job.done) return;
    job.done = true; clearTimeout(job.timer);
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    for (const waiter of job.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.cancel);
      if (error) waiter.reject(error); else waiter.resolve(copyRating(value));
    }
    job.waiters.clear();
  }
  async function request(job) {
    const url = new URL('/sparql', WIKIDATA_RATINGS_ORIGIN);
    url.searchParams.set('format', 'json'); url.searchParams.set('query', wikidataRatingQuery(job.meta.id));
    const signal = job.controller.signal;
    const response = await abortable(fetchFn(url.href, { method: 'GET', headers: { Accept: 'application/sparql-results+json' }, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal }), signal);
    if (response.status === 429) {
      const retry = response.headers?.get?.('retry-after') || '';
      const seconds = /^[0-9]+$/.test(retry) ? Number(retry) : (Date.parse(retry) - now()) / 1000;
      const delay = Number.isFinite(seconds * 1000) && seconds > 0 ? seconds * 1000 : 60000;
      cooldownUntil = now() + Math.max(1000, delay);
    }
    if (!response.ok) { void response.body?.cancel?.().catch(() => {}); throw failure(); }
    const payload = await readJson(response, signal);
    if (job.done || signal.aborted) throw aborted(signal);
    const value = normalizeWikidataRating(payload, job.meta, now());
    if (job.done || signal.aborted || !job.waiters.size) throw aborted(signal);
    remember(job.meta, value);
    return value;
  }
  function pump() {
    while (active < 2 && queue.length) {
      const job = queue.shift();
      if (job.done || !job.waiters.size) continue;
      if (cooldownUntil > now()) { finish(job, null, failure()); continue; }
      active++;
      request(job).then(value => finish(job, value), error => finish(job, null, error)).finally(() => { active--; pump(); });
    }
  }
  function peek(id, type = 'movie') {
    if (!identity(id, type)) return null;
    return copyRating(cached(id, type)?.value);
  }
  function fetchRating(meta, { signal } = {}) {
    const { id, type } = meta || {};
    if (!identity(id, type)) return Promise.reject(new TypeError('Choose a valid IMDb title.'));
    if (signal?.aborted) return Promise.reject(aborted(signal));
    const entry = cached(id, type);
    if (entry) return Promise.resolve(copyRating(entry.value));
    if (cooldownUntil > now()) return Promise.reject(failure());
    const key = cacheKey(id, type);
    let job = jobs.get(key);
    if (!job) {
      job = { key, meta: { id, type }, controller: new AbortController(), waiters: new Set(), done: false };
      job.timer = setTimeout(() => {
        const error = new DOMException('Recorded ratings took too long.', 'TimeoutError');
        job.controller.abort(error); finish(job, null, error); pump();
      }, timeout);
      jobs.set(key, job); queue.push(job);
    }
    const promise = new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, cancel: null };
      waiter.cancel = () => {
        job.waiters.delete(waiter); signal?.removeEventListener('abort', waiter.cancel); reject(aborted(signal));
        if (!job.waiters.size) { job.controller.abort(aborted(signal)); finish(job, null, aborted(signal)); pump(); }
      };
      job.waiters.add(waiter);
      signal?.addEventListener('abort', waiter.cancel, { once: true });
      if (signal?.aborted) waiter.cancel();
    });
    pump();
    return promise;
  }
  return { peek, fetch: fetchRating };
}

let sharedClient;
const client = () => sharedClient ||= createWikidataRatingsClient();
export const peekWikidataRating = (id, type = 'movie') => client().peek(id, type);
export const fetchWikidataRating = (meta, options) => client().fetch(meta, options);

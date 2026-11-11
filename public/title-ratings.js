// Optional, device-local OMDb access. Home-page cards only read the public cache;
// a title details view may explicitly request a score after it has rendered.
const KEY_STORE = 'torbox-omdb-key-v1';
const CACHE_STORE = 'torbox-title-ratings-v1';
const ENDPOINT = 'https://www.omdbapi.com/';
const SCORE_TTL = 7 * 24 * 60 * 60 * 1000;
const EMPTY_TTL = 6 * 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const RESPONSE_LIMIT = 64 * 1024;
const PENDING_LIMIT = 16;
const ID = /^tt[0-9]{5,12}$/;
const API_KEY = /^[a-zA-Z0-9_-]{6,64}$/;
const safeErrors = new WeakSet();
const validType = type => type === 'movie' || type === 'series';
const validScore = score => Number.isInteger(score) && score >= 0 && score <= 100;
const cacheId = (id, type) => `${type}:${id}`;
const cancelled = () => new DOMException('Ratings request cancelled.', 'AbortError');
function failure(code, message) { const error = new Error(message); error.code = code; safeErrors.add(error); return error; }
function localStorageOrNull() { try { return globalThis.localStorage || null; } catch { return null; } }

function scoreFromResponse(data, meta) {
  if (data?.Response === 'False') {
    const reason = typeof data.Error === 'string' ? data.Error : '';
    if (/invalid api key|no api key|api key.*(?:invalid|activat)/i.test(reason)) {
      throw failure('RATINGS_KEY_INVALID', 'Check the OMDb API key in Settings.');
    }
    if (/request limit|limit reached|too many requests/i.test(reason)) {
      throw failure('RATINGS_QUOTA', 'The OMDb request limit has been reached. Ratings will retry later.');
    }
    if (/^(?:movie|series) not found!?$/i.test(reason.trim())) return null;
    throw failure('RATINGS_UNAVAILABLE', 'Ratings are temporarily unavailable.');
  }
  if (data?.Response !== 'True' || data.imdbID !== meta.id || data.Type !== meta.type) {
    throw failure('RATINGS_IDENTITY_MISMATCH', 'A matching rating is not available for this title.');
  }
  for (const rating of Array.isArray(data.Ratings) ? data.Ratings.slice(0, 20) : []) {
    if (rating?.Source !== 'Rotten Tomatoes' || typeof rating.Value !== 'string') continue;
    const match = /^(100|[0-9]{1,2})%$/.exec(rating.Value.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

async function boundedJson(response) {
  if (Number(response.headers?.get?.('content-length')) > RESPONSE_LIMIT) {
    await response.body?.cancel?.().catch(() => {});
    throw failure('RATINGS_UNAVAILABLE', 'The ratings response could not be read.');
  }
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let length = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > RESPONSE_LIMIT) throw failure('RATINGS_UNAVAILABLE', 'The ratings response could not be read.');
        text += decoder.decode(value, {stream:true});
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    text = await response.text();
    if (new TextEncoder().encode(text).byteLength > RESPONSE_LIMIT) {
      throw failure('RATINGS_UNAVAILABLE', 'The ratings response could not be read.');
    }
  }
  try { return JSON.parse(text); }
  catch { throw failure('RATINGS_UNAVAILABLE', 'The ratings response could not be read.'); }
}

export function createTitleRatingsClient({fetchFn = (...args) => globalThis.fetch(...args), storage = localStorageOrNull(), now = Date.now, timeoutMs = 4000} = {}) {
  const cache = new Map(), inflight = new Map();
  let queue = [], running = 0, generation = 0, lastFailure = null;
  const readKey = () => { try { const value = storage?.getItem(KEY_STORE) || ''; return API_KEY.test(value) ? value : ''; } catch { return ''; } };
  let configuredKey = readKey();

  function pruneCache() {
    for (const [key, row] of cache) if (row.expiresAt <= now()) cache.delete(key);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }
  function persistCache() {
    pruneCache();
    try { storage?.setItem(CACHE_STORE, JSON.stringify({version:1, entries:[...cache.values()]})); } catch {}
  }
  try {
    const saved = storage?.getItem(CACHE_STORE);
    if (saved && saved.length <= 100000) {
      const data = JSON.parse(saved);
      for (const row of data?.version === 1 && Array.isArray(data.entries) ? data.entries.slice(-CACHE_LIMIT) : []) {
        if (!ID.test(row?.id || '') || !validType(row.type) || !(row.score === null || validScore(row.score))) continue;
        if (!Number.isFinite(row.fetchedAt) || !Number.isFinite(row.expiresAt) || row.fetchedAt > now() || row.expiresAt <= now()) continue;
        const ttl = row.score === null ? EMPTY_TTL : SCORE_TTL;
        if (row.expiresAt > row.fetchedAt + ttl || row.expiresAt <= row.fetchedAt) continue;
        cache.set(cacheId(row.id, row.type), {id:row.id, type:row.type, score:row.score, fetchedAt:row.fetchedAt, expiresAt:row.expiresAt});
      }
    }
  } catch {}

  function publicScore(row) {
    return row && validScore(row.score) ? Object.freeze({id:row.id, type:row.type, score:row.score, source:'Rotten Tomatoes', provider:'OMDb', fetchedAt:row.fetchedAt}) : null;
  }
  function finish(job, error, result) {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    if (inflight.get(job.id) === job) inflight.delete(job.id);
    queue = queue.filter(item => item !== job);
    for (const waiter of job.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      if (error) waiter.reject(error); else waiter.resolve(result);
    }
    job.waiters.clear();
  }
  function resetConfiguration(next) {
    configuredKey = next;
    generation++;
    lastFailure = null;
    for (const job of [...inflight.values()]) {
      const error = cancelled();
      job.controller.abort(error);
      finish(job, error);
    }
    for (const [id, row] of cache) if (row.score === null) cache.delete(id);
    persistCache();
  }
  function getRatingsKey() {
    const stored = readKey();
    if (stored !== configuredKey) resetConfiguration(stored);
    return configuredKey;
  }
  function setRatingsKey(value) {
    const key = String(value ?? '').trim();
    if (key && !API_KEY.test(key)) throw failure('RATINGS_KEY_INVALID', 'Enter a valid OMDb API key.');
    try {
      if (!storage) throw new Error();
      if (key) storage.setItem(KEY_STORE, key); else storage.removeItem(KEY_STORE);
      if (readKey() !== key) throw new Error();
    } catch { throw failure('RATINGS_STORAGE_UNAVAILABLE', 'This browser could not save the ratings setting.'); }
    resetConfiguration(key);
    return key;
  }
  function peekRottenTomatoes(id, type) {
    if (!getRatingsKey() || !ID.test(id || '') || (type !== undefined && !validType(type))) return null;
    pruneCache();
    if (type) return publicScore(cache.get(cacheId(id, type)));
    return publicScore(cache.get(cacheId(id, 'movie'))) || publicScore(cache.get(cacheId(id, 'series')));
  }

  async function request(job) {
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({apikey:job.key, i:job.meta.id, type:job.meta.type, r:'json', plot:'short'}).toString();
    const response = await fetchFn(url.href, {method:'GET', headers:{Accept:'application/json'}, mode:'cors', credentials:'omit', referrerPolicy:'no-referrer', redirect:'error', cache:'no-store', signal:job.controller.signal});
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel?.().catch(() => {});
      throw failure('RATINGS_KEY_INVALID', 'Check the OMDb API key in Settings.');
    }
    if (response.status === 429) {
      await response.body?.cancel?.().catch(() => {});
      throw failure('RATINGS_QUOTA', 'The OMDb request limit has been reached. Ratings will retry later.');
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw failure('RATINGS_UNAVAILABLE', 'Ratings are temporarily unavailable.');
    }
    return scoreFromResponse(await boundedJson(response), job.meta);
  }
  async function run(job) {
    let removeAbort = () => {};
    try {
      const aborted = new Promise((_, reject) => {
        const abort = () => reject(job.controller.signal.reason || cancelled());
        removeAbort = () => job.controller.signal.removeEventListener('abort', abort);
        if (job.controller.signal.aborted) abort(); else job.controller.signal.addEventListener('abort', abort, {once:true});
      });
      const score = await Promise.race([request(job), aborted]);
      if (job.settled || job.controller.signal.aborted || getRatingsKey() !== job.key || job.generation !== generation) throw cancelled();
      const fetchedAt = now(), row = {id:job.meta.id, type:job.meta.type, score, fetchedAt, expiresAt:fetchedAt + (score === null ? EMPTY_TTL : SCORE_TTL)};
      cache.delete(job.id);
      cache.set(job.id, row);
      persistCache();
      finish(job, null, publicScore(row));
    } catch (error) {
      const safe = job.controller.signal.aborted ? job.controller.signal.reason || cancelled()
        : safeErrors.has(error) ? error
        : failure('RATINGS_UNAVAILABLE', 'Ratings are temporarily unavailable.');
      if (!job.settled && job.generation === generation && ['RATINGS_KEY_INVALID','RATINGS_QUOTA'].includes(safe.code)) {
        lastFailure = {code:safe.code, message:safe.message, until:now() + (safe.code === 'RATINGS_QUOTA' ? 300000 : 60000)};
      }
      finish(job, safe);
    } finally {
      removeAbort();
      running--;
      pump();
    }
  }
  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift();
      if (job.settled) continue;
      if (lastFailure && lastFailure.until > now()) { finish(job, failure(lastFailure.code, lastFailure.message)); continue; }
      running++;
      void run(job);
    }
  }
  function subscribe(job, signal) {
    return new Promise((resolve, reject) => {
      const waiter = {resolve, reject, signal, abort:null};
      waiter.abort = () => {
        signal?.removeEventListener('abort', waiter.abort);
        job.waiters.delete(waiter);
        reject(cancelled());
        if (!job.waiters.size && !job.settled) {
          const error = cancelled();
          job.controller.abort(error);
          finish(job, error);
          pump();
        }
      };
      job.waiters.add(waiter);
      signal?.addEventListener('abort', waiter.abort, {once:true});
      if (signal?.aborted) waiter.abort();
    });
  }
  function fetchRottenTomatoes(meta, {signal} = {}) {
    const key = getRatingsKey();
    if (signal?.aborted) return Promise.reject(cancelled());
    if (!key || !ID.test(meta?.id || '') || !validType(meta?.type)) return Promise.resolve(null);
    pruneCache();
    const id = cacheId(meta.id, meta.type), cached = cache.get(id);
    if (cached) return Promise.resolve(publicScore(cached));
    if (lastFailure && lastFailure.until > now()) return Promise.reject(failure(lastFailure.code, lastFailure.message));
    let job = inflight.get(id);
    if (job) return subscribe(job, signal);
    if (inflight.size >= PENDING_LIMIT) return Promise.reject(failure('RATINGS_UNAVAILABLE', 'Ratings are busy. Try this title again shortly.'));
    job = {id, meta:{id:meta.id, type:meta.type}, key, generation, controller:new AbortController(), settled:false, waiters:new Set(), timer:null};
    inflight.set(id, job);
    const pending = subscribe(job, signal);
    job.timer = setTimeout(() => {
      const error = failure('RATINGS_UNAVAILABLE', 'Ratings took too long to respond. Try this title again later.');
      job.controller.abort(error);
      finish(job, error);
      pump();
    }, Math.max(1, Math.min(Number(timeoutMs) || 4000, 10000)));
    queue.push(job);
    pump();
    return pending;
  }
  return Object.freeze({getRatingsKey, setRatingsKey, clearRatingsKey:() => setRatingsKey(''), peekRottenTomatoes, fetchRottenTomatoes});
}

let shared;
const client = () => shared ||= createTitleRatingsClient();
export const getRatingsKey = () => client().getRatingsKey();
export const setRatingsKey = value => client().setRatingsKey(value);
export const clearRatingsKey = () => client().clearRatingsKey();
export const peekRottenTomatoes = (id, type) => client().peekRottenTomatoes(id, type);
export const fetchRottenTomatoes = (meta, options) => client().fetchRottenTomatoes(meta, options);

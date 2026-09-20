import { randomUUID } from 'node:crypto';
import { AppError, normalizeItem } from './torbox.mjs';
import { Catalog, jsonFromResponse } from './catalog.mjs';
import { MAX_SOURCES, normalizeSources, targetOf, cleanText } from '../public/source-client.js';
const validId = n => Number.isSafeInteger(n) && n >= 0;
const validHash = s => typeof s === 'string' && /^[a-f0-9]{40}$/i.test(s);
// Field names only. Never log provider values: they carry the torrent identity and the account's activity.
const responseShape = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.keys(value).filter(name => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(name)).slice(0, 20)
  : typeof value;
const fileName = name => cleanText(name, 700).replace(/\\/g, '/').split('/').pop().toLowerCase();
export function episodeIdentity(name) {
  const value = String(name || '');
  const m = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?!\d)/i.exec(value) || /(?:^|[^a-z0-9])(\d{1,3})x(\d{1,4})(?!\d)/i.exec(value);
  if (!m) return null;
  // Multi-episode files require an explicit selection, never an automatic guess.
  const tail = value.slice(m.index + m[0].length);
  return { season: +m[1], episode: +m[2], multi: /^(?:[ ._-]*e\d|\s*-\s*(?:e)?\d)/i.test(tail) };
}
export function chooseVideo(files, target, source, explicitVideoId) {
  const videoFiles = files.filter(f => !/(?:^|[ ._-])(sample|trailer|featurette)(?:[ ._-]|$)/i.test(fileName(f.title)));
  let candidates = videoFiles;
  if (target.type === 'series') {
    candidates = videoFiles.filter(f => {
      const e = episodeIdentity(f.title);
      if (e) return e.season === target.season && e.episode === target.episode;
      return !!source.filename && fileName(f.title) === fileName(source.filename);
    });
  }
  if (explicitVideoId) {
    const selected = candidates.find(f => f.id === explicitVideoId);
    if (!selected) throw new AppError('FILE_SELECTION_INVALID', 'That file does not match this source and episode. Reopen its source list.', 400);
    return { file: selected, candidates };
  }
  const named = source.filename ? candidates.filter(f => fileName(f.title) === fileName(source.filename)) : [];
  const confident = named.length === 1 ? named : candidates.length === 1 ? candidates : [];
  if (confident.length && !(target.type === 'series' && episodeIdentity(confident[0].title)?.multi)) return { file: confident[0], candidates };
  return { file: null, candidates };
}
export class TorrentGateway {
  constructor({ provider, fetchFn = fetch }) { this.provider = provider; this.fetchFn = fetchFn; }
  async call(path, { params = [], form, creating = false } = {}) {
    const key = this.provider.key;
    if (!key) throw new AppError('TORBOX_NOT_CONFIGURED', 'The TorBox connection is not configured.', 503);
    const url = new URL(`https://api.torbox.app/v1/api/torrents/${path}`);
    for (const [name, value] of params) url.searchParams.append(name, String(value));
    let response;
    try {
      response = await this.fetchFn(url, { method: form ? 'POST' : 'GET', body: form, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const payload = await jsonFromResponse(response, 8 * 1024 * 1024);
      if (!response.ok || payload?.success !== true) {
        const error = payload?.error;
        let message = 'TorBox could not complete this request.';
        if (error === 'PLAN_RESTRICTED_FEATURE') message = 'TorBox restricts this operation on the current account. No account upgrade was made.';
        else if (response.status === 429) message = 'TorBox is rate limiting requests. Please try again later.';
        else if (/CACHE|CACHED/.test(typeof error === 'string' ? error : '')) message = 'This source is no longer cached. Use Prepare to request a download.';
        else if ([401, 403].includes(response.status)) message = 'TorBox rejected this operation. Check the account connection.';
        const e = new AppError(creating && response.status >= 500 && error !== 'PLAN_RESTRICTED_FEATURE' ? 'CREATE_UNCERTAIN' : 'TORBOX_OPERATION_FAILED', message, response.status === 429 ? 429 : 502);
        throw e;
      }
      return payload.data;
    } catch (e) {
      if (e instanceof AppError && (!creating || ['TORBOX_OPERATION_FAILED', 'CREATE_UNCERTAIN', 'TORBOX_NOT_CONFIGURED'].includes(e.code))) throw e;
      throw new AppError(creating ? 'CREATE_UNCERTAIN' : 'TORBOX_UNAVAILABLE', creating ? 'The TorBox response was interrupted. Check status before trying to add this source again.' : 'TorBox could not be reached. Availability is unknown.', 502);
    }
  }
  async cached(hashes) {
    if (!hashes.length) return {};
    const data = await this.call('checkcached', { params: [...hashes.map(hash => ['hash', hash]), ['format', 'object'], ['list_files', 'false']] });
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('CACHE_SCHEMA', 'TorBox returned an unreadable cache response.');
    const result = {};
    for (const hash of hashes) {
      const row = data[hash];
      result[hash] = row === true || (!!row && typeof row === 'object');
    }
    return result;
  }
  async find(hash) {
    // Reconcile against TorBox before every addition, including after app restarts.
    for (let offset = 0; offset < 10000; offset += 100) {
      const data = await this.provider.request('torrents/mylist', { offset, limit: 100, bypass_cache: true });
      if (!Array.isArray(data)) throw new AppError('LIBRARY_SCHEMA', 'TorBox did not return its torrent list. Nothing was added.');
      if (data.some(t => !t || !validHash(t.hash) || !validId(t.id))) throw new AppError('LIBRARY_SCHEMA', 'TorBox returned incomplete torrent identities. Nothing was added.');
      const found = data.find(t => typeof t.hash === 'string' && t.hash.toLowerCase() === hash);
      if (found) { if (!validId(found.id)) throw new AppError('LIBRARY_SCHEMA', 'The existing torrent has an unreadable identifier.'); return found; }
      if (data.length < 100) return null;
    }
    throw new AppError('LIBRARY_LIMIT', 'The account is too large to safely check for a duplicate. Nothing was added.', 409);
  }
  async create(hash, onlyCached) {
    const form = new FormData();
    form.set('magnet', `magnet:?xt=urn:btih:${hash}`);
    form.set('allow_zip', 'false'); form.set('add_only_if_cached', String(onlyCached));
    const data = await this.call('createtorrent', { form, creating: true });
    if (validId(data?.torrent_id)) return data.torrent_id;
    // TorBox reported success without the identifier the cached add returns. The addition was
    // still accepted, so reconcile it by hash rather than reporting a failure for a torrent that
    // is now in the account. This is a read, so an unconfirmed addition never becomes a duplicate
    // write: any failure below still falls through to CREATE_UNCERTAIN.
    console.warn(JSON.stringify({ event: 'torbox_create_identifier_missing', onlyCached, shape: responseShape(data) }));
    let existing = null;
    try { existing = await this.find(hash); } catch {}
    if (existing) return existing.id;
    throw new AppError('CREATE_UNCERTAIN', 'TorBox accepted the request but did not return a usable identifier. Check status before retrying.', 502);
  }
  async item(id) {
    const data = await this.provider.request('torrents/mylist', { id, bypass_cache: true });
    const row = Array.isArray(data) ? data.find(r => r.id === id) : data;
    if (!row || row.id !== id) throw new AppError('PREPARED_ITEM_MISSING', 'The selected torrent is not currently in your account. Reopen the source list.', 404);
    return row;
  }
}
export class Discovery {
  constructor({ provider, fetchFn = fetch, catalog, gateway, now = Date.now } = {}) {
    this.catalog = catalog || new Catalog({ fetchFn, now });
    this.gateway = gateway || new TorrentGateway({ provider, fetchFn });
    this.now = now; this.tickets = new Map(); this.operations = new Map();
  }
  prune() {
    for (const [id, row] of this.tickets) if (row.until <= this.now()) this.tickets.delete(id);
    for (const [hash, op] of this.operations) if (!op.promise && !op.uncertain && this.now() - op.at > 86400000) this.operations.delete(hash);
  }
  revoke(sessionId) { for (const [id, row] of this.tickets) if (row.sessionId === sessionId) this.tickets.delete(id); }
  revokeAll() { this.tickets.clear(); }
  ticket(id, sessionId) {
    const row = this.tickets.get(id);
    if (!row || row.sessionId !== sessionId || row.until <= this.now()) throw new AppError('SOURCE_EXPIRED', 'This source selection expired. Reopen the title and choose a version again.', 404);
    return row;
  }
  async register(input, sessionId) {
    let target;
    try { target = targetOf(input.target); } catch { throw new AppError('INVALID_TARGET', 'Choose a valid title and episode.', 400); }
    if (!Array.isArray(input.sources) || input.sources.length > MAX_SOURCES) throw new AppError('INVALID_SOURCES', 'The source list is too large or unreadable.', 400);
    const meta = await this.catalog.meta(target.type, target.id);
    if (target.type === 'series') {
      const ep = meta.episodes.find(e => e.season === target.season && e.episode === target.episode);
      if (!ep) throw new AppError('EPISODE_NOT_FOUND', 'The selected episode is not in this show.', 400);
      if (ep.released && Date.parse(ep.released) > this.now()) throw new AppError('EPISODE_NOT_RELEASED', 'This episode has not been released yet.', 409);
    }
    const sources = normalizeSources(input.sources);
    if (input.sources.length && !sources.length) throw new AppError('INVALID_SOURCES', 'No supported torrent hashes were supplied.', 400);
    this.prune();
    if (this.tickets.size + sources.length > 2000) throw new AppError('SOURCE_CAPACITY', 'Too many source selections are open. Try again later.', 429);
    let cache = {}, warning = '';
    try { cache = await this.gateway.cached([...new Set(sources.map(s => s.hash))]); }
    catch { warning = 'Sources were found, but TorBox availability could not be checked. Their cached status is unknown.'; }
    const rows = sources.map(source => {
      const cached = typeof cache[source.hash] === 'boolean' ? cache[source.hash] : null;
      const id = randomUUID();
      this.tickets.set(id, { source, target, sessionId, until: this.now() + 1800000 });
      return { id, title: source.title, label: source.label, provider: source.provider, providers: source.providers, filename: source.filename, quality: source.quality, hint: source.hint, size: source.size, seeders: source.seeders, releaseQuality: source.releaseQuality, container: source.container, resolution: source.resolution, cached, browserFriendly: source.browserFriendly, audioRisk: source.audioRisk, videoRisk: source.videoRisk, videoCodec: source.videoCodec, audioCodecs: source.audioCodecs, score: source.score + (cached ? 8 : 0) };
    }).sort((a, b) => b.score - a.score);
    return { sources: rows, warning, target, state: sources.length ? 'sources_found' : 'no_sources' };
  }
  async prepare(id, sessionId, onlyCached = false) {
    const row = this.ticket(id, sessionId), hash = row.source.hash;
    row.until = this.now() + 86400000;
    let operation = this.operations.get(hash);
    if (!operation) {
      this.prune();
      if (this.operations.size >= 500) throw new AppError('PREPARATION_CAPACITY', 'Too many preparation records are open. No torrent was added.', 429);
      operation = { at: this.now(), torrentId: null, uncertain: false, promise: null }; this.operations.set(hash, operation);
    }
    if (!operation.promise && operation.torrentId === null) {
      operation.promise = (async () => {
        const existing = await this.gateway.find(hash);
        if (existing) { operation.torrentId = existing.id; operation.uncertain = false; return; }
        if (operation.uncertain) throw new AppError('CREATE_UNCERTAIN', 'The previous addition is still unconfirmed. Use Check status; this app will not send a duplicate request.', 409);
        try { operation.torrentId = await this.gateway.create(hash, onlyCached); }
        catch (e) { if (!(e instanceof AppError) || e.code === 'CREATE_UNCERTAIN') operation.uncertain = true; throw e; }
      })().finally(() => { operation.promise = null; });
    }
    if (operation.promise) await operation.promise;
    return this.status(id, sessionId);
  }
  async status(id, sessionId, explicitVideoId) {
    const row = this.ticket(id, sessionId), op = this.operations.get(row.source.hash);
    if (!op) return { state: 'not_started', message: 'Choose Play or Prepare to use this source.' };
    if (op.promise) return { state: 'preparing', message: 'TorBox is processing your request.', progress: null };
    if (op.uncertain && op.torrentId === null) {
      const existing = await this.gateway.find(row.source.hash);
      if (existing) { op.torrentId = existing.id; op.uncertain = false; }
      else return { state: 'uncertain', message: 'The addition has not been confirmed. Nothing will be added again automatically.' };
    }
    if (op.torrentId === null) return { state: 'not_started', message: 'No torrent was added. You can retry this explicit action.' };
    const item = await this.gateway.item(op.torrentId);
    if (!validHash(item.hash) || item.hash.toLowerCase() !== row.source.hash) throw new AppError('TORRENT_IDENTITY_MISMATCH', 'TorBox returned a different torrent. Playback was stopped.', 502);
    if (['error', 'failed'].includes(String(item.download_state).toLowerCase())) return { state: 'unavailable', message: 'TorBox reported that this source failed. Choose another version.' };
    if (item.download_finished !== true || item.download_present !== true) {
      if (item.download_finished === true && item.download_present === false) return { state: 'unavailable', message: 'This torrent is no longer available in TorBox. Choose another version.' };
      return { state: 'preparing', message: 'TorBox is preparing this source. You can leave and choose it again later.', progress: typeof item.progress === 'number' && item.progress >= 0 && item.progress <= 1 ? item.progress : null };
    }
    const files = normalizeItem('torrents', item);
    const { file, candidates } = chooseVideo(files, row.target, row.source, explicitVideoId);
    if (file) return { state: 'ready', file, target: row.target, compatibility: { browserFriendly: row.source.browserFriendly, audioRisk: row.source.audioRisk, videoRisk: row.source.videoRisk, hint: row.source.hint, videoCodec: row.source.videoCodec, audioCodecs: row.source.audioCodecs }, message: row.source.audioRisk ? 'This version is ready, but its Dolby/DTS audio may play silently in Chrome. Choose another version for sound, or play it anyway.' : 'The selected file is ready. Browser playback depends on its codecs.' };
    if (!candidates.length) return { state: 'unavailable', message: 'No video could be confidently matched to the selected title or episode. Choose another source.' };
    return { state: 'choose_file', message: 'Choose the correct video from this version. No file has been played automatically.', files: candidates };
  }
}
export async function discoveryBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new AppError('JSON_REQUIRED', 'Send a JSON request.', 415);
  const parts = []; let size = 0;
  for await (const b of request) { size += b.length; if (size > 65536) throw new AppError('REQUEST_TOO_LARGE', 'This source request is too large.', 413); parts.push(b); }
  try { const d = JSON.parse(Buffer.concat(parts).toString('utf8')); if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(); return d; }
  catch { throw new AppError('INVALID_JSON', 'This source request could not be read.', 400); }
}

export class AppError extends Error {
  constructor(code, message, status = 502) { super(message); this.code = code; this.status = status; }
}
export const KINDS = Object.freeze({ torrents: 'torrent_id', webdl: 'web_id', usenet: 'usenet_id' });
export const TORBOX_MEDIA_HOSTS = Object.freeze(['torbox.app', 'tb-cdn.cx', 'tb-cdn.io', 'tb-cdn.pw', 'tb-cdn.sh', 'tb-cdn.st', 'tb-cdn.to', 'tb-cdn.earth']);
const videoExtension = /\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts|mpg|mpeg|wmv|ogv)$/i;
const safeText = (value, fallback = '') => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 700) : fallback;
const idOk = value => Number.isSafeInteger(value) && value >= 0;
export function parseVideoId(value) {
  const m = /^(torrents|webdl|usenet):([0-9]{1,12}):([0-9]{1,12})$/.exec(value || '');
  if (!m) throw new AppError('BAD_VIDEO_ID', 'This file identifier is not valid.', 400);
  return { kind: m[1], itemId: Number(m[2]), fileId: Number(m[3]) };
}
export function availability(item) {
  if (item.download_finished === true && item.download_present === true) return 'Ready to watch';
  if (item.download_finished === true && item.download_present === false) return 'Unavailable';
  if (item.download_finished === false) return 'Preparing';
  return 'Unable to check';
}
export function normalizeItem(kind, item) {
  if (!item || !idOk(item.id)) throw new AppError('PROVIDER_SCHEMA', 'TorBox returned an unrecognized library item. No saved progress was changed.');
  const state = availability(item);
  const files = Array.isArray(item.files) ? item.files : [];
  return files.filter(file => idOk(file.id) && (videoExtension.test(file.short_name || file.name || '') || /^video\//i.test(file.mimetype || ''))).map(file => ({
    id: `${kind}:${item.id}:${file.id}`,
    title: safeText(file.short_name || file.name, `File ${file.id}`),
    collection: safeText(item.name, `Item ${item.id}`),
    size: Number.isFinite(file.size) ? file.size : null,
    mime: /^video\/[a-z0-9.+-]+$/i.test(file.mimetype || '') ? file.mimetype : '',
    state,
    compatibility: 'Browser compatibility not yet verified',
    providerProgress: typeof item.progress === 'number' && item.progress >= 0 && item.progress <= 1 ? item.progress : null
  }));
}
export function validatedPlaybackUrl(value, hosts = TORBOX_MEDIA_HOSTS) {
  if (typeof value !== 'string' || value.length > 16000) throw new AppError('PROVIDER_SCHEMA', 'TorBox did not return a usable playback URL.');
  let url;
  try { url = new URL(value); } catch { throw new AppError('PROVIDER_SCHEMA', 'TorBox returned an invalid playback URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || host === 'api.torbox.app' || !hosts.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new AppError('MEDIA_HOST_NOT_VERIFIED', 'The returned media host has not been verified for this player.');
  }
  url.hash = '';
  return url.href;
}
export function safePlaybackUrl(value, apiKey, hosts = TORBOX_MEDIA_HOSTS) {
  const href = validatedPlaybackUrl(value, hosts);
  let decoded;
  try { decoded = decodeURIComponent(href); } catch { decoded = href; }
  if (apiKey && (href.includes(apiKey) || decoded.includes(apiKey))) throw new AppError('UNSAFE_PROVIDER_URL', 'TorBox returned a link containing the master key. Direct browser playback was blocked.');
  return href;
}
export class TorBox {
  constructor({ key = '', fetchFn = fetch, timeoutMs = 15000, now = Date.now, mediaHosts = TORBOX_MEDIA_HOSTS } = {}) {
    Object.assign(this, { key, fetchFn, timeoutMs, now, mediaHosts });
    this.cache = new Map(); this.inflight = new Map(); this.cooldownUntil = 0;
  }
  async request(path, params = {}, { tokenInQuery = false } = {}) {
    if (!this.key) throw new AppError('TORBOX_NOT_CONFIGURED', 'Add TORBOX_API_KEY in Render, then save and deploy.', 503);
    if (this.now() < this.cooldownUntil) throw new AppError('TORBOX_RATE_LIMITED', 'TorBox asked this player to slow down. Try again in a minute.', 429);
    const url = new URL(`https://api.torbox.app/v1/api/${path}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    const headers = { Accept: 'application/json' };
    if (tokenInQuery) url.searchParams.set('token', this.key); else headers.Authorization = `Bearer ${this.key}`;
    try {
      const response = await this.fetchFn(url, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if ([401, 403].includes(response.status)) throw new AppError('TORBOX_ACCESS_DENIED', 'TorBox rejected this request. Check the key and this account\'s permissions.', 502);
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        this.cooldownUntil = this.now() + Math.min(300, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) * 1000;
        throw new AppError('TORBOX_RATE_LIMITED', 'TorBox asked this player to slow down. Try again in a minute.', 429);
      }
      if (!response.ok) { console.warn(JSON.stringify({ event: 'torbox_request_failed', path, status: response.status })); throw new AppError('TORBOX_HTTP_ERROR', 'TorBox could not complete this request. Try again later.'); }
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 8 * 1024 * 1024) throw new AppError('PROVIDER_RESPONSE_TOO_LARGE', 'This TorBox response is too large for the integration checkpoint.');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new AppError('PROVIDER_SCHEMA', 'TorBox returned a response this player could not read.'); }
      if (!payload || payload.success !== true) {
        console.warn(JSON.stringify({ event: 'torbox_request_rejected', path, error: typeof payload?.error === 'string' ? payload.error.slice(0, 80) : null, detail: typeof payload?.detail === 'string' ? payload.detail.slice(0, 200) : null }));
        throw new AppError('TORBOX_REQUEST_FAILED', 'TorBox reported that the request failed. The library has not been cleared.');
      }
      return payload.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new AppError('TORBOX_TIMEOUT', 'TorBox took too long to respond. Please try again.', 504);
      throw new AppError('TORBOX_CONNECTION_ERROR', 'The server could not reach TorBox. Please try again later.');
    }
  }
  async postJson(path, body = {}) {
    if (!this.key) throw new AppError('TORBOX_NOT_CONFIGURED', 'Add TORBOX_API_KEY in Render, then save and deploy.', 503);
    if (this.now() < this.cooldownUntil) throw new AppError('TORBOX_RATE_LIMITED', 'TorBox asked this player to slow down. Try again in a minute.', 429);
    const url = new URL(`https://api.torbox.app/v1/api/${path}`);
    let response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if ([401, 403].includes(response.status)) throw new AppError('TORBOX_ACCESS_DENIED', 'TorBox rejected this request. Check the account connection.', 502);
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        this.cooldownUntil = this.now() + Math.min(300, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) * 1000;
        throw new AppError('TORBOX_RATE_LIMITED', 'TorBox asked this player to slow down. Try again in a minute.', 429);
      }
      if (!response.ok) throw new AppError('TORBOX_HTTP_ERROR', 'TorBox could not complete this request. Try again later.');
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text) return null;
      let payload;
      try { payload = JSON.parse(text); } catch { throw new AppError('PROVIDER_SCHEMA', 'TorBox returned a response this player could not read.'); }
      if (payload && payload.success === false) throw new AppError('TORBOX_REQUEST_FAILED', 'TorBox reported that the request failed.');
      return payload && Object.hasOwn(payload, 'data') ? payload.data : payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new AppError('TORBOX_TIMEOUT', 'TorBox took too long to respond. Please try again.', 504);
      throw new AppError('TORBOX_CONNECTION_ERROR', 'The server could not reach TorBox. Please try again later.');
    } finally {
      try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
    }
  }
  async integrationJobs() {
    const data = await this.request('integration/jobs');
    if (!Array.isArray(data)) throw new AppError('PROVIDER_SCHEMA', 'TorBox returned an unreadable integration-job list.');
    return data;
  }
  async queueGoogleDrive(resolved, googleToken) {
    if (!resolved || !Object.hasOwn({ torrents: 1, usenet: 1, webdl: 1 }, resolved.kind) || !Number.isSafeInteger(resolved.itemId) || !Number.isSafeInteger(resolved.fileId)) {
      throw new AppError('BAD_VIDEO_ID', 'This file identifier is not valid.', 400);
    }
    if (typeof googleToken !== 'string' || googleToken.length < 20 || googleToken.length > 4096) throw new AppError('DRIVE_TOKEN_INVALID', 'Google Drive authorization is missing or expired.', 400);
    const type = { torrents: 'torrent', usenet: 'usenet', webdl: 'webdownload' }[resolved.kind];
    return this.postJson('integration/googledrive', { id: resolved.itemId, type, file_id: resolved.fileId, google_token: googleToken });
  }
  async list(kind, offset = 0, refresh = false) {
    if (!Object.hasOwn(KINDS, kind) || !Number.isSafeInteger(offset) || offset < 0 || offset > 20000 || offset % 100) throw new AppError('BAD_LIBRARY_PAGE', 'This library page is not valid.', 400);
    const key = `${kind}:${offset}`, cached = this.cache.get(key);
    if (!refresh && cached && this.now() - cached.time < 60000) return { ...cached.data, stale: false };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const operation = (async () => {
      try {
        const raw = await this.request(`${kind}/mylist`, { offset, limit: 100, ...(refresh ? { bypass_cache: true } : {}) });
        if (!Array.isArray(raw)) throw new AppError('PROVIDER_SCHEMA', 'TorBox did not return a library list.');
        const data = { files: raw.flatMap(item => normalizeItem(kind, item)), nextOffset: raw.length === 100 ? offset + 100 : null, updatedAt: new Date().toISOString() };
        if (this.cache.size >= 100 && !this.cache.has(key)) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { data, time: this.now() });
        return { ...data, stale: false };
      } catch (error) {
        if (cached) return { ...cached.data, stale: true, warning: error instanceof AppError ? error.message : 'Refresh failed; showing the earlier library snapshot.' };
        throw error;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, operation);
    return operation;
  }
  async resolveFile(videoId) {
    const { kind, itemId, fileId } = parseVideoId(videoId);
    const data = await this.request(`${kind}/mylist`, { id: itemId, bypass_cache: true });
    const item = Array.isArray(data) ? data.find(row => row.id === itemId) : data;
    if (!item || item.id !== itemId) throw new AppError('FILE_REMOVED', 'This item is no longer in the TorBox account.', 404);
    const file = normalizeItem(kind, item).find(row => row.id === videoId);
    if (!file) throw new AppError('FILE_REMOVED', 'This video file is no longer available.', 404);
    if (file.state !== 'Ready to watch') throw new AppError('FILE_NOT_READY', `This file is ${file.state.toLowerCase()}. Refresh the library before trying again.`, 409);
    return { kind, itemId, fileId, file };
  }
  async resolve(videoId) {
    const resolved = await this.resolveFile(videoId);
    const link = await this.request(`${resolved.kind}/requestdl`, { [KINDS[resolved.kind]]: resolved.itemId, file_id: resolved.fileId, zip_link: false, redirect: false }, { tokenInQuery: true });
    return { file: resolved.file, url: safePlaybackUrl(link, this.key, this.mediaHosts), delivery: 'direct', conversion: false };
  }
  async resolveForRelay(videoId) {
    const resolved = await this.resolveFile(videoId);
    const link = await this.request(`${resolved.kind}/requestdl`, { [KINDS[resolved.kind]]: resolved.itemId, file_id: resolved.fileId, zip_link: false, redirect: false }, { tokenInQuery: true });
    return { file: resolved.file, upstreamUrl: validatedPlaybackUrl(link, this.mediaHosts) };
  }
  async resolveGuest(videoId) {
    const resolved = await this.resolveFile(videoId);
    const url = new URL(`https://api.torbox.app/v1/api/${resolved.kind}/requestdl`);
    url.searchParams.set(KINDS[resolved.kind], String(resolved.itemId));
    url.searchParams.set('file_id', String(resolved.fileId));
    url.searchParams.set('zip_link', 'false');
    url.searchParams.set('redirect', 'true');
    url.searchParams.set('token', this.key);
    let response;
    try {
      response = await this.fetchFn(url, { method: 'GET', headers: { Accept: '*/*' }, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      if ([401, 403].includes(response.status)) throw new AppError('TORBOX_ACCESS_DENIED', 'TorBox rejected this request. Check the account connection.', 502);
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        this.cooldownUntil = this.now() + Math.min(300, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) * 1000;
        throw new AppError('TORBOX_RATE_LIMITED', 'TorBox asked this player to slow down. Try again in a minute.', 429);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) throw new AppError('GUEST_LINK_UNAVAILABLE', 'TorBox did not return a temporary guest-safe playback redirect.', 502);
      const location = response.headers.get('location');
      if (!location) throw new AppError('GUEST_LINK_UNAVAILABLE', 'TorBox did not return a temporary playback destination.', 502);
      const href = new URL(location, url).href;
      return { file: resolved.file, url: safePlaybackUrl(href, this.key, this.mediaHosts), delivery: 'direct', conversion: false };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('GUEST_LINK_UNAVAILABLE', 'TorBox could not generate a temporary guest-safe playback link.', 502);
    } finally {
      try { await response?.body?.cancel(); } catch {}
    }
  }
  async account() {
    const data = await this.request('user/me', { settings: false });
    if (!data || typeof data !== 'object') throw new AppError('PROVIDER_SCHEMA', 'TorBox returned an unreadable account response.');
    const planCode = (typeof data.plan === 'number' || typeof data.plan === 'string') ? String(data.plan).slice(0, 40) : 'not supplied';
    return { valid: true, planCode, checkedAt: new Date().toISOString(), planEntitlementsVerified: false };
  }
}

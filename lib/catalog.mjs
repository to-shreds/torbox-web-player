import { AppError } from './torbox.mjs';
import { cleanText } from '../public/source-client.js';
export const CATALOG_ORIGIN = 'https://v3-cinemeta.strem.io';
export const POSTER_HOSTS = Object.freeze(['images.metahub.space', 'image.tmdb.org', 'm.media-amazon.com']);
export function catalogIdentity(type, id) {
  if (!['movie', 'series'].includes(type) || (id !== undefined && !/^tt[0-9]{5,12}$/.test(id))) throw new AppError('INVALID_TITLE', 'Choose a valid movie or show.', 400);
}
export async function jsonFromResponse(response, limit = 4 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('INVALID_PROVIDER_RESPONSE', 'The provider returned an empty response.');
  const parts = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new AppError('PROVIDER_RESPONSE_TOO_LARGE', 'The provider response was too large.'); parts.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new AppError('INVALID_PROVIDER_RESPONSE', 'The provider response could not be read.'); }
}
export function posterUrl(value) {
  try { const u = new URL(value); if (u.protocol === 'https:' && !u.username && !u.password && !u.port && POSTER_HOSTS.includes(u.hostname)) return u.href; } catch {}
  return '';
}
export function normalizeMeta(raw, type, id) {
  if (!raw || raw.id !== id || (raw.type && raw.type !== type) || typeof raw.name !== 'string') throw new AppError('INVALID_METADATA', 'The catalog returned metadata for a different or unrecognized title.');
  const meta = { id, type, name: cleanText(raw.name, 250), description: cleanText(raw.description, 4000), poster: posterUrl(raw.poster), year: cleanText(String(raw.releaseInfo || raw.year || ''), 30), genres: (Array.isArray(raw.genres) ? raw.genres : []).filter(x => typeof x === 'string').slice(0, 8).map(x => cleanText(x, 50)), runtime: cleanText(raw.runtime, 40), episodes: [] };
  if (type === 'series') {
    const seen = new Set();
    for (const e of Array.isArray(raw.videos) ? raw.videos.slice(0, 20000) : []) {
      const season = e.season, episode = e.episode ?? e.number;
      if (!Number.isSafeInteger(season) || season < 0 || season > 999 || !Number.isSafeInteger(episode) || episode < 1 || episode > 9999) continue;
      const key = `${id}:${season}:${episode}`;
      if (e.id && e.id !== key) continue;
      if (seen.has(key)) continue; seen.add(key);
      const released = Number.isFinite(Date.parse(e.released || e.firstAired)) ? new Date(e.released || e.firstAired).toISOString() : null;
      meta.episodes.push({ id: key, season, episode, name: cleanText(e.name || e.title, 250) || `Episode ${episode}`, description: cleanText(e.description || e.overview, 800), released });
    }
    meta.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return meta;
}
export class Catalog {
  constructor({ fetchFn = fetch, now = Date.now } = {}) { this.fetchFn = fetchFn; this.now = now; this.cache = new Map(); this.inflight = new Map(); }
  async request(path) {
    let response;
    try {
      response = await this.fetchFn(CATALOG_ORIGIN + path, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new AppError('CATALOG_UNAVAILABLE', 'The catalog is unavailable right now. Your TorBox files remain accessible.', response.status === 429 ? 429 : 502); }
      return await jsonFromResponse(response);
    } catch (e) { if (e instanceof AppError) throw e; throw new AppError('CATALOG_UNAVAILABLE', 'The catalog could not be reached. Your TorBox files remain accessible.', 502); }
  }
  async remember(key, read) {
    const old = this.cache.get(key);
    if (old && old.until > this.now()) return old.value;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const task = read().then(value => {
      if (this.cache.size >= 200) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, { value, until: this.now() + 300000 }); return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task); return task;
  }
  async search({ type = 'movie', q = '', skip = 0, genre = '' } = {}) {
    catalogIdentity(type);
    if (typeof q !== 'string' || q.length > 150 || !Number.isSafeInteger(skip) || skip < 0 || skip > 10000 || typeof genre !== 'string' || genre.length > 40 || /[\u0000-\u001f]/.test(q + genre)) throw new AppError('INVALID_SEARCH', 'That catalog search is not valid.', 400);
    q = q.trim();
    if (/^tt[0-9]{5,12}$/.test(q)) return { metas: skip === 0 ? [await this.meta(type, q)] : [], nextSkip: null, provider: 'Cinemeta' };
    const params = []; if (q) params.push(`search=${encodeURIComponent(q)}`); if (genre) params.push(`genre=${encodeURIComponent(genre)}`); if (skip) params.push(`skip=${skip}`);
    const path = `/catalog/${type}/top${params.length ? '/' + params.join('&') : ''}.json`;
    return this.remember(path, async () => {
      const data = await this.request(path);
      if (!Array.isArray(data?.metas)) throw new AppError('INVALID_CATALOG', 'The catalog did not return a title list.');
      const metas = [], seen = new Set();
      for (const row of data.metas.slice(0, 200)) {
        if (!row || !/^tt[0-9]{5,12}$/.test(row.id || '') || seen.has(row.id)) continue;
        try { const m = normalizeMeta(row, type, row.id); m.episodes = []; metas.push(m); seen.add(m.id); } catch {}
      }
      if (data.metas.length && !metas.length) throw new AppError('INVALID_CATALOG', 'The catalog returned titles this app could not read.');
      return { metas, nextSkip: data.metas.length >= 100 ? skip + Math.min(data.metas.length, 200) : null, provider: 'Cinemeta' };
    });
  }
  async meta(type, id) {
    catalogIdentity(type, id);
    return this.remember(`meta:${type}:${id}`, async () => normalizeMeta((await this.request(`/meta/${type}/${id}.json`))?.meta, type, id));
  }
}

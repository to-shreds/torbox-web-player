import { AppError } from './torbox.mjs';
import { cleanText } from '../public/source-client.js';
export const CATALOG_ORIGIN = 'https://v3-cinemeta.strem.io';
export const CATALOG_SECONDARY = 'https://cinemeta-catalogs.strem.io';
export const POSTER_HOSTS = Object.freeze(['images.metahub.space', 'image.tmdb.org', 'm.media-amazon.com']);
export const BROWSE_FEEDS = Object.freeze({ popular: 'top', featured: 'imdbRating', new: 'year' });
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
function searchText(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
const SEARCH_STOPWORDS=new Set(['a','an','and','at','by','for','from','in','of','on','or','the','to','with']);
function searchTokens(value){return searchText(value).split(' ').filter(token=>token.length>=2&&!SEARCH_STOPWORDS.has(token));}
function searchTitleRelevant(name,query){
  const title=searchText(name),needle=searchText(query);if(!title||!needle)return false;
  if(title===needle||title.includes(needle)||needle.includes(title))return true;
  const wanted=searchTokens(needle),have=searchTokens(title);if(!wanted.length)return title.includes(needle);
  let matched=0;for(const token of wanted)if(have.some(candidate=>candidate===token||(token.length>=3&&candidate.startsWith(token))||(candidate.length>=3&&token.startsWith(candidate))))matched++;
  return matched>=Math.max(1,Math.ceil(wanted.length*.5));
}

export function normalizeMeta(raw, type, id) {
  const rawId = raw?.id || raw?.imdb_id;
  if (!raw || rawId !== id || (raw.type && raw.type !== type) || typeof raw.name !== 'string') throw new AppError('INVALID_METADATA', 'The catalog returned metadata for a different or unrecognized title.');
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
  async requestUrl(input,timeoutMs=12000) {
    let response;
    try {
      let url = new URL(input);
      for (let hop = 0; hop < 2; hop++) {
        const trusted = url.protocol === 'https:' && [new URL(CATALOG_ORIGIN).hostname,new URL(CATALOG_SECONDARY).hostname].includes(url.hostname) && !url.username && !url.password && !url.port;
        if(!trusted)throw new AppError('CATALOG_UNAVAILABLE','The catalog target was not trusted.',502);
        response = await this.fetchFn(url.href, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        if ([301,302,303,307,308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel().catch(() => {});
          if (!location) throw new AppError('CATALOG_UNAVAILABLE', 'The catalog redirect was incomplete.', 502);
          url = new URL(location, url);
          continue;
        }
        if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new AppError('CATALOG_  async search({ type = 'movie', q = '', skip = 0, genre = '', feed = 'popular' } = {}) {
    if (!['movie','series','all'].includes(type) || (type==='all'&&!String(q||'').trim())) throw new AppError('INVALID_SEARCH','Choose Movies or Shows.',400);
    if (typeof q !== 'string' || q.length > 150 || !Number.isSafeInteger(skip) || skip < 0 || skip > 10000 || typeof genre !== 'string' || genre.length > 40 || !Object.hasOwn(BROWSE_FEEDS, feed) || /[\u0000-\u001f]/.test(q + genre)) throw new AppError('INVALID_SEARCH', 'That catalog search is not valid.', 400);
    q=q.trim();
    if(type==='all'){
      const kinds=['movie','series'];
      if(/^tt[0-9]{5,12}$/.test(q)){
        if(skip)return{metas:[],nextSkip:null,provider:'Cinemeta',feed:'search'};
        const checked=await Promise.allSettled(kinds.map(kind=>this.meta(kind,q)));
        const metas=checked.filter(row=>row.status==='fulfilled').map(row=>row.value);
        if(!metas.length)throw checked.find(row=>row.status==='rejected')?.reason||new AppError('CATALOG_UNAVAILABLE','The catalog could not find that IMDb title.',502);
        return{metas,nextSkip:null,provider:'Cinemeta',feed:'search'};
      }
      const checked=await Promise.allSettled(kinds.map(kind=>this.search({type:kind,q,skip,genre:'',feed:'popular'})));
      const results=checked.filter(row=>row.status==='fulfilled').map(row=>row.value);
      if(!results.length)throw checked.find(row=>row.status==='rejected')?.reason||new AppError('CATALOG_UNAVAILABLE','The catalog search is unavailable.',502);
      const byId=new Map();
      for(const result of results)for(const meta of result.metas||[]){
        const old=byId.get(meta.id),score=x=>(x.poster?8:0)+(x.year?2:0)+(x.description?2:0)+(x.genres?.length||0);
        if(!old||score(meta)>score(old))byId.set(meta.id,meta);
      }
      const needle=searchText(q),metas=[...byId.values()].sort((a,b)=>Number(searchText(b.name)===needle)-Number(searchText(a.name)===needle)||Number(searchText(b.name).startsWith(needle))-Number(searchText(a.name).startsWith(needle)));
      const next=results.map(row=>row.nextSkip).filter(Number.isFinite);
      return{metas,nextSkip:next.length?Math.max(...next):null,provider:'Cinemeta',feed:'search'};
    }
    catalogIdentity(type);
    if (/^tt[0-9]{5,12}$/.test(q)) return { metas: skip === 0 ? [await this.meta(type, q)] : [], nextSkip: null, provider: 'Cinemeta', feed: 'search' };
    const normalize = (data, localGenre = '') => {
      if (!Array.isArray(data?.metas)) throw new AppError('INVALID_CATALOG', 'The catalog did not return a title list.');
      const metas = [], seen = new Set();
      for (const row of data.metas.slice(0, 200)) {
        const rowId = row?.id || row?.imdb_id;
        if (!row || !/^tt[0-9]{5,12}$/.test(rowId || '') || seen.has(rowId)) continue;
        try {
          const m = normalizeMeta(row, type, rowId); m.episodes = [];
          if (localGenre && !m.genres.some(g => g.toLowerCase() === localGenre.toLowerCase())) continue;
          metas.push(m); seen.add(rowId);
        } catch {}
      }
      if (data.metas.length && !metas.length && !localGenre) throw new AppError('INVALID_CATALOG', 'The catalog returned titles this app could not read.');
      return { metas, rawCount: data.metas.length };
    };
    const readFeed = async selected => {
      const catalogId = BROWSE_FEEDS[selected],params=[];let localGenre='';
      if(q)params.push('search='+encodeURIComponent(q));
      if(catalogId==='year'){params.push('genre='+new Date().getUTCFullYear());localGenre=genre;}
      else if(genre)params.push('genre='+encodeURIComponent(genre));
      if(skip)params.push('skip='+skip);
      const path='/catalog/'+type+'/'+catalogId+(params.length?'/'+params.join('&'):'')+'.json';
      return this.remember(path,async()=>{
        let data;
        if(q){
          const primary=new URL(path,CATALOG_ORIGIN).href;
          const secondary=new URL('/'+catalogId+path,CATALOG_SECONDARY).href;
          const attempts=[primary,secondary].map(async url=>{
            const payload=await this.requestUrl(url,5000);
            const normalized=normalize(payload,localGenre);
            const metas=normalized.metas.filter(meta=>searchTitleRelevant(meta.name,q));
            if(!metas.length){const error=new AppError('SEARCH_EMPTY','No relevant titles from this search source.',404);error.searchEmpty=true;error.rawCount=normalized.rawCount;throw error;}
            return{metas,rawCount:normalized.rawCount};
          });
          try{data=await Promise.any(attempts);}
          catch(error){
            const reasons=error?.errors||[];
            if(reasons.some(reason=>reason?.searchEmpty))data={metas:[],rawCount:0};
            else throw reasons.at(-1)||error;
          }
        }else data=normalize(await this.request(path),localGenre);
        return { metas: data.metas, nextSkip: data.rawCount >= 100 ? skip + Math.min(data.rawCount, 200) : null, provider: 'Cinemeta', feed: q?'search':selected };
      });
    };
    if (q) return readFeed('popular');
    const order=[feed,...['popular','featured','new'].filter(x=>x!==feed)];let lastError;
    for(const candidate of order){try{const result=await readFeed(candidate);return{...result,requestedFeed:feed,fallback:candidate!==feed};}catch(e){lastError=e;}}
    throw lastError||new AppError('CATALOG_UNAVAILABLE','Browse is temporarily unavailable. Search still works.',502);
  }
(skip) params.push(`skip=${skip}`);
      const path = `/catalog/${type}/${catalogId}${params.length ? '/' + params.join('&') : ''}.json`;
      return this.remember(path, async () => {
        const data = await this.request(path);
        const normalized = normalize(data, localGenre);
        return { metas: normalized.metas, nextSkip: normalized.rawCount >= 100 ? skip + Math.min(normalized.rawCount, 200) : null, provider: 'Cinemeta', feed: selected };
      });
    };
    if (q) return readFeed('popular');
    const order = [feed, ...['popular', 'featured', 'new'].filter(x => x !== feed)];
    let lastError;
    for (const candidate of order) {
      try {
        const result = await readFeed(candidate);
        return { ...result, requestedFeed: feed, fallback: candidate !== feed };
      } catch (e) { lastError = e; }
    }
    throw lastError || new AppError('CATALOG_UNAVAILABLE', 'Browse is temporarily unavailable. Search still works.', 502);
  }
  async meta(type, id) {
    catalogIdentity(type, id);
    return this.remember(`meta:${type}:${id}`, async () => normalizeMeta((await this.request(`/meta/${type}/${id}.json`))?.meta, type, id));
  }
}

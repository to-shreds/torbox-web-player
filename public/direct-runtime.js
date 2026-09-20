import { normalizeSources, targetOf, cleanText, parseSizeBytes } from './source-client.js?v=2.2.0';
import { isTrustedDirectMediaUrl } from './runtime.js?v=2.2.0';

export const DIRECT_BUILD = 'browser-local-2.2.0';

const CATALOG_PRIMARY = 'https://v3-cinemeta.strem.io';
const CATALOG_SECONDARY = 'https://cinemeta-catalogs.strem.io';
const CATALOG_LIVE = 'https://cinemeta-live.strem.io';
const CATALOG_ORIGINS = new Set([CATALOG_PRIMARY,CATALOG_SECONDARY,CATALOG_LIVE].map(value=>new URL(value).hostname));
const SOURCE_ENDPOINTS = Object.freeze({
  zilean: 'https://zileanfortheweebs.midnightignite.me',
  stremthruMain: 'https://stremthru.13377001.xyz/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==',
  stremthruElf: 'https://stremthru.elfhosted.com/stremio/torz/eyJzdG9yZXMiOlt7ImMiOiJwMnAiLCJ0IjoiIn1dfQ==',
  mediafusion: 'https://mediafusion.elfhosted.com/torznab'
});
const TORBOX_ORIGIN = 'https://api.torbox.app/v1/api/';
const TORBOX_RELAY_ORIGIN = 'https://relay.torbox.app/';
const MAX_TRACE = 160;

let credential = '';
let localSession = '';
let lastDiagnostic = null;
const traces = [];
const tickets = new Map();
const operations = new Map();
const catalogCache = new Map();
const sourceCache = new Map();
const SOURCE_CACHE_MS = 90000;

function directError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function trace(op, status, detail = {}) {
  traces.push({ at: new Date().toISOString(), op, status, ...detail });
  if (traces.length > MAX_TRACE) traces.splice(0, traces.length - MAX_TRACE);
}

export function recordDiagnosticEvent(op,status='ok',detail={}){
  const safe={};
  for(const [key,value] of Object.entries(detail||{})){
    if(['provider','resolution','videoCodec'].includes(key)&&typeof value==='string')safe[key]=cleanText(value,80);
    else if(key==='audioCodecs'&&Array.isArray(value))safe[key]=value.filter(v=>typeof v==='string').slice(0,4).map(v=>cleanText(v,40));
    else if(['cached','browserFriendly','audioRisk','videoRisk'].includes(key)&&typeof value==='boolean')safe[key]=value;
  }
  trace(cleanText(op,80),cleanText(status,40),safe);
}

function safeError(error) {
  return String(error?.name || 'Error').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'Error';
}

function validTarget(input) {
  try { return targetOf(input); }
  catch { throw directError('INVALID_TARGET', 'Choose a valid movie or episode.', 400); }
}

function safeJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw directError('INVALID_PROVIDER_RESPONSE', label + ' returned unreadable JSON.'); }
}

async function fetchDirect(label, url, options = {}, timeoutMs = 30000) {
  const started = performance.now();
  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store', ...options, signal });
    trace(label, response.ok ? 'ok' : 'http_error', {
      httpStatus: response.status,
      durationMs: Math.round(performance.now() - started)
    });
    return response;
  } catch (error) {
    trace(label, ['TimeoutError', 'AbortError'].includes(error?.name) ? 'timeout' : 'fetch_error', {
      error: safeError(error),
      durationMs: Math.round(performance.now() - started)
    });
    if (options.signal?.aborted) throw error;
    if (['TimeoutError', 'AbortError'].includes(error?.name)) throw directError('DIRECT_TIMEOUT', label + ' timed out.', 504);
    throw directError(
      'DIRECT_FETCH_BLOCKED',
      label + ' could not be read directly by this browser. This can be caused by the network, DNS, TLS, CORS, or another browser policy. Run diagnostics if it persists.',
      502
    );
  }
}

async function readText(response, max = 8 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw directError('RESPONSE_TOO_LARGE', 'A provider response was too large.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(out);
}

async function readJson(response, max) {
  return safeJson(await readText(response, max), 'The provider');
}

function posterUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['images.metahub.space', 'image.tmdb.org', 'm.media-amazon.com'].includes(url.hostname)
      ? url.href : '';
  } catch {
    return '';
  }
}

function searchText(value){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
const SEARCH_STOPWORDS=new Set(['a','an','and','at','by','for','from','in','of','on','or','the','to','with']);
function searchTokens(value){
  return searchText(value).split(' ').filter(token=>token.length>=2&&!SEARCH_STOPWORDS.has(token));
}
function catalogSearchQuery(path){
  const match=/\/search=([^&]+?)(?:&|\.json$)/.exec(String(path||''));
  if(!match)return'';
  try{return decodeURIComponent(match[1]);}catch{return match[1];}
}
function searchTitleRelevant(name,query){
  const title=searchText(name),needle=searchText(query);if(!title||!needle)return false;
  if(title===needle||title.includes(needle)||needle.includes(title))return true;
  const wanted=searchTokens(needle),have=searchTokens(title);
  if(!wanted.length)return title.includes(needle);
  let matched=0;
  for(const token of wanted){
    if(have.some(candidate=>candidate===token||(token.length>=3&&candidate.startsWith(token))||(candidate.length>=3&&token.startsWith(candidate))))matched++;
  }
  return matched>=Math.max(1,Math.ceil(wanted.length*.5));
}
function filterSearchPayload(value,query){
  if(!Array.isArray(value?.metas))return null;
  return {...value,metas:value.metas.filter(row=>searchTitleRelevant(row?.name,query))};
}


function normalizeMeta(raw, type, id) {
  const rawId = raw?.id || raw?.imdb_id;
  if (!raw || rawId !== id || (raw.type && raw.type !== type) || typeof raw.name !== 'string') {
    throw directError('INVALID_METADATA', 'The catalog returned unrecognized metadata.');
  }
  const meta = {
    id,
    type,
    name: cleanText(raw.name, 250),
    description: cleanText(raw.description, 4000),
    poster: posterUrl(raw.poster),
    year: cleanText(String(raw.releaseInfo || raw.year || ''), 30),
    genres: (Array.isArray(raw.genres) ? raw.genres : []).filter(x => typeof x === 'string').slice(0, 8).map(x => cleanText(x, 50)),
    runtime: cleanText(raw.runtime, 40),
    episodes: []
  };
  if (type === 'series') {
    const seen = new Set();
    for (const episodeRow of Array.isArray(raw.videos) ? raw.videos.slice(0, 20000) : []) {
      const season = episodeRow.season;
      const episode = episodeRow.episode ?? episodeRow.number;
      if (!Number.isSafeInteger(season) || season < 0 || season > 999 || !Number.isSafeInteger(episode) || episode < 1 || episode > 9999) continue;
      const key = id + ':' + season + ':' + episode;
      if ((episodeRow.id && episodeRow.id !== key) || seen.has(key)) continue;
      seen.add(key);
      const released = Number.isFinite(Date.parse(episodeRow.released || episodeRow.firstAired))
        ? new Date(episodeRow.released || episodeRow.firstAired).toISOString()
        : null;
      meta.episodes.push({
        id: key,
        season,
        episode,
        name: cleanText(episodeRow.name || episodeRow.title, 250) || 'Episode ' + episode,
        description: cleanText(episodeRow.description || episodeRow.overview, 800),
        released
      });
    }
    meta.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
  }
  return meta;
}

async function catalogBridgeRequest(path) {
  const cfg=await relayConfig();
  const origins=[cfg.secondary,cfg.primary].filter((value,index,array)=>value&&array.indexOf(value)===index);
  for(const origin of origins){
    const url=new URL('/relay/cinemeta',origin);url.searchParams.set('path',path);
    const started=performance.now();
    try{
      const response=await fetch(url,{headers:{Accept:'application/json'},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(12000)});
      trace('cinemeta_bridge',response.ok?'ok':'http_error',{backend:origin.includes('workers.dev')?'cloudflare':'render',httpStatus:response.status,durationMs:Math.round(performance.now()-started)});
      if(!response.ok)continue;
      return await readJson(response,4*1024*1024);
    }catch(error){
      trace('cinemeta_bridge','fetch_error',{backend:origin.includes('workers.dev')?'cloudflare':'render',error:safeError(error),durationMs:Math.round(performance.now()-started)});
    }
  }
  return null;
}

async function catalogRequest(path) {
  const cached = catalogCache.get(path);
  if (cached && cached.until > Date.now()) return cached.value;
  const catalogMatch = /^\/catalog\/(?:movie|series)\/([A-Za-z0-9_-]+)(?:\/|\.json$)/.exec(path || '');
  const secondaryUrl = catalogMatch ? new URL('/' + catalogMatch[1] + path, CATALOG_SECONDARY).href : '';
  const primaryUrl = new URL(path, CATALOG_PRIMARY).href;
  const searchCatalog = !!secondaryUrl && path.includes('/search='),searchQuery=searchCatalog?catalogSearchQuery(path):'';
  const targets = secondaryUrl
    ? (searchCatalog
        ? [
            { label:'cinemeta_search', url:primaryUrl, delayMs:0 },
            { label:'cinemeta_search_fallback', url:secondaryUrl, delayMs:0 }
          ]
        : [
            { label:'cinemeta_catalog', url:secondaryUrl, delayMs:0 },
            { label:'cinemeta_catalog_fallback', url:primaryUrl, delayMs:0 }
          ])
    : [
        { label:'cinemeta_meta', url:primaryUrl, delayMs:0 },
        { label:'cinemeta_meta_live', url:new URL(path,CATALOG_LIVE).href, delayMs:100 },
        { label:'cinemeta_meta_retry', url:primaryUrl, delayMs:350 }
      ];
  const failures=[];let sawValidSearchPayload=false;
  for (const target of targets) {
    if (target.delayMs) await new Promise(resolve=>setTimeout(resolve,target.delayMs));
    try {
      const response = await fetchDirect(
        target.label,
        target.url,
        { headers: { Accept: 'application/json' }, redirect: 'follow' },
        8000
      );
      const finalUrl = new URL(response.url || target.url);
      if (!CATALOG_ORIGINS.has(finalUrl.hostname)) throw directError('CATALOG_REDIRECT', 'Cinemeta redirected to an unexpected host.');
      if (!response.ok) throw directError('CATALOG_UNAVAILABLE', 'Cinemeta returned HTTP ' + response.status, response.status);
      let value = await readJson(response, 4 * 1024 * 1024);
      if(searchCatalog){
        const filtered=filterSearchPayload(value,searchQuery);
        if(!filtered)throw directError('INVALID_CATALOG','Cinemeta did not return a title list.');
        sawValidSearchPayload=true;
        if(!filtered.metas.length){
          trace('cinemeta_search','irrelevant',{host:finalUrl.hostname,returned:value.metas.length});
          continue;
        }
        value=filtered;
      }
      catalogCache.set(path, { value, until: Date.now() + 300000 });
      return value;
    } catch (error) {
      failures.push(error);
      trace('cinemeta_origin','failed',{host:new URL(target.url).hostname,httpStatus:error?.status||undefined,error:safeError(error)});
    }
  }
  const bridged=await catalogBridgeRequest(path);
  if(bridged){
    if(searchCatalog){
      const filtered=filterSearchPayload(bridged,searchQuery);
      if(filtered){
        sawValidSearchPayload=true;
        if(filtered.metas.length){catalogCache.set(path,{value:filtered,until:Date.now()+300000});return filtered;}
      }
    }else{catalogCache.set(path,{value:bridged,until:Date.now()+300000});return bridged;}
  }
  if(searchCatalog&&sawValidSearchPayload){
    const empty={metas:[]};catalogCache.set(path,{value:empty,until:Date.now()+60000});return empty;
  }
  const last=failures.at(-1);
  const kind=secondaryUrl?'catalog':'metadata';
  throw directError('CATALOG_UNAVAILABLE','Cinemeta '+kind+' is temporarily unavailable directly and through the backup relay. '+(last?.status?('Last HTTP status: '+last.status+'.'):'Check diagnostics if this persists.'),last?.status||502);
}

async function catalogMeta(type, id) {
  if (!['movie', 'series'].includes(type) || !/^tt[0-9]{5,12}$/.test(id || '')) throw directError('INVALID_TITLE', 'Choose a valid movie or show.', 400);
  return normalizeMeta((await catalogRequest('/meta/' + type + '/' + id + '.json'))?.meta, type, id);
}

async function catalogMetaFlexible(type,id) {
  try {
    return await catalogMeta(type,id);
  } catch (error) {
    if (error?.status !== 404 || !['movie','series'].includes(type)) throw error;
    const alternate=type==='movie'?'series':'movie';
    trace('cinemeta_type_recovery','retry',{requested:type,alternate});
    return catalogMeta(alternate,id);
  }
}

async function catalogSearchType({ type, q = '', skip = 0, genre = '', feed = 'popular' } = {}) {
  const ids = { popular: 'top', featured: 'imdbRating', new: 'year' };
  const selected = ids[feed] || 'top';
  const params = [];
  let localGenre = '';
  if (q) params.push('search=' + encodeURIComponent(q));
  if (selected === 'year') {
    params.push('genre=' + new Date().getUTCFullYear());
    localGenre = genre;
  } else if (genre) {
    params.push('genre=' + encodeURIComponent(genre));
  }
  if (skip) params.push('skip=' + skip);
  const path = '/catalog/' + type + '/' + selected + (params.length ? '/' + params.join('&') : '') + '.json';
  const data = await catalogRequest(path);
  if (!Array.isArray(data?.metas)) throw directError('INVALID_CATALOG', 'Cinemeta did not return a title list.');
  const metas = [];
  const seen = new Set();
  for (const row of data.metas.slice(0, 200)) {
    const id = row?.id || row?.imdb_id;
    if (!/^tt[0-9]{5,12}$/.test(id || '') || seen.has(id)) continue;
    try {
      const meta = normalizeMeta(row, type, id);
      meta.episodes = [];
      if (localGenre && !meta.genres.some(g => g.toLowerCase() === localGenre.toLowerCase())) continue;
      metas.push(meta);
      seen.add(id);
    } catch {}
  }
  return {
    metas,
    nextSkip: data.metas.length >= 100 ? skip + Math.min(data.metas.length, 200) : null,
    provider: 'Cinemeta',
    feed: q ? 'search' : feed
  };
}

function catalogCardScore(meta) {
  return (meta.poster?8:0)+(meta.year?2:0)+(meta.runtime?1:0)+(meta.description?2:0)+Math.min(meta.genres?.length||0,4);
}

async function mergeCatalogTypes(results,q) {
  const grouped=new Map();
  for (const result of results) for (const meta of result.metas || []) {
    if(!grouped.has(meta.id))grouped.set(meta.id,[]);
    grouped.get(meta.id).push(meta);
  }
  const needle=String(q||'').trim().toLowerCase();
  const metas=[];
  for (const [id,candidates] of grouped) {
    let selected=[...candidates].sort((a,b)=>catalogCardScore(b)-catalogCardScore(a))[0];
    const types=[...new Set(candidates.map(meta=>meta.type))];
    const exact=candidates.some(meta=>meta.name.toLowerCase()===needle);
    if(types.length>1||exact){
      const checked=await Promise.allSettled(candidates.map(meta=>catalogMetaFlexible(meta.type,id)));
      const valid=[];
      const seen=new Set();
      for(const row of checked){
        if(row.status!=='fulfilled')continue;
        const key=row.value.type+':'+row.value.id;
        if(seen.has(key))continue;
        seen.add(key);valid.push({...row.value,episodes:[]});
      }
      if(valid.length)selected=valid.sort((a,b)=>catalogCardScore(b)-catalogCardScore(a))[0];
      else if(exact)continue;
    }
    metas.push(selected);
  }
  const exactRows=metas.filter(meta=>meta.name.toLowerCase()===needle);
  if(exactRows.length>1){
    const best=[...exactRows].sort((a,b)=>catalogCardScore(b)-catalogCardScore(a))[0];
    const bestScore=catalogCardScore(best);
    for(let index=metas.length-1;index>=0;index--){
      const meta=metas[index];
      if(meta!==best&&meta.name.toLowerCase()===needle&&catalogCardScore(meta)<bestScore-2)metas.splice(index,1);
    }
  }
  metas.sort((a,b)=>{
    const aName=a.name.toLowerCase(),bName=b.name.toLowerCase();
    return Number(bName===needle)-Number(aName===needle)
      || catalogCardScore(b)-catalogCardScore(a)
      || Number(bName.startsWith(needle))-Number(aName.startsWith(needle));
  });
  return metas;
}

async function catalogSearch({ type = 'movie', q = '', skip = 0, genre = '', feed = 'popular' } = {}) {
  q = String(q || '').trim();
  skip = Number(skip) || 0;
  if (!['movie', 'series', 'all'].includes(type) || (type === 'all' && !q)) throw directError('INVALID_SEARCH', 'Choose Movies or Shows.', 400);
  const types=type==='all'?['movie','series']:[type];
  if (/^tt[0-9]{5,12}$/.test(q)) {
    if(skip)return {metas:[],nextSkip:null,provider:'Cinemeta',feed:'search'};
    const checked=await Promise.allSettled(types.map(kind=>catalogMeta(kind,q)));
    const metas=checked.filter(row=>row.status==='fulfilled').map(row=>row.value);
    if(!metas.length)throw checked.find(row=>row.status==='rejected')?.reason||directError('CATALOG_UNAVAILABLE','Cinemeta metadata is temporarily unavailable.',502);
    return { metas: await mergeCatalogTypes([{metas}],q), nextSkip:null, provider:'Cinemeta', feed:'search' };
  }
  if(type!=='all')return catalogSearchType({type,q,skip,genre,feed});
  const checked=await Promise.allSettled(types.map(kind=>catalogSearchType({type:kind,q,skip,genre:'',feed:'popular'})));
  const results=checked.filter(row=>row.status==='fulfilled').map(row=>row.value);
  if(!results.length)throw checked.find(row=>row.status==='rejected')?.reason||directError('CATALOG_UNAVAILABLE','Cinemeta search is temporarily unavailable.',502);
  const nextValues=results.map(row=>row.nextSkip).filter(value=>Number.isFinite(value));
  return {
    metas:await mergeCatalogTypes(results,q),
    nextSkip:nextValues.length?Math.max(...nextValues):null,
    provider:'Cinemeta',
    feed:'search'
  };
}

function inferredResolution(text) {
  const match = /\b(2160p|1440p|1080p|720p|576p|480p|360p|4k)\b/i.exec(text || '');
  return match ? (match[1].toLowerCase() === '4k' ? '4K' : match[1].toLowerCase()) : '';
}

function inferredQuality(text) {
  const match = /\b(WEB[ ._-]?DL|WEBRip|BluRay|BDRip|BRRip|HDRip|HDTV|DVDRip|REMUX|CAM|TS)\b/i.exec(text || '');
  return match ? cleanText(match[1].replace(/[ ._-]+/g, '-'), 40) : '';
}

function inferredContainer(name) {
  return /\.([a-z0-9]{2,6})$/i.exec(name || '')?.[1]?.toLowerCase() || '';
}

function explicitSeeders(stream) {
  for (const value of [stream?.seeders, stream?.seeds, stream?.seedersCount, stream?.behaviorHints?.seeders]) {
    if (Number.isSafeInteger(value) && value >= 0) return value;
  }
  const match = /(?:👤|\bseed(?:er)?s?\b\s*[:=]?)\s*([0-9][0-9,]*)/i.exec(
    [stream?.description, stream?.title, stream?.name].filter(v => typeof v === 'string').join(' ')
  );
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function normalizeZilean(data, input) {
  const selected = validTarget(input);
  if (!Array.isArray(data)) throw directError('SOURCE_RESPONSE_INVALID', 'Zilean returned an unreadable response.');
  const rows = [];
  for (const row of data.slice(0, 2000)) {
    if (!row || row.imdb_id !== selected.id || !/^[a-f0-9]{40}$/i.test(row.info_hash || '') || typeof row.raw_title !== 'string') continue;
    if (selected.type === 'series') {
      if (Array.isArray(row.seasons) && row.seasons.length && !row.seasons.includes(selected.season)) continue;
      if (Array.isArray(row.episodes) && row.episodes.length && !row.episodes.includes(selected.episode)) continue;
    }
    rows.push({
      hash: row.info_hash,
      title: cleanText(row.raw_title, 450),
      label: 'Zilean',
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
  return normalizeSources(rows);
}

function normalizeStremio(data, input, name) {
  validTarget(input);
  if (!data || !Array.isArray(data.streams)) throw directError('SOURCE_RESPONSE_INVALID', name + ' returned an unreadable response.');
  const rows = [];
  for (const stream of data.streams.slice(0, 1500)) {
    const hash = stream?.infoHash || stream?.hash;
    if (!/^[a-f0-9]{40}$/i.test(hash || '')) continue;
    const filename = cleanText(stream.behaviorHints?.filename || stream.filename, 350);
    const text = [filename, stream.description, stream.title, stream.name].filter(v => typeof v === 'string').join(' ');
    rows.push({
      hash,
      filename,
      title: filename || cleanText(stream.description || stream.title || stream.name, 450) || 'Torrent source',
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

function xmlDecode(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[|\]\]>$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

function xmlTag(block, tag) {
  const match = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(block || '');
  return match ? cleanText(xmlDecode(match[1].trim()), 700) : '';
}

function torzAttrs(block) {
  const output = {};
  for (const tag of String(block || '').match(/<torznab:attr\b[^>]*\/?\s*>/gi) || []) {
    const name = /\bname=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const value = /\bvalue=["']([^"']*)["']/i.exec(tag)?.[1];
    if (name && value !== undefined && !Object.hasOwn(output, name)) output[name] = xmlDecode(value);
  }
  return output;
}

function normalizeTorznab(xml, input) {
  const selected = validTarget(input);
  const rows = [];
  for (const item of String(xml || '').match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const attrs = torzAttrs(item);
    const hash = attrs.infohash;
    const title = xmlTag(item, 'title');
    if (!/^[a-f0-9]{40}$/i.test(hash || '') || !title) continue;
    if (/^tt[0-9]{5,12}$/.test(attrs.imdb || '') && attrs.imdb !== selected.id) continue;
    const seedValue = Number(attrs.seeders);
    rows.push({
      hash,
      title,
      filename: '',
      label: 'MediaFusion Torznab',
      provider: 'MediaFusion Torznab',
      fileIdx: null,
      size: parseSizeBytes(xmlTag(item, 'size') || attrs.size),
      seeders: Number.isSafeInteger(seedValue) && seedValue >= 0 ? seedValue : null,
      resolution: inferredResolution(title),
      releaseQuality: inferredQuality(title),
      container: inferredContainer(title),
      videoCodec: '',
      audioCodecs: []
    });
  }
  return normalizeSources(rows);
}

async function sourceZilean(target, signal) {
  const url = new URL('/dmm/filtered', SOURCE_ENDPOINTS.zilean);
  url.searchParams.set('ImdbId', target.id);
  if (target.type === 'series') {
    url.searchParams.set('Season', target.season);
    url.searchParams.set('Episode', target.episode);
  }
  const response = await fetchDirect('zilean', url, { headers: { Accept: 'application/json' }, signal }, 5000);
  if (!response.ok) throw directError('SOURCE_HTTP', 'Zilean returned HTTP ' + response.status, response.status);
  return normalizeZilean(await readJson(response, 4 * 1024 * 1024), target);
}

async function sourceStremthru(target, origin, label, op, signal) {
  const resourceId = target.type === 'series' ? target.id + ':' + target.season + ':' + target.episode : target.id;
  const url = new URL(origin.replace(/\/+$/, '') + '/stream/' + target.type + '/' + resourceId + '.json');
  const response = await fetchDirect(op, url, { headers: { Accept: 'application/json' }, redirect: 'follow', signal }, 6000);
  if (!response.ok) throw directError('SOURCE_HTTP', label + ' returned HTTP ' + response.status, response.status);
  return normalizeStremio(await readJson(response, 8 * 1024 * 1024), target, label);
}

async function sourceMediafusion(target, signal) {
  const url = new URL(SOURCE_ENDPOINTS.mediafusion);
  url.searchParams.set('t', target.type === 'series' ? 'tvsearch' : 'movie');
  url.searchParams.set('imdbid', target.id);
  url.searchParams.set('limit', '100');
  if (target.type === 'series') {
    url.searchParams.set('season', target.season);
    url.searchParams.set('ep', target.episode);
  }
  const response = await fetchDirect(
    'mediafusion_torznab',
    url,
    { headers: { Accept: 'application/rss+xml, application/xml, text/xml' }, redirect: 'follow', signal },
    6000
  );
  if (!response.ok) throw directError('SOURCE_HTTP', 'MediaFusion returned HTTP ' + response.status, response.status);
  return normalizeTorznab(await readText(response, 4 * 1024 * 1024), target);
}

function richness(source) {
  return (source.filename ? 5 : 0) + (source.size ? 4 : 0) + (source.seeders != null ? 3 : 0)
    + (source.resolution ? 3 : 0) + (source.videoCodec ? 2 : 0) + (source.audioCodecs?.length ? 2 : 0);
}
function sourceFanInKey(source){
  return [source.hash,String(source.filename||'').toLowerCase(),Number.isSafeInteger(source.fileIdx)?source.fileIdx:''].join(':');
}
function sourceFanInRank(source){
  return (source.browserFriendly===true?100000:0)
    - (source.audioRisk===true?50000:0)
    - (source.videoRisk===true?20000:0)
    + (Number(source.score)||0)*100
    + richness(source);
}

function sourceTargetKey(target){
  return target.type==='series'
    ? `series:${target.id}:${target.season}:${target.episode}`
    : `movie:${target.id}`;
}
async function directSources(input, signal) {
  const target = validTarget(input), key = sourceTargetKey(target), cached = sourceCache.get(key);
  if (cached && cached.until > Date.now()) {
    trace('source_cache','hit',{target:key,count:cached.value.sources.length});
    return cached.value;
  }
  const jobs = [
    ['Zilean', controller => sourceZilean(target, controller.signal)],
    ['StremThru Main', controller => sourceStremthru(target, SOURCE_ENDPOINTS.stremthruMain, 'StremThru Main', 'stremthru_main', controller.signal)],
    ['StremThru ElfHosted', controller => sourceStremthru(target, SOURCE_ENDPOINTS.stremthruElf, 'StremThru ElfHosted', 'stremthru_elf', controller.signal)],
    ['MediaFusion Torznab', controller => sourceMediafusion(target, controller.signal)]
  ];
  const controllers = jobs.map(() => new AbortController());
  const providers = [], map = new Map();
  let settled = 0, failures = 0, done = false, graceTimer = null, graceDeadline = Infinity, hardTimer = null;

  return await new Promise((resolve, reject) => {
    const safeCount=()=>[...map.values()].filter(source=>source.browserFriendly===true).length;
    const scheduleGrace=ms=>{
      const deadline=Date.now()+ms;
      if(graceTimer&&deadline>=graceDeadline)return;
      if(graceTimer)clearTimeout(graceTimer);
      graceDeadline=deadline;
      graceTimer=setTimeout(()=>{graceTimer=null;graceDeadline=Infinity;finish();},ms);
    };
    const cleanup = () => {
      if (graceTimer) clearTimeout(graceTimer);
      if (hardTimer) clearTimeout(hardTimer);
      for (const controller of controllers) controller.abort();
    };
    const finish = () => {
      if (done) return;
      done = true; cleanup();
      const sources = [...map.values()].sort((a,b)=>sourceFanInRank(b)-sourceFanInRank(a)).slice(0, 40);
      if (!sources.length) {
        reject(directError('DIRECT_SOURCE_UNAVAILABLE','No direct source index returned a usable source. Try again shortly.',502));
        return;
      }
      const value = { sources, provider:'Browser direct', providers:[...providers], failures };
      if(sources.some(source=>source.browserFriendly===true))sourceCache.set(key,{value,until:Date.now()+SOURCE_CACHE_MS});else sourceCache.delete(key);
      trace('source_fan_in','ready',{target:key,count:sources.length,safe:sources.filter(source=>source.browserFriendly===true).length,risky:sources.filter(source=>source.audioRisk===true).length,providers:providers.length,settled});
      resolve(value);
    };
    const maybeFinish = () => {
      if (done) return;
      const safe=safeCount();
      if (safe && providers.length >= 2) return scheduleGrace(450);
      if (safe) return scheduleGrace(900);
      if (settled === jobs.length) finish();
    };
    const abort = () => {
      if (done) return;
      done = true; cleanup();
      reject(signal?.reason || new DOMException('Cancelled','AbortError'));
    };
    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener('abort',abort,{once:true});
    }
    hardTimer = setTimeout(finish, 6500);
    jobs.forEach(([name, run], index) => {
      const controller = controllers[index];
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      // Re-wrap so each provider sees both the local fan-in cancellation and caller cancellation.
      const adapter = { signal: combined };
      Promise.resolve().then(() => {
        if(name==='Zilean') return sourceZilean(target,adapter.signal);
        if(name==='StremThru Main') return sourceStremthru(target,SOURCE_ENDPOINTS.stremthruMain,'StremThru Main','stremthru_main',adapter.signal);
        if(name==='StremThru ElfHosted') return sourceStremthru(target,SOURCE_ENDPOINTS.stremthruElf,'StremThru ElfHosted','stremthru_elf',adapter.signal);
        return sourceMediafusion(target,adapter.signal);
      }).then(sources => {
        if (done) return;
        settled += 1;
        if (sources.length) {
          providers.push(name);
          for (const source of sources) {
            const sourceKey=sourceFanInKey(source),old=map.get(sourceKey);
            if (!old || sourceFanInRank(source) > sourceFanInRank(old)) map.set(sourceKey, source);
          }
        }
        maybeFinish();
      }, error => {
        if (done) return;
        settled += 1; failures += 1;
        if (error?.name !== 'AbortError') trace('source_provider','failed',{provider:name,error:safeError(error)});
        maybeFinish();
      });
    });
  });
}

function requireKey() {
  if (!credential) throw directError('LOGIN_REQUIRED', 'Enter your TorBox API key.', 401);
  return credential;
}

const DEFAULT_RELAY_PRIMARY='https://torbox-web-player-key.onrender.com';
const DEFAULT_RELAY_SECONDARY='https://torbox-web-player-relay.jonathanjablon.workers.dev';
let relayConfigCache=null,relayConfigAt=0,primaryCooldownUntil=0;
async function relayConfig(){
  if(relayConfigCache&&Date.now()-relayConfigAt<300000)return relayConfigCache;
  let value={primary:DEFAULT_RELAY_PRIMARY,secondary:DEFAULT_RELAY_SECONDARY};
  try{
    const response=await fetch('./relay-config.json',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(5000)});
    if(response.ok){const data=await response.json();for(const name of ['primary','secondary'])if(typeof data?.[name]==='string')value[name]=data[name].replace(/\/+$/,'');}
  }catch{}
  const valid=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password?u.origin:''}catch{return''}};
  value={primary:valid(value.primary)||DEFAULT_RELAY_PRIMARY,secondary:valid(value.secondary)||DEFAULT_RELAY_SECONDARY};
  relayConfigCache=value;relayConfigAt=Date.now();return value;
}
function bridgeRetryable(status){return status===408||status===429||status>=500}
async function bridgeOne(origin,route,{params={},method='GET',json,timeoutMs=2000,label='torbox_bridge',apiKey}={}){
  const key=apiKey||requireKey(),url=new URL('/relay/torbox/'+route,origin);
  for(const [name,value] of Object.entries(params)){if(Array.isArray(value)){for(const item of value)url.searchParams.append(name,String(item));}else if(value!==undefined&&value!==null)url.searchParams.set(name,String(value));}
  const started=performance.now();
  try{
    const response=await fetch(url,{method,headers:{Accept:'application/json',Authorization:'Bearer '+key,...(json?{'Content-Type':'application/json'}:{})},body:json?JSON.stringify(json):undefined,credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
    const backend=response.headers.get('x-torbox-bridge')||(origin.includes('onrender.com')?'render':'cloudflare');
    trace(label,response.ok?'ok':'http_error',{backend,httpStatus:response.status,durationMs:Math.round(performance.now()-started)});
    return{response,backend,origin};
  }catch(error){
    trace(label,['TimeoutError','AbortError'].includes(error?.name)?'timeout':'fetch_error',{backend:origin.includes('onrender.com')?'render':'cloudflare',error:safeError(error),durationMs:Math.round(performance.now()-started)});
    const e=directError('BRIDGE_UNAVAILABLE','The TorBox bridge could not be reached.',503);e.retryable=true;e.ambiguous=true;throw e;
  }
}
async function bridgeRequest(route,options={}){
  const cfg=await relayConfig(),preferBackup=cfg.secondary&&Date.now()<primaryCooldownUntil;
  const order=preferBackup?[cfg.secondary,cfg.primary]:[cfg.primary,cfg.secondary].filter(Boolean);
  const mutation=(options.method||'GET')!=='GET';
  let last;
  for(let i=0;i<order.length;i++){
    try{
      const result=await bridgeOne(order[i],route,{...options,timeoutMs:options.timeoutMs??(mutation?25000:order[i]===cfg.primary?2000:15000)});
      if(result.response.ok)return result;
      if(!bridgeRetryable(result.response.status)||i===order.length-1||(result.response.status===429&&result.response.headers.get('x-torbox-bridge')))return result;
      if(order[i]===cfg.primary)primaryCooldownUntil=Date.now()+120000;
      if(mutation&&result.response.status!==429){
        const error=directError('BRIDGE_MUTATION_UNCERTAIN','The primary TorBox bridge failed after a write may have been sent.',503);
        error.ambiguous=true;throw error;
      }
      last=result;
    }catch(error){
      last=error;
      if(order[i]===cfg.primary)primaryCooldownUntil=Date.now()+120000;
      if(mutation&&error?.ambiguous)throw error;
      if(i===order.length-1)throw error;
    }
  }
  if(last?.response)return last;throw last||directError('BRIDGE_UNAVAILABLE','No TorBox bridge is configured.',503);
}
async function bridgeHealth(origin,label){
  if(!origin)return{id:label,label,status:'NOT_CONFIGURED',httpStatus:null,durationMs:0,corsReadable:false,note:'No backup relay URL is configured.'};
  const started=performance.now();
  try{const r=await fetch(new URL('/relay/health',origin),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(7000)});return{id:label,label,status:r.ok?'DIRECT_OK':'HTTP_ERROR',httpStatus:r.status,durationMs:Math.round(performance.now()-started),corsReadable:true,note:r.ok?'Relay health endpoint is reachable.':'Relay health endpoint returned HTTP '+r.status+'.'};}
  catch(e){return{id:label,label,status:['TimeoutError','AbortError'].includes(e?.name)?'TIMEOUT':'NETWORK_ERROR',httpStatus:null,durationMs:Math.round(performance.now()-started),corsReadable:false,note:'Relay health endpoint could not be reached.'};}
}

async function bridgeCinemetaHealth(origin,label){
  if(!origin)return{id:label,label,status:'NOT_CONFIGURED',httpStatus:null,durationMs:0,corsReadable:false,note:'No catalog relay URL is configured.'};
  const url=new URL('/relay/cinemeta',origin);url.searchParams.set('path','/meta/series/tt0182576.json');
  const started=performance.now();
  try{
    const r=await fetch(url,{headers:{Accept:'application/json'},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
    return{id:label,label,status:r.ok?'DIRECT_OK':'HTTP_ERROR',httpStatus:r.status,durationMs:Math.round(performance.now()-started),corsReadable:true,note:r.ok?'Catalog relay returned readable metadata.':'Catalog relay returned HTTP '+r.status+'.'};
  }catch(e){
    return{id:label,label,status:['TimeoutError','AbortError'].includes(e?.name)?'TIMEOUT':'NETWORK_ERROR',httpStatus:null,durationMs:Math.round(performance.now()-started),corsReadable:false,note:'Catalog relay could not be reached.'};
  }
}

async function torboxFetch(path,{params={},method='GET',body,label}={}){
  const json=path==='torrents/createtorrent'&&body?body:undefined;
  const result=await bridgeRequest(path,{params,method,json,label:label||('torbox_'+path.replace(/[^a-z0-9]+/gi,'_'))});
  const response=result.response;
  if([401,403].includes(response.status))throw directError('TORBOX_ACCESS_DENIED','TorBox rejected this API key.',401);
  if(response.status===429)throw directError('TORBOX_RATE_LIMITED','TorBox or the primary bridge is rate limiting requests.',429);
  if(!response.ok)throw directError('TORBOX_HTTP_ERROR','TorBox bridge returned HTTP '+response.status,response.status);
  const text=await response.text();if(!text)return null;const payload=safeJson(text,'TorBox');
  if(payload?.success===false)throw directError('TORBOX_REQUEST_FAILED','TorBox reported that the request failed.');
  return payload&&Object.hasOwn(payload,'data')?payload.data:payload;
}

async function torboxAccount() {
  const data = await torboxFetch('user/me', { params: { settings: false }, label: 'torbox_user_me' });
  if (!data || typeof data !== 'object') throw directError('TORBOX_SCHEMA', 'TorBox returned an unreadable account response.');
  return {
    valid: true,
    planCode: String(data.plan ?? 'not supplied').slice(0, 40),
    checkedAt: new Date().toISOString()
  };
}

async function torboxCached(hashes){
  if(!hashes.length)return{};
  const data=await torboxFetch('torrents/checkcached',{params:{hash:hashes,format:'object',list_files:false},label:'torbox_checkcached'});
  if(!data||typeof data!=='object')throw directError('TORBOX_CACHE','TorBox returned an unreadable cache response.');
  const output={};for(const hash of hashes){const row=data[hash];output[hash]=row===true||!!(row&&typeof row==='object');}return output;
}

function availability(item) {
  if (item?.download_finished === true && item?.download_present === true) return 'Ready to watch';
  if (item?.download_finished === true && item?.download_present === false) return 'Unavailable';
  if (item?.download_finished === false) return 'Preparing';
  return 'Unable to check';
}

function normalizeItem(item) {
  if (!item || !Number.isSafeInteger(item.id)) throw directError('TORBOX_SCHEMA', 'TorBox returned an unreadable torrent.');
  const state = availability(item);
  return (Array.isArray(item.files) ? item.files : [])
    .filter(file => Number.isSafeInteger(file.id)
      && (/\.(mp4|m4v|webm|mkv|mov|avi|ts|m2ts|mpg|mpeg|wmv|ogv)$/i.test(file.short_name || file.name || '')
        || /^video\//i.test(file.mimetype || '')))
    .map(file => ({
      id: 'torrents:' + item.id + ':' + file.id,
      title: cleanText(file.short_name || file.name, 700) || 'File ' + file.id,
      collection: cleanText(item.name, 700),
      size: Number.isFinite(file.size) ? file.size : null,
      mime: cleanText(file.mimetype, 80),
      state,
      compatibility: 'Browser compatibility not yet verified',
      providerProgress: typeof item.progress === 'number' ? item.progress : null
    }));
}

function episodeIdentity(name) {
  const match = /(?:^|[^a-z0-9])s(\d{1,3})[ ._-]*e(\d{1,4})(?!\d)/i.exec(name || '')
    || /(?:^|[^a-z0-9])(\d{1,3})x(\d{1,4})(?!\d)/i.exec(name || '');
  return match ? { season: +match[1], episode: +match[2] } : null;
}

function chooseVideo(files, target, source, explicit) {
  let candidates = files.filter(file => !/(?:^|[ ._-])(sample|trailer|featurette)(?:[ ._-]|$)/i.test(file.title));
  if (target.type === 'series') {
    candidates = candidates.filter(file => {
      const identity = episodeIdentity(file.title);
      return identity
        ? identity.season === target.season && identity.episode === target.episode
        : !!source.filename && file.title.toLowerCase().endsWith(source.filename.toLowerCase());
    });
  }
  if (explicit) {
    const file = candidates.find(row => row.id === explicit);
    if (!file) throw directError('FILE_SELECTION_INVALID', 'That file does not match this episode.', 400);
    return { file, candidates };
  }
  const named = source.filename
    ? candidates.filter(file => file.title.toLowerCase().endsWith(source.filename.toLowerCase()))
    : [];
  return {
    file: named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : null,
    candidates
  };
}

async function myTorrents(params = {}) {
  const data = await torboxFetch('torrents/mylist', { params, label: 'torbox_mylist' });
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function findTorrent(hash) {
  for (let offset = 0; offset < 10000; offset += 100) {
    const rows = await myTorrents({ offset, limit: 100, bypass_cache: true });
    const found = rows.find(row => String(row?.hash || '').toLowerCase() === hash);
    if (found) return found;
    if (rows.length < 100) return null;
  }
  throw directError('LIBRARY_LIMIT', 'The TorBox account is too large to safely scan.', 409);
}

async function createTorrent(hash,onlyCached){
  try{
    const data=await torboxFetch('torrents/createtorrent',{method:'POST',body:{hash,onlyCached},label:'torbox_create_torrent'});
    if(!Number.isSafeInteger(data?.torrent_id))throw directError('TORBOX_CREATE','TorBox did not confirm a torrent identifier.');
    return data.torrent_id;
  }catch(error){
    if(!error?.ambiguous)throw error;
    for(let attempt=0;attempt<4;attempt++){await new Promise(r=>setTimeout(r,1200));const existing=await findTorrent(hash);if(existing)return existing.id;}
    const data=await torboxFetch('torrents/createtorrent',{method:'POST',body:{hash,onlyCached},label:'torbox_create_torrent_backup'});
    if(!Number.isSafeInteger(data?.torrent_id))throw directError('TORBOX_CREATE','TorBox did not confirm a torrent identifier.');
    return data.torrent_id;
  }
}

async function torrentItem(id) {
  const rows = await myTorrents({ id, bypass_cache: true });
  const row = rows.find(item => item?.id === id) || rows[0];
  if (!row || row.id !== id) throw directError('PREPARED_ITEM_MISSING', 'The prepared torrent is not in this account.', 404);
  return row;
}

async function registerSources(input) {
  const target = validTarget(input.target);
  const meta = await catalogMeta(target.type, target.id);
  if (target.type === 'series' && !meta.episodes.some(row => row.season === target.season && row.episode === target.episode)) {
    throw directError('EPISODE_NOT_FOUND', 'The selected episode is not in this show.', 400);
  }
  const sources = normalizeSources(input.sources || []);
  let cache = {};
  let warning = '';
  try {
    cache = await torboxCached([...new Set(sources.map(source => source.hash))]);
  } catch (error) {
    warning = 'Sources were found, but direct TorBox cache checking failed: ' + error.message;
  }
  const rows = sources.map(source => {
    const id = crypto.randomUUID();
    const cached = typeof cache[source.hash] === 'boolean' ? cache[source.hash] : null;
    tickets.set(id, { source, target, until: Date.now() + 1800000 });
    return {
      id,
      title: source.title,
      label: source.label,
      provider: source.provider,
      providers: source.providers,
      filename: source.filename,
      quality: source.quality,
      hint: source.hint,
      size: source.size,
      seeders: source.seeders,
      releaseQuality: source.releaseQuality,
      container: source.container,
      resolution: source.resolution,
      cached,
      browserFriendly: source.browserFriendly,
      audioRisk: source.audioRisk,
      videoRisk: source.videoRisk,
      videoCodec: source.videoCodec,
      audioCodecs: source.audioCodecs,
      score: source.score + (cached ? 8 : 0)
    };
  }).sort((a, b) => b.score - a.score);
  return { sources: rows, warning, target, state: rows.length ? 'sources_found' : 'no_sources' };
}

function ticket(id) {
  const row = tickets.get(id);
  if (!row || row.until <= Date.now()) throw directError('SOURCE_EXPIRED', 'This source selection expired. Reopen the title.', 404);
  return row;
}

async function prepareSource(id, onlyCached = false) {
  const row = ticket(id);
  const hash = row.source.hash;
  row.until = Date.now() + 86400000;
  let operation = operations.get(hash);
  if (!operation) {
    operation = { torrentId: null, promise: null };
    operations.set(hash, operation);
  }
  if (!operation.promise && operation.torrentId === null) {
    operation.promise = (async () => {
      const existing = await findTorrent(hash);
      operation.torrentId = existing?.id ?? await createTorrent(hash, onlyCached);
    })().finally(() => { operation.promise = null; });
  }
  if (operation.promise) await operation.promise;
  return sourceStatus(id);
}

async function sourceStatus(id, explicit) {
  const row = ticket(id);
  const operation = operations.get(row.source.hash);
  if (!operation) return { state: 'not_started', message: 'Choose Play or Prepare to use this source.' };
  if (operation.promise) return { state: 'preparing', message: 'TorBox is processing your request.', progress: null };
  const item = await torrentItem(operation.torrentId);
  if (String(item.hash || '').toLowerCase() !== row.source.hash) throw directError('TORRENT_IDENTITY_MISMATCH', 'TorBox returned a different torrent.');
  if (item.download_finished !== true || item.download_present !== true) {
    return {
      state: 'preparing',
      message: 'TorBox is preparing this source.',
      progress: typeof item.progress === 'number' ? item.progress : null
    };
  }
  const files = normalizeItem(item);
  const picked = chooseVideo(files, row.target, row.source, explicit);
  if (picked.file) {
    return {
      state: 'ready',
      file: picked.file,
      target: row.target,
      compatibility: {
        browserFriendly: row.source.browserFriendly,
        audioRisk: row.source.audioRisk,
        videoRisk: row.source.videoRisk,
        hint: row.source.hint,
        videoCodec: row.source.videoCodec,
        audioCodecs: row.source.audioCodecs
      },
      message: 'The selected file is ready.'
    };
  }
  if (!picked.candidates.length) return { state: 'unavailable', message: 'No video could be matched confidently.' };
  return { state: 'choose_file', message: 'Choose the correct video file.', files: picked.candidates };
}

async function resolveVideo(videoId) {
  const match = /^torrents:([0-9]{1,12}):([0-9]{1,12})$/.exec(videoId || '');
  if (!match) throw directError('BAD_VIDEO_ID', 'This file identifier is invalid.', 400);
  const itemId = +match[1];
  const fileId = +match[2];
  const item = await torrentItem(itemId);
  const file = normalizeItem(item).find(row => row.id === videoId);
  if (!file || file.state !== 'Ready to watch') throw directError('FILE_NOT_READY', 'This file is not ready.', 409);
  const link = await torboxFetch('torrents/requestdl', {
    params: { torrent_id: itemId, file_id: fileId, zip_link: false, redirect: false },
    label: 'torbox_requestdl'
  });
  if (typeof link !== 'string' || !isTrustedDirectMediaUrl(link)) throw directError('MEDIA_HOST_NOT_VERIFIED', 'TorBox returned an untrusted playback URL.');
  return { file, link };
}

function pathAndQuery(value) {
  return new URL(value, 'https://direct.invalid');
}

export async function directApi(path, { method = 'GET', data, signal } = {}) {
  const url = pathAndQuery(path);
  const pathname = url.pathname;

  if (pathname === '/api/session') {
    return {
      authenticated: !!credential,
      setupRequired: false,
      authMode: 'browser-direct',
      ...(credential ? { csrf: 'local', viewers: ['viewer-1', 'viewer-2'], durable: true, keyConfigured: true } : {})
    };
  }

  if (pathname === '/api/login' && method === 'POST') {
    const key = String(data?.apiKey || '').trim();
    if (key.length < 8 || key.length > 512) throw directError('BAD_API_KEY', 'Enter a valid TorBox API key.', 401);
    const old = credential;
    credential = key;
    try {
      const account = await torboxAccount();
      localSession = crypto.randomUUID().replace(/-/g, '') + 'abcdefghijk';
      return { ok: true, csrf: 'local', sessionToken: localSession.slice(0, 43), authMode: 'browser-direct', account };
    } catch (error) {
      credential = old;
      throw error;
    }
  }

  if (pathname === '/api/logout') {
    credential = '';
    localSession = '';
    tickets.clear();
    operations.clear();
    return { ok: true };
  }

  if (pathname === '/api/owner/unlock') {
    if (String(data?.apiKey || '').trim() !== credential) throw directError('BAD_API_KEY', 'That API key did not match this browser session.', 401);
    return { ok: true };
  }

  if (pathname === '/api/owner/diagnostics') {
    return {
      account: await torboxAccount(),
      authMode: 'browser-direct',
      apiKeyPersistence: 'Encrypted browser vault only when Remember is enabled',
      directMedia: true,
      proxyEnabled: true,
      mediaRelayEnabled: false,
      credentialProtection: 'The TorBox API key stays in this browser and is forwarded transiently through the selected stateless bridge. The bridge does not store it.',
      catalogProvider: 'Cinemeta direct',
      sourceProvider: 'Direct browser source indexes',
      progressStorage: 'browser-local',
      automaticNextEnabled: true
    };
  }

  if (pathname === '/api/torbox-status') {
    try {
      await torboxAccount();
      return { ok: true, official: 'unknown', message: 'TorBox API is reachable through the redundant bridge.' };
    } catch (error) {
      return { ok: false, official: 'unknown', message: error.message };
    }
  }

  if (pathname === '/api/discover/catalog') {
    return catalogSearch({
      type: url.searchParams.get('type') || 'movie',
      q: url.searchParams.get('q') || '',
      skip: Number(url.searchParams.get('skip') || 0),
      genre: url.searchParams.get('genre') || '',
      feed: url.searchParams.get('feed') || 'popular'
    });
  }

  if (pathname === '/api/discover/meta') {
    return { meta: await catalogMetaFlexible(url.searchParams.get('type'), url.searchParams.get('id')) };
  }

  if (pathname === '/api/discover/lookup') {
    const type = url.searchParams.get('type');
    const target = { type, id: url.searchParams.get('id') };
    if (type === 'series') {
      target.season = Number(url.searchParams.get('season'));
      target.episode = Number(url.searchParams.get('episode'));
    }
    return directSources(target, signal);
  }

  if (pathname === '/api/discover/sources' && method === 'POST') return registerSources(data || {});
  if (pathname === '/api/discover/prepare' && method === 'POST') return prepareSource(data?.source, data?.onlyCached === true);
  if (pathname === '/api/discover/status') return sourceStatus(url.searchParams.get('source'), url.searchParams.get('file') || undefined);

  if (pathname === '/api/playback' && method === 'POST') {
    const resolved = await resolveVideo(data?.videoId);
    return {
      file: resolved.file,
      mediaUrl: resolved.link,
      delivery: 'direct',
      conversion: false,
      exposesTorBoxToken: true,
      leaseId: crypto.randomUUID(),
      progress: { position: 0, duration: 0 }
    };
  }

  if (pathname === '/api/progress') return { saved: true };

  if (pathname === '/api/library') {
    const rows = await myTorrents({
      offset: Number(url.searchParams.get('offset') || 0),
      limit: 100,
      bypass_cache: url.searchParams.get('refresh') === '1'
    });
    return {
      files: rows.flatMap(normalizeItem),
      nextOffset: rows.length === 100 ? Number(url.searchParams.get('offset') || 0) + 100 : null,
      updatedAt: new Date().toISOString(),
      stale: false
    };
  }

  if (pathname.startsWith('/api/drive/') || pathname.startsWith('/api/share/') || pathname === '/api/setup-transfer') {
    throw directError('DIRECT_FEATURE_UNAVAILABLE', 'This browser-direct experiment intentionally does not use Render for that optional feature.', 501);
  }

  throw directError('NOT_FOUND', 'This direct-browser action is not implemented.', 404);
}

async function reachability(url) {
  try {
    await fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return true;
  } catch {
    return false;
  }
}

async function probe(id, label, url, { headers = {}, method = 'GET' } = {}) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(12000)
    });
    const durationMs = Math.round(performance.now() - started);
    return {
      id,
      label,
      status: response.ok ? 'DIRECT_OK' : 'HTTP_ERROR',
      httpStatus: response.status,
      durationMs,
      corsReadable: true,
      note: response.ok
        ? 'Browser JavaScript could read this response directly.'
        : 'Browser JavaScript could read the response, but the service returned HTTP ' + response.status + '.'
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    if (['TimeoutError', 'AbortError'].includes(error?.name)) {
      return { id, label, status: 'TIMEOUT', httpStatus: null, durationMs, corsReadable: false, note: 'The direct browser request timed out.' };
    }
    const reachable = await reachability(new URL(url).origin);
    return {
      id,
      label,
      status: reachable ? 'CORS_BLOCKED_OR_UNREADABLE' : 'NETWORK_ERROR',
      httpStatus: null,
      durationMs,
      corsReadable: false,
      note: reachable
        ? 'The host is reachable, but browser JavaScript could not read the cross-origin response. CORS is the likely blocker.'
        : 'The host could not be reached by either readable or opaque browser fetch.'
    };
  }
}

export async function runDirectDiagnostics(overrideKey = '') {
  const key = String(overrideKey || credential || '').trim();
  const tests = [
    probe('cinemeta', 'Cinemeta catalog', 'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json'),
    probe('cinemeta_meta', 'Cinemeta metadata', 'https://v3-cinemeta.strem.io/meta/movie/tt0111161.json'),
    probe('cinemeta_meta_live', 'Cinemeta live metadata', 'https://cinemeta-live.strem.io/meta/movie/tt0111161.json'),
    probe('zilean', 'Zilean', 'https://zileanfortheweebs.midnightignite.me/dmm/filtered?ImdbId=tt0111161'),
    probe('stremthru_main', 'StremThru Main', SOURCE_ENDPOINTS.stremthruMain + '/stream/movie/tt0111161.json'),
    probe('stremthru_elf', 'StremThru ElfHosted', SOURCE_ENDPOINTS.stremthruElf + '/stream/movie/tt0111161.json'),
    probe('mediafusion', 'MediaFusion Torznab', 'https://mediafusion.elfhosted.com/torznab?t=movie&imdbid=tt0111161&limit=1'),
    probe('torbox_relay_status_public', 'TorBox Relay status (no auth)', TORBOX_RELAY_ORIGIN)
  ];

  if (key) {
    const headers = { Authorization: 'Bearer ' + key, Accept: 'application/json' };
    tests.push(
      probe('torbox_user', 'TorBox user/me', 'https://api.torbox.app/v1/api/user/me?settings=false', { headers }),
      probe('torbox_mylist', 'TorBox torrent list', 'https://api.torbox.app/v1/api/torrents/mylist?offset=0&limit=1', { headers }),
      probe('torbox_relay_status_auth', 'TorBox Relay status (Bearer auth)', TORBOX_RELAY_ORIGIN, { headers })
    );
  } else {
    tests.push(Promise.resolve({
      id: 'torbox_user',
      label: 'TorBox authenticated API',
      status: 'NOT_TESTED',
      httpStatus: null,
      durationMs: 0,
      corsReadable: false,
      note: 'No API key was supplied to the diagnostic test.'
    }));
  }

  const cfg=await relayConfig();
  tests.push(bridgeHealth(cfg.primary,'bridge_render_health'),bridgeHealth(cfg.secondary,'bridge_cloudflare_health'),bridgeCinemetaHealth(cfg.secondary,'bridge_cloudflare_cinemeta'));
  const results = await Promise.all(tests);
  const byId=Object.fromEntries(results.map(row=>[row.id,row]));
  const directSourceIds=['stremthru_main','stremthru_elf','mediafusion'];
  const sourceProvidersDirect=directSourceIds.filter(id=>byId[id]?.status==='DIRECT_OK');
  const architecture={
    catalogDirect:byId.cinemeta?.status==='DIRECT_OK'&&(byId.cinemeta_meta?.status==='DIRECT_OK'||byId.cinemeta_meta_live?.status==='DIRECT_OK'),
    catalogBridge:byId.bridge_cloudflare_cinemeta?.status==='DIRECT_OK',
    sourceProvidersDirect,
    renderBridge:byId.bridge_render_health?.status==='DIRECT_OK',
    cloudflareBridge:byId.bridge_cloudflare_health?.status==='DIRECT_OK'
  };
  architecture.torboxBridgeAvailable=architecture.renderBridge||architecture.cloudflareBridge;
  architecture.redundantTorboxReady=architecture.renderBridge&&architecture.cloudflareBridge;
  architecture.catalogAvailable=architecture.catalogDirect||architecture.catalogBridge;
  const blockers=[];
  if(!architecture.catalogAvailable)blockers.push('catalog');
  if(!sourceProvidersDirect.length)blockers.push('source_discovery');
  if(!architecture.torboxBridgeAvailable)blockers.push('torbox_bridge');
  const expectedDirectLimitations=['torbox_user','torbox_mylist','torbox_relay_status_public','torbox_relay_status_auth'].filter(id=>byId[id]&&byId[id].status!=='DIRECT_OK');
  const optionalFailures=['zilean'].filter(id=>byId[id]&&byId[id].status!=='DIRECT_OK');

  lastDiagnostic = {
    schema: 'torbox-browser-direct-diagnostics-v2',
    build: DIRECT_BUILD,
    generatedAt: new Date().toISOString(),
    environment: {
      origin: location.origin,
      secureContext: isSecureContext,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      platform: navigator.platform || '',
      serviceWorker: 'serviceWorker' in navigator,
      credentialSupplied: !!key
    },
    results,
    architecture,
    blockers,
    expectedDirectLimitations,
    optionalFailures,
    recentTrace: traces.slice(-60)
  };
  return lastDiagnostic;
}

export function diagnosticText(report = lastDiagnostic) {
  return report ? JSON.stringify(report, null, 2) : '';
}

export function recentDirectTrace() {
  return traces.slice();
}

// Used only after a local import confirmation. Validation does not replace the
// active credential or put any transfer payload on a server.
export function exportActiveCredential(){return credential;}
export async function validateImportedCredential(apiKey){
  if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>512||/[\u0000-\u001f\u007f]/.test(apiKey))throw directError('BAD_API_KEY','The imported key is invalid.',400);
  const {response}=await bridgeRequest('user/me',{params:{settings:false},apiKey,label:'torbox_import_validate'});
  if(!response.ok)throw directError('IMPORT_KEY_REJECTED','Could not validate the imported TorBox connection. Your existing setup has not changed.',response.status);
  const payload=await readJson(response,1024*1024);
  if(payload?.success!==true||!payload.data||typeof payload.data!=='object')throw directError('IMPORT_KEY_REJECTED','TorBox did not confirm the imported connection.',401);
  return true;
}

// Shared source normalization and authenticated backend lookup. No provider keys here.
import { apiUrl, apiMode, getSessionToken, credentialsMode } from './runtime.js?v=release-1.2.6-playback.1';
export const SOURCE_PATH = '/api/discover/lookup';
export const MAX_SOURCES = 40;
export function targetOf(input) {
  if (!input || !['movie', 'series'].includes(input.type) || !/^tt[0-9]{5,12}$/.test(input.id || '')) throw new Error('Choose a valid movie or show.');
  const target = { type: input.type, id: input.id };
  if (input.type === 'series') {
    if (!Number.isSafeInteger(input.season) || input.season < 0 || input.season > 999 || !Number.isSafeInteger(input.episode) || input.episode < 1 || input.episode > 9999) throw new Error('Choose a season and episode.');
    target.season = input.season; target.episode = input.episode;
  }
  return target;
}
export const cleanText = (s, max = 300) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : '';
const BROWSER_CONTAINERS = new Set(['mp4', 'm4v', 'webm', 'mkv']);
const UNSUPPORTED_BROWSER_CONTAINERS = new Set(['avi', 'wmv', 'ts', 'm2ts', 'mts', 'mpg', 'mpeg', 'mov', 'ogv', 'ogg', 'iso', 'dmg']);
const containerAlias = value => ({
  'x-msvideo': 'avi', 'msvideo': 'avi', 'matroska': 'mkv', 'x-matroska': 'mkv',
  'quicktime': 'mov', 'mp2t': 'ts', 'x-m4v': 'm4v', 'ogg': 'ogv'
})[value] || value;
const extensionOf = value => /\.([a-z0-9]{2,6})$/i.exec(cleanText(value, 700).trim())?.[1]?.toLowerCase() || '';
export function browserContainerHints(source = {}) {
  const filenameExtension = extensionOf(source.filename);
  const declared = containerAlias(cleanText(source.container, 40).trim().toLowerCase().replace(/^video\//, ''));
  const titleExtension = extensionOf(source.title);
  const mime = cleanText(source.mime, 80).trim().toLowerCase().split(';')[0];
  const mimeContainer = mime.startsWith('video/') ? containerAlias(mime.slice(6)) : '';
  const container = filenameExtension || declared || titleExtension || mimeContainer;
  const browserContainer = BROWSER_CONTAINERS.has(container);
  const browserUnsupported = UNSUPPORTED_BROWSER_CONTAINERS.has(container);
  // Native Matroska decoding depends on codecs and the browser. Even an empty
  // canPlayType() result can decode successfully, so let the actual player try
  // a suitable file and use its existing bounded codec recovery on failure.
  return { container, browserContainer, browserUnsupported, containerStatus: container === 'mkv' ? 'conditional' : browserContainer ? 'supported' : browserUnsupported ? 'unsupported' : 'unknown' };
}
export function normalizeSourceLanguages(value) {
  const aliases={english:'en',eng:'en',french:'fr',fre:'fr',fra:'fr',spanish:'es',spa:'es',german:'de',ger:'de',deu:'de',russian:'ru',rus:'ru',italian:'it',ita:'it',portuguese:'pt',por:'pt',polish:'pl',pol:'pl',hindi:'hi',hin:'hi',japanese:'ja',jpn:'ja',korean:'ko',kor:'ko',chinese:'zh',chi:'zh',zho:'zh',arabic:'ar',ara:'ar',turkish:'tr',tur:'tr',ukrainian:'uk',ukr:'uk',dutch:'nl',dut:'nl',nld:'nl',swedish:'sv',swe:'sv',norwegian:'no',nor:'no',finnish:'fi',fin:'fi',danish:'da',dan:'da',czech:'cs',cze:'cs',ces:'cs',romanian:'ro',rum:'ro',ron:'ro',hungarian:'hu',hun:'hu',greek:'el',gre:'el',ell:'el',thai:'th',tha:'th',indonesian:'id',ind:'id',vietnamese:'vi',vie:'vi',lithuanian:'lt',lit:'lt'};
  const known=new Set(['en','fr','es','de','ru','it','pt','pl','hi','ja','ko','zh','ar','tr','uk','nl','sv','no','fi','da','cs','ro','hu','el','th','id','vi','lt']);
  return [...new Set((Array.isArray(value)?value:[]).slice(0,20).filter(item=>typeof item==='string').map(item=>item.trim().toLowerCase()).map(item=>aliases[item]||item).filter(item=>known.has(item)))].slice(0,12);
}
export function parseSizeBytes(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/,/g, '');
  if (/^[0-9]+$/.test(text)) { const n = Number(text); return Number.isSafeInteger(n) && n > 0 ? n : null; }
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB|KIB|MIB|GIB|TIB)$/i.exec(text);
  if (!m) return null;
  const units = { B: 1, KB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
  const bytes = Number(m[1]) * units[m[2].toUpperCase()];
  return Number.isSafeInteger(Math.round(bytes)) && bytes > 0 ? Math.round(bytes) : null;
}
export function sourceHints(source) {
  const structuredAudio = Array.isArray(source.audioCodecs) ? source.audioCodecs.join(' ') : '';
  const name = `${source.filename || ''} ${source.title || ''} ${source.label || ''} ${source.videoCodec || ''} ${structuredAudio} ${source.resolution || ''}`;
  const mp4 = /\.mp4\b/i.test(name);
  const h264 = /\b(h[ ._-]?264|x264|avc)\b/i.test(name);
  const hevc = /\b(hevc|h[ ._-]?265|x265)\b/i.test(name);
  const av1 = /\bav1\b/i.test(name);
  const legacyVideo = /\b(?:xvid|divx|mpeg[ ._-]?4(?:[ ._-]?part[ ._-]?2)?)\b/i.test(name);
  const aac = /\baac\b/i.test(name);
  const mp3 = /\b(mp3|mpeg[ ._-]?audio)\b/i.test(name);
  const opus = /\bopus\b/i.test(name);
  const difficultAudio = /\b(dts(?:[ ._-]?hd)?|truehd|e[ ._-]?ac[ ._-]?3|ac[ ._-]?3|ddp|dd\+|dolby[ ._-]?digital(?:[ ._-]?plus)?|dolby[ ._-]?atmos)\b/i.test(name);
  const containerHints = browserContainerHints(source);
  const quality = cleanText(source.resolution, 20).toUpperCase() || /\b(2160p|1080p|720p|480p|4k)\b/i.exec(name)?.[1].toUpperCase() || '';
  const browserFriendly = h264 && (aac || mp3 || (opus && containerHints.container === 'mkv')) && !hevc && !av1 && !legacyVideo && !difficultAudio && !containerHints.browserUnsupported;
  const audioRisk = difficultAudio;
  const videoRisk = hevc || av1 || legacyVideo;
  const languages = normalizeSourceLanguages(source.languages);
  const dubUnconfirmed = !languages.length && /\b(?:dub|dubbed)\b/i.test(`${source.filename || ''} ${source.title || ''}`);
  // Preserve useful English choices before the bounded source list is sliced.
  // DUB is a ranking warning, never evidence of any particular language.
  const languageScore = languages.includes('en') ? (languages.length === 1 ? 140 : 120) : languages.length ? -160 : dubUnconfirmed ? -80 : 0;
  const score = (browserFriendly ? 120 : 0) + (h264 ? 35 : 0) + (aac ? 45 : 0) + (mp3 ? 25 : 0) + (opus ? 15 : 0) + (mp4 ? 20 : 0)
    + (containerHints.browserContainer ? 80 : 0) - (containerHints.browserUnsupported ? 500 : 0)
    - (audioRisk ? 90 : 0) - (hevc ? 55 : 0) - (av1 ? 20 : 0) - (legacyVideo ? 100 : 0)
    + (['1080P', '720P'].includes(quality) ? 10 : 0) - (['2160P', '4K'].includes(quality) ? 8 : 0) + languageScore;
  let hint = 'Codecs not confirmed';
  if (containerHints.browserUnsupported) hint = `${containerHints.container.toUpperCase()} container is not supported by Android Chrome`;
  else if (browserFriendly) hint = containerHints.container === 'mkv' ? 'Matroska H.264 · browser and audio support vary' : 'Best browser bet · H.264 / AAC';
  else if (audioRisk) hint = 'Dolby/DTS audio may be silent in Chrome';
  else if (hevc) hint = 'HEVC/H.265 may not play in Chrome';
  else if (av1) hint = 'AV1 compatibility varies by device';
  else if (legacyVideo) hint = 'Legacy MPEG-4 video may not play in this browser';
  else if (aac) hint = 'AAC audio indicated';
  else if (mp4) hint = 'MP4 container · audio codec unconfirmed';
  else if (containerHints.container === 'mkv') hint = 'Matroska · browser and codec support vary';
  return { quality, score, hint, browserFriendly, audioRisk, videoRisk, ...containerHints };
}
export function normalizeSources(raw) {
  if (!Array.isArray(raw)) throw new Error('The source provider did not return a source list.');
  const map = new Map();
  for (const item of raw.slice(0, 1000)) {
    if (!item || !/^[a-f0-9]{40}$/i.test(item.infoHash || item.hash || '')) continue;
    const hash = (item.infoHash || item.hash).toLowerCase();
    const filename = cleanText(item.behaviorHints?.filename || item.filename, 350);
    const title = cleanText(item.description || item.title, 450) || filename || 'Torrent source';
    const fileIdx = Number.isSafeInteger(item.fileIdx) && item.fileIdx >= 0 && item.fileIdx <= 100000 ? item.fileIdx : null;
    const sizeValue = item.behaviorHints?.videoSize ?? item.size;
    const videoCodec = cleanText(item.videoCodec, 40);
    const audioCodecs = (Array.isArray(item.audioCodecs) ? item.audioCodecs : []).filter(v => typeof v === 'string').slice(0, 6).map(v => cleanText(v, 40));
    const resolution = cleanText(item.resolution, 20);
    const releaseQuality = cleanText(item.releaseQuality, 40);
    const container = cleanText(item.container, 24);
    let seeders = Number.isSafeInteger(item.seeders) && item.seeders >= 0 ? item.seeders : null;
    if (seeders === null) {
      const text = [item.description, item.title, item.name, item.label].filter(v => typeof v === 'string').join(' ');
      const m = /(?:👤|\bseed(?:er)?s?\b\s*[:=]?)\s*([0-9][0-9,]*)/i.exec(text);
      if (m) { const value = Number(m[1].replace(/,/g, '')); if (Number.isSafeInteger(value) && value >= 0) seeders = value; }
    }
    const provider = cleanText(item.provider, 60);
    const providers = [...new Set([...(Array.isArray(item.providers) ? item.providers : []), provider].filter(v => typeof v === 'string').map(v => cleanText(v, 60)).filter(Boolean))].slice(0, 6);
    const languages = normalizeSourceLanguages(item.languages);
    const languageEvidence = [...new Set((Array.isArray(item.languageEvidence)?item.languageEvidence:[]).filter(value=>['structured:languages','structured:language','description:audio'].includes(value)))];
    const source = { hash, filename, title, label: cleanText(item.name || item.label, 80), provider, providers, fileIdx, size: parseSizeBytes(sizeValue), seeders, videoCodec, audioCodecs, languages, languageEvidence, resolution, releaseQuality, container };
    // Source file indexes are not TorBox file IDs. Never treat them as interchangeable.
    const key = `${hash}:${filename}:${fileIdx}`;
    if (!map.has(key)) map.set(key, { ...source, ...sourceHints(source) });
  }
  return [...map.values()].sort((a, b) => b.score - a.score || (a.size || Infinity) - (b.size || Infinity)).slice(0, MAX_SOURCES);
}
export async function loadPublicSources(input, { signal, fetchFn = fetch, api, fast = false, complete = false, refresh = false, withMetadata = false } = {}) {
  const target = targetOf(input);
  const params = new URLSearchParams({ type: target.type, id: target.id });
  if (target.type === 'series') { params.set('season', target.season); params.set('episode', target.episode); }
  if(fast)params.set('fast','1');if(complete)params.set('complete','1');if(refresh)params.set('refresh','1');
  if(api){const data=await api(`${SOURCE_PATH}?${params}`,{signal});const sources=normalizeSources(data?.sources);return withMetadata?{sources,complete:data?.complete!==false}:sources;}
  let response;
  try {
    const token = getSessionToken();
    response = await fetchFn(apiUrl(`${SOURCE_PATH}?${params}`), {
      method: 'GET', mode: apiMode(), credentials: credentialsMode(), cache: 'no-store', redirect: 'error',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('The website could not complete the source request. Check your connection and try again. No torrent has been added.');
  }
  try {
    if (response.status === 401) throw new Error('Your household sign-in expired. Refresh the page and sign in again.');
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) throw new Error('The source response was too large.'); chunks.push(value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error(`The website returned an unreadable source response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(cleanText(data?.message, 500) || `Source lookup failed (HTTP ${response.status}). No torrent has been added.`);
    const sources = normalizeSources(data?.sources);
    if (!sources.length && Array.isArray(data?.sources) && data.sources.length) throw new Error('The provider returned no supported torrent hashes for this title. No download was started.');
    return withMetadata?{sources,complete:data?.complete!==false}:sources;
  } finally { try { if (!response.bodyUsed) await response.body?.cancel(); } catch {} }
}

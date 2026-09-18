// Shared source normalization and authenticated same-origin lookup. No provider keys here.
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
export function sourceHints(source) {
  const name = `${source.filename || ''} ${source.title || ''} ${source.label || ''}`;
  const mp4 = /\.mp4\b/i.test(name), modern = /\b(hevc|h[ ._-]?265|x265|av1)\b/i.test(name);
  const difficultAudio = /\b(dts|truehd|e[ ._-]?ac[ ._-]?3|ac[ ._-]?3|ddp|dd\+)/i.test(name);
  const h264 = /\b(h[ ._-]?264|x264|avc)\b/i.test(name), aac = /\baac\b/i.test(name);
  const quality = /\b(2160p|1080p|720p|480p|4k)\b/i.exec(name)?.[1].toUpperCase() || '';
  const score = (mp4 ? 35 : 0) + (h264 ? 10 : 0) + (aac ? 10 : 0) - (modern ? 25 : 0) - (difficultAudio ? 20 : 0) + (['1080P', '720P'].includes(quality) ? 8 : 0) - (['2160P', '4K'].includes(quality) ? 10 : 0);
  return { quality, score, hint: modern || difficultAudio ? 'May require conversion' : mp4 ? 'MP4 candidate' : h264 && aac ? 'H.264 / AAC indicated' : 'Codecs not confirmed' };
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
    const source = { hash, filename, title, label: cleanText(item.name || item.label, 80), fileIdx, size: Number.isSafeInteger(sizeValue) && sizeValue > 0 ? sizeValue : null };
    // Source file indexes are not TorBox file IDs. Never treat them as interchangeable.
    const key = `${hash}:${filename}:${fileIdx}`;
    if (!map.has(key)) map.set(key, { ...source, ...sourceHints(source) });
  }
  return [...map.values()].sort((a, b) => b.score - a.score || (a.size || Infinity) - (b.size || Infinity)).slice(0, MAX_SOURCES);
}
export async function loadPublicSources(input, { signal, fetchFn = fetch } = {}) {
  const target = targetOf(input);
  const params = new URLSearchParams({ type: target.type, id: target.id });
  if (target.type === 'series') { params.set('season', target.season); params.set('episode', target.episode); }
  let response;
  try {
    response = await fetchFn(`${SOURCE_PATH}?${params}`, {
      method: 'GET', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
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
    if (!sources.length && data.sources.length) throw new Error('The provider returned no supported torrent hashes for this title. No download was started.');
    return sources;
  } finally { try { if (!response.bodyUsed) await response.body?.cancel(); } catch {} }
}

export const EXTRA_GAMES_BUILD = 'release-1.2.3-party.1';
const ID = /^[a-z][a-z0-9_-]{0,79}$/;
const BUNDLE = /^games-data\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.jsdos$/;
const PAGE = /^games-web\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\/index\.html$/;
export const MINDMAZE_URL = 'https://gorjan.rocks/projects/mindmaze/';

function text(value, maximum) { return typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : null; }
function sourceLink(value) {
  if (typeof value !== 'string' || value.length > 700 || /[\x00-\x20\x7f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : null; }
  catch { return null; }
}
export function cleanExtraGamesCatalog(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length > 2000) throw new Error('The extra game list is invalid.');
  const seen = new Set(), items = [];
  for (const row of raw.items) {
    if (!row || !ID.test(row.id || '') || seen.has(row.id) || !['dos','web'].includes(row.platform)) continue;
    const title = text(row.title,160), controls = text(row.controls,700), license = text(row.license,200), source = sourceLink(row.source);
    if (!title || !controls || !license || !source || !Array.isArray(row.keys) || row.keys.length > 16) continue;
    const hosted = row.id === 'mindmaze-encarta' && row.platform === 'web' && row.hosted === MINDMAZE_URL && row.page === undefined && row.bundle === undefined && row.keys.length === 0 && source === MINDMAZE_URL;
    const path = row.platform === 'dos' ? row.bundle : row.page;
    if (!hosted && (row.hosted !== undefined || typeof path !== 'string' || !(row.platform === 'dos' ? BUNDLE : PAGE).test(path))) continue;
    const codes = new Set(), keys = []; let invalidKey = false;
    for (const key of row.keys) {
      const label = text(key?.label,32);
      if (!label || !Number.isInteger(key.code) || key.code < 32 || key.code > 348 || codes.has(key.code)) { invalidKey = true; break; }
      codes.add(key.code); keys.push({label,code:key.code});
    }
    if (invalidKey) continue;
    seen.add(row.id);
    items.push({id:row.id,title,platform:row.platform,...(hosted ? {hosted:MINDMAZE_URL} : row.platform === 'dos' ? {bundle:path} : {page:path}),controls,keys,license,source});
  }
  return {version:1,items:items.sort((a,b) => a.title.localeCompare(b.title,undefined,{sensitivity:'base'}) || a.id.localeCompare(b.id))};
}

export function extraPlayerUrl(item, build = EXTRA_GAMES_BUILD) {
  const valid = cleanExtraGamesCatalog({version:1,items:[item]}).items[0];
  if (!valid || typeof build !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(build)) throw new Error('This extra game cannot open.');
  if (valid.hosted) return MINDMAZE_URL;
  return valid.platform === 'dos' ? `./dos-player.html?game=${encodeURIComponent(valid.id)}&v=${build}` : `./${valid.page}?v=${build}`;
}
export function extraKeyCommand(key, pressed) {
  if (!Number.isInteger(key) || key < 32 || key > 348 || typeof pressed !== 'boolean') throw new Error('The game key is invalid.');
  return {type:'torbox-extra-command',command:'key',key,pressed};
}
export function readExtraStatus(event, expectedSource, expectedOrigin) {
  if (!expectedSource || event.source !== expectedSource || event.origin !== expectedOrigin) return null;
  const data = event.data;
  if (!data || data.type !== 'torbox-extra-status' || !['loading','playing','paused','error'].includes(data.state) || typeof data.message !== 'string' || data.message.length > 700) return null;
  if (data.frames !== undefined && (!Number.isSafeInteger(data.frames) || data.frames < 0)) return null;
  return {state:data.state,message:data.message,frames:data.frames || 0};
}

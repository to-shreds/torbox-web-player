import test from 'node:test';
// Explicit observational probe. Never enqueue a torrent or disclose credentials.
// Disabled during normal builds. Provider failures are logged as failures, not empty results.
const keys = value => value && typeof value === 'object' ? Object.keys(value).filter(k => /^[A-Za-z_]{1,50}$/.test(k)).slice(0, 40) : [];
async function read(url, { authenticated = false, ...options } = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(authenticated ? { Authorization: `Bearer ${process.env.TORBOX_API_KEY || ''}` } : {}), ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(18000) });
    const reader = response.body.getReader(); let length = 0; const chunks = [];
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 8 * 1024 * 1024) throw new Error(); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(() => {}); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    return { status: response.status, data };
  } catch { return { status: 0 }; }
}
test('opt-in read-only external provider observations', { skip: process.env.CATALOG_CONTRACT_CHECK !== '1' }, async () => {
  const report = { event: 'catalog_contract_check', observations: {} };
  const catalog = await read('https://v3-cinemeta.strem.io/catalog/movie/top/search=Big%20Buck%20Bunny.json');
  report.observations.catalog = { status: catalog.status, count: catalog.data?.metas?.length ?? null, firstKeys: keys(catalog.data?.metas?.[0]), exactMatch: catalog.data?.metas?.some(m => m.id === 'tt1254207') === true };
  const meta = await read('https://v3-cinemeta.strem.io/meta/movie/tt1254207.json');
  report.observations.meta = { status: meta.status, keys: keys(meta.data?.meta), idMatches: meta.data?.meta?.id === 'tt1254207', posterHost: (() => { try { return new URL(meta.data.meta.poster).hostname; } catch { return null; } })() };
  const series = await read('https://v3-cinemeta.strem.io/meta/series/tt4549142.json');
  report.observations.episodes = { status: series.status, count: series.data?.meta?.videos?.length ?? null, keys: keys(series.data?.meta?.videos?.[0]) };
  const search = await read('https://search-api.torbox.app/torrents/imdb:tt1254207', { authenticated: true });
  report.observations.torboxSearch = { status: search.status, success: search.data?.success === true, count: search.data?.data?.torrents?.length ?? null, keys: keys(search.data?.data?.torrents?.[0]) };
  const torrent = await read('https://torrentio.strem.fun/stream/movie/tt1254207.json');
  const streams = torrent.data?.streams;
  report.observations.torrentio = { status: torrent.status, count: Array.isArray(streams) ? streams.length : null, keys: keys(streams?.[0]), hintKeys: keys(streams?.[0]?.behaviorHints), hashes: Array.isArray(streams) ? streams.filter(s => /^[a-f0-9]{40}$/i.test(s.infoHash || '')).length : 0 };
  const hash = streams?.find(s => /^[a-f0-9]{40}$/i.test(s.infoHash || ''))?.infoHash;
  if (hash) {
    const cached = await read(`https://api.torbox.app/v1/api/torrents/checkcached?hash=${hash}&format=object&list_files=true`, { authenticated: true });
    const item = cached.data?.data?.[hash.toLowerCase()] || cached.data?.data?.[hash];
    report.observations.cache = { status: cached.status, success: cached.data?.success === true, found: !!item, keys: keys(item), fileKeys: keys(item?.files?.[0]) };
  }
  const schema = await read('https://api.torbox.app/openapi.json');
  const create = schema.data?.components?.schemas?.Body_create_torrent_v1_api_torrents_createtorrent_post;
  report.observations.createSchema = { status: schema.status, properties: create?.properties || null };
  console.log(JSON.stringify(report));
});

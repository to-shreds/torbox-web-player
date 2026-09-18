import test from 'node:test';
// Read-only diagnostic. No torrent additions, media downloads, or raw secret logs.
async function observe(label, url, authenticated = false) {
  const started = Date.now();
  let response;
  const summary = { label };
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...(authenticated ? { Authorization: `Bearer ${process.env.TORBOX_API_KEY || ''}` } : {}) },
      redirect: 'manual', signal: AbortSignal.timeout(60000)
    });
    summary.status = response.status;
    summary.type = response.headers.get('content-type')?.split(';')[0];
    if (response.status >= 300 && response.status < 400) {
      try { summary.redirectOrigin = new URL(response.headers.get('location'), url).origin; } catch {}
      return summary;
    }
    const reader = response.body?.getReader();
    if (!reader) return summary;
    let size = 0; const chunks = [];
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 8 * 1024 * 1024) throw new Error('OVERSIZE'); chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(() => {}); }
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { summary.json = false; return summary; }
    summary.json = true; summary.success = data?.success === true;
    if (['PLAN_RESTRICTED_FEATURE', 'AUTH_ERROR', 'SEARCH_ERROR', 'RATE_LIMITED', 'INVALID_API_KEY'].includes(data?.error)) summary.error = data.error;
    const fields = x => x && typeof x === 'object' ? Object.keys(x).filter(k => /^[a-zA-Z_]{1,40}$/.test(k)).slice(0, 30) : [];
    summary.rootFields = fields(data); summary.dataFields = fields(data?.data);
    const torrents = data?.data?.torrents;
    if (Array.isArray(torrents)) {
      summary.count = torrents.length; summary.itemFields = fields(torrents[0]);
      summary.itemTypes = Object.fromEntries(Object.entries(torrents[0] || {}).filter(([k]) => /^[a-zA-Z_]{1,40}$/.test(k)).map(([k,v]) => [k, Array.isArray(v) ? 'array' : typeof v]));
      summary.validHashes = torrents.filter(t => /^[a-f0-9]{40}$/i.test(t.hash || t.info_hash || t.infoHash || '')).length;
      summary.magnets = torrents.filter(t => typeof t.magnet === 'string' && t.magnet.startsWith('magnet:')).length;
      summary.fileFields = fields(torrents[0]?.files?.[0]);
    }
    if (data?.paths) summary.searchPaths = Object.keys(data.paths).filter(p => /torrent|search/.test(p)).slice(0, 30);
  } catch (e) {
    const code = e?.cause?.code || e?.code || e?.name;
    summary.transportError = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'TimeoutError', 'AbortError'].includes(code) ? code : 'FETCH_FAILED';
  } finally {
    try { if (!response?.bodyUsed) await response?.body?.cancel(); } catch {}
    summary.durationMs = Date.now() - started;
  }
  return summary;
}
test('opt-in TorBox source-access observations', { skip: process.env.SOURCE_ACCESS_CHECK !== '1', timeout: 70000 }, async () => {
  const results = await Promise.all([
    observe('search_schema', 'https://search-api.torbox.app/openapi.json'),
    observe('movie_sources', 'https://search-api.torbox.app/torrents/imdb:tt1254207', true),
    observe('episode_sources', 'https://search-api.torbox.app/torrents/imdb:tt4549142?season=1&episode=1', true)
  ]);
  console.log(JSON.stringify({ event: 'source_access_check', results }));
});

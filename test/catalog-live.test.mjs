import test from 'node:test';
import { createHash } from 'node:crypto';
import { createApp } from '../server.mjs';
import { TorBox } from '../lib/torbox.mjs';
// Opt-in hosted integration check. Uses only WebTorrent's Creative Commons sample.
// May add that sample to TorBox only if already cached; never downloads another title.
function torrentInfo(buffer) {
  let offset = 0, rawInfo;
  function read(depth = 0) {
    if (depth > 25 || offset >= buffer.length) throw new Error('BENCODE');
    const start = offset, c = String.fromCharCode(buffer[offset]);
    if (c === 'd') {
      offset++; const value = {};
      while (buffer[offset] !== 101) {
        const key = read(depth + 1); if (typeof key !== 'string') throw new Error('BENCODE');
        const begin = offset; const entry = read(depth + 1);
        if (depth === 0 && key === 'info') rawInfo = buffer.subarray(begin, offset);
        if (['name', 'info', 'files', 'path'].includes(key)) value[key] = entry;
      }
      offset++; return value;
    }
    if (c === 'l') { offset++; const list = []; while (buffer[offset] !== 101) list.push(read(depth + 1)); offset++; return list; }
    if (c === 'i') { const end = buffer.indexOf(101, ++offset); if (end < 0) throw new Error('BENCODE'); const v = Number(buffer.subarray(offset, end).toString()); offset = end + 1; return v; }
    if (!/[0-9]/.test(c)) throw new Error('BENCODE');
    const colon = buffer.indexOf(58, offset); if (colon < 0 || colon - start > 10) throw new Error('BENCODE');
    const n = Number(buffer.subarray(offset, colon).toString()); offset = colon + 1;
    if (!Number.isSafeInteger(n) || n < 0 || offset + n > buffer.length) throw new Error('BENCODE');
    const value = buffer.subarray(offset, offset + n).toString('utf8'); offset += n; return value;
  }
  const decoded = read(); if (!rawInfo) throw new Error('NO_INFO');
  return { hash: createHash('sha1').update(rawInfo).digest('hex'), info: decoded.info };
}
async function bounded(response, max) {
  const reader = response.body.getReader(); let size = 0; const parts = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; if (size + value.length > max) throw new Error('TOO_LARGE'); parts.push(Buffer.from(value)); size += value.length; } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
test('opt-in public sample catalog-to-TorBox integration observation', { skip: process.env.CATALOG_LIVE_CHECK !== '1', timeout: 150000 }, async () => {
  const report = { event: 'catalog_pipeline_check', sample: 'WebTorrent Big Buck Bunny', browserPlaybackVerified: false };
  let app;
  try {
    const upstream = await fetch('https://webtorrent.io/torrents/big-buck-bunny.torrent', { redirect: 'error', signal: AbortSignal.timeout(15000) });
    report.sampleSourceHttp = upstream.status;
    if (!upstream.ok) throw new Error('SAMPLE_UNAVAILABLE');
    const parsed = torrentInfo(await bounded(upstream, 2 * 1024 * 1024));
    const filename = parsed.info.files?.map(f => f.path?.join('/')).find(p => /\.mp4$/i.test(p || '')) || parsed.info.name;
    app = createApp(); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const created = app.sessions.create();
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const headers = { Cookie: `tw_session=${created.id}`, Origin: process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL, 'X-CSRF-Token': created.row.csrf, 'Content-Type': 'application/json' };
    const call = async (path, method = 'GET', data) => {
      const response = await fetch(base + path, { method, headers, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(70000) });
      const body = await response.json();
      if (process.env.TORBOX_API_KEY && JSON.stringify(body).includes(process.env.TORBOX_API_KEY)) throw new Error('SECRET_IN_RESPONSE');
      if (!response.ok) { const e = new Error('ROUTE_FAILED'); e.code = /^[A-Z_]{1,80}$/.test(body.error || '') ? body.error : 'ROUTE_FAILED'; throw e; }
      return body;
    };
    const found = await call('/api/discover/catalog?type=movie&q=tt1254207');
    report.catalogIdMatch = found.metas?.[0]?.id === 'tt1254207';
    const before = await app.discovery.gateway.find(parsed.hash); report.previouslyInAccount = !!before;
    const registered = await call('/api/discover/sources', 'POST', { target: { type: 'movie', id: 'tt1254207' }, sources: [{ infoHash: parsed.hash, filename, title: 'WebTorrent Creative Commons sample', fileIdx: 0 }] });
    report.sources = registered.sources.length; report.cached = registered.sources[0]?.cached ?? null;
    if (!report.cached && !before) { report.stopped = 'sample_not_cached_no_addition_attempted'; return; }
    let state = await call('/api/discover/prepare', 'POST', { source: registered.sources[0].id, onlyCached: true });
    for (let n = 0; n < 4 && state.state === 'preparing'; n++) { await new Promise(r => setTimeout(r, 2000)); state = await call('/api/discover/status?source=' + registered.sources[0].id); }
    report.state = state.state;
    if (state.state !== 'ready') return;
    const playback = await call('/api/playback', 'POST', { viewer: 'viewer-1', videoId: state.file.id });
    report.sameOriginTicket = /^\/media\/[A-Za-z0-9_-]{43}$/.test(playback.mediaUrl || '');
    if (!report.sameOriginTicket) throw new Error('BAD_MEDIA_PATH');
    const media = await fetch(base + playback.mediaUrl, { headers: { Cookie: headers.Cookie, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) });
    report.mediaHttp = media.status; report.mediaType = media.headers.get('content-type'); report.bytes = (await bounded(media, 65536)).length;
    const progress = await call('/api/progress', 'PUT', { viewer: 'viewer-1', videoId: state.file.id, leaseId: playback.leaseId, seq: 1, position: 30, duration: 600 });
    report.progressSaved = progress.saved === true;
    const reopened = await call('/api/playback', 'POST', { viewer: 'viewer-1', videoId: state.file.id });
    report.resumeReturned = reopened.progress?.position === 30;
  } catch (e) { report.error = /^[A-Z_]{1,80}$/.test(e?.code || '') ? e.code : 'CHECK_FAILED'; }
  finally {
    if (app) { app.sessions.revokeAll(); app.server.closeAllConnections(); app.server.close(); }
    console.log(JSON.stringify(report));
  }
});

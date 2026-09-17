import { AppError, parseVideoId } from './torbox.mjs';
import { createApp } from '../server.mjs';
const errorCode = error => error instanceof AppError ? error.code : 'INTERNAL_ERROR';
const CODECS = ['V_MPEG4/ISO/AVC', 'V_MPEGH/ISO/HEVC', 'V_AV1', 'V_VP9', 'A_AAC', 'A_AC3', 'A_EAC3', 'A_DTS', 'A_TRUEHD', 'A_OPUS', 'A_VORBIS'];
async function readBounded(response, max = 262144) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = []; let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read(); if (done) break;
      const part = value.subarray(0, max - total); parts.push(Buffer.from(part)); total += part.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(parts);
}
async function streamCapability(provider, videoId) {
  const { kind, itemId, fileId } = parseVideoId(videoId);
  const url = new URL('https://api.torbox.app/v1/api/stream/createstream');
  for (const [name, value] of Object.entries({ id: itemId, file_id: fileId, type: { torrents: 'torrent', webdl: 'webdownload', usenet: 'usenet' }[kind], scrobbling_enabled: false })) url.searchParams.set(name, String(value));
  const response = await provider.fetchFn(url, { headers: { Authorization: `Bearer ${provider.key}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
  let data;
  try { data = JSON.parse((await readBounded(response, 65536)).toString('utf8')); } catch { return { status: response.status, validJson: false }; }
  const result = { status: response.status, success: data?.success === true };
  // Do not copy provider prose, account data, tokens, URLs or titles into logs.
  if (typeof data?.error === 'string' && /^[A-Z_]{1,60}$/.test(data.error)) result.error = data.error;
  const detail = typeof data?.detail === 'string' ? data.detail.toLowerCase() : '';
  result.requiresPro = /pro (?:plan|subscription|account)|(?:upgrade|requires|need).*pro/.test(detail);
  const object = data?.data;
  if (object && typeof object === 'object') {
    const expected = ['token', 'file_token', 'presigned_token', 'stream_url', 'hls_url', 'dash_url', 'player_url', 'stream_id', 'metadata', 'streams', 'url', 'playlist', 'manifest', 'mpd_url'];
    result.fieldsPresent = expected.filter(key => Object.hasOwn(object, key));
    result.dataType = Array.isArray(object) ? 'array' : 'object';
  } else result.dataType = typeof object;
  return result;
}
export async function runStartupProbe(provider, log = console.log) {
  const summary = { event: 'torbox_startup_check', ok: false, account: false, sections: {}, samples: [] };
  let app;
  try {
    const account = await provider.account(); summary.account = account?.valid === true; summary.planCode = account?.planCode ?? 'not supplied';
    const ready = [];
    for (const kind of ['torrents', 'webdl', 'usenet']) {
      try {
        const page = await provider.list(kind, 0, true); const files = Array.isArray(page?.files) ? page.files : [];
        const available = files.filter(file => file.state === 'Ready to watch'); ready.push(...available);
        const extensions = {};
        for (const file of files) { const extension = /\.(mp4|m4v|webm|mkv|mov|avi|ts)$/i.exec(file.title)?.[1].toLowerCase() || 'other'; extensions[extension] = (extensions[extension] || 0) + 1; }
        summary.sections[kind] = { videos: files.length, ready: available.length, extensions, hasMore: page.nextOffset !== null };
      } catch (error) { summary.sections[kind] = { error: errorCode(error) }; }
    }
    // Isolated instance: never alter a household viewer's real resume point or session.
    app = createApp({ provider });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const created = app.sessions.create();
    const headers = { Cookie: `tw_session=${created.id}`, Origin: process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:10000', 'X-CSRF-Token': created.row.csrf, 'Content-Type': 'application/json' };
    const samples = [...new Set([ready.find(file => /\.mkv$/i.test(file.title)), ready.find(file => /\.mp4$/i.test(file.title)), ready[0]].filter(Boolean))].slice(0, 2);
    for (const file of samples) {
      const sample = { extension: /\.(\w+)$/.exec(file.title)?.[1].toLowerCase() || 'unknown' };
      try {
        const playback = await fetch(base + '/api/playback', { method: 'POST', headers, body: JSON.stringify({ viewer: 'viewer-1', videoId: file.id }), signal: AbortSignal.timeout(20000) });
        sample.playbackStatus = playback.status; const result = await playback.json();
        sample.masterKeyInResponse = !!provider.key && JSON.stringify(result).includes(provider.key);
        if (playback.ok && /^\/media\/[A-Za-z0-9_-]{43}$/.test(result.mediaUrl || '')) {
          const response = await fetch(base + result.mediaUrl, { headers: { Cookie: headers.Cookie, Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(20000) });
          const bytes = await readBounded(response);
          sample.rangeStatus = response.status; sample.bytesRead = bytes.length;
          sample.contentType = response.headers.get('content-type'); sample.acceptRanges = response.headers.get('accept-ranges');
          sample.matroskaHeader = bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
          sample.codecMarkers = CODECS.filter(codec => bytes.includes(Buffer.from(codec)));
        } else if (/^[A-Z_]+$/.test(result.error || '')) sample.error = result.error;
        sample.browserStream = await streamCapability(provider, file.id);
      } catch (error) { sample.error = errorCode(error); }
      summary.samples.push(sample);
    }
    summary.ok = summary.account && summary.samples.some(sample => sample.rangeStatus === 206 && !sample.masterKeyInResponse);
  } catch (error) { summary.error = errorCode(error); }
  finally { if (app) { app.sessions.revokeAll(); app.server.closeAllConnections(); app.server.close(); } }
  log(JSON.stringify(summary));
  return summary;
}

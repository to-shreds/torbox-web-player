// Browser-side checks use only the session-bound same-origin media ticket.
// Never accept or inspect a TorBox URL, API key, or provider response here.
export function matchesFormat(file, format = 'all') {
  return format !== 'mp4' || /\.mp4$/i.test(file.title || '');
}
export async function diagnosePlaybackFailure(mediaUrl, browserCode, fetchFn = fetch) {
  const result = (kind, message, retry = true) => ({ kind, message, retry });
  if (!/^\/media\/[A-Za-z0-9_-]{43}$/.test(mediaUrl || '')) {
    return result('session', 'This playback session is no longer available. Close and reopen the file.');
  }
  if (browserCode === 1) return result('cancelled', 'Playback was cancelled. Close and reopen the file to try again.');
  let response;
  try {
    response = await fetchFn(mediaUrl, {
      method: 'GET', headers: { Range: 'bytes=0-0' }, credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000)
    });
    if (response.status === 401) return result('session', 'Your household session has expired. Sign in again, then reopen this file.');
    if (response.status === 404) return result('session', 'This playback link has expired or the server restarted. Reopen the file for a new link.');
    if (response.status === 429) return result('network', 'The stream is rate limited. Pause before trying New playback link again.');
    if (![200, 206].includes(response.status)) return result('network', `The media request failed (HTTP ${response.status}). This does not establish a codec problem. Try New playback link once.`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('video/') && type !== 'application/octet-stream') {
      return result('network', 'The stream check did not return video data. Close and reopen the file; this is not a confirmed codec problem.');
    }
    if ([3, 4].includes(browserCode)) {
      return result('codec', `The stream is reachable, but this browser rejected the file format or could not decode it (browser error ${browserCode}). This build does not convert video or audio. Renewing the link cannot fix an unsupported codec. Try Show MP4 files; those still need supported video and audio.`, false);
    }
    if (browserCode === 2) return result('network', 'The browser lost the media connection. The stream is reachable now; try New playback link once.');
    return result('unknown', 'The stream is reachable, but the browser did not identify why playback failed. Try New playback link once or another file.');
  } catch {
    return result('network', 'The stream check timed out or the connection failed. Codec compatibility could not be checked. Check your connection, then reopen the file.');
  } finally {
    try { await response?.body?.cancel(); } catch {}
  }
}

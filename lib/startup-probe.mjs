import { AppError } from './torbox.mjs';

const errorCode = error => error instanceof AppError ? error.code : 'INTERNAL_ERROR';

async function probeRange(fetchFn, url) {
  let response;
  try {
    response = await fetchFn(url, { headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return { status: response.status, contentType: response.headers.get('content-type') || '', acceptRanges: response.headers.get('accept-ranges') || '', contentRange: response.headers.get('content-range') || '' };
  } catch (error) { return { error: errorCode(error) }; }
  finally { try { await response?.body?.cancel(); } catch {} }
}

export async function runStartupProbe(provider, log = console.log) {
  const summary = { event: 'torbox_startup_check', ok: false, account: false, sections: {}, relaySourceCreated: false };
  try {
    const account = await provider.account();
    summary.account = account?.valid === true;
    summary.planCode = account?.planCode ?? 'not supplied';
    let firstReady = null;
    for (const kind of ['torrents', 'webdl', 'usenet']) {
      try {
        const page = await provider.list(kind, 0, true);
        const files = Array.isArray(page?.files) ? page.files : [];
        const ready = files.filter(file => file.state === 'Ready to watch');
        summary.sections[kind] = { videos: files.length, ready: ready.length };
        if (!firstReady && ready.length) firstReady = ready[0];
      } catch (error) { summary.sections[kind] = { error: errorCode(error) }; }
    }
    if (firstReady) {
      try {
        const stream = await provider.resolveForRelay(firstReady.id);
        summary.relaySourceCreated = true;
        summary.mediaHost = new URL(stream.upstreamUrl).hostname;
        summary.upstreamRange = await probeRange(provider.fetchFn, stream.upstreamUrl);
      } catch (error) { summary.playbackError = errorCode(error); }
    }
    summary.ok = summary.account && Object.values(summary.sections).some(section => !section.error) && summary.relaySourceCreated;
  } catch (error) { summary.error = errorCode(error); }
  log(JSON.stringify(summary));
  return summary;
}

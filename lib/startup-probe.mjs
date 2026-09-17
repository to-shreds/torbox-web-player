import { AppError, KINDS, parseVideoId } from './torbox.mjs';

const errorCode = error => error instanceof AppError ? error.code : 'INTERNAL_ERROR';

async function probeRange(fetchFn, url) {
  let response;
  try {
    response = await fetchFn(url, {
      headers: { Range: 'bytes=0-0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      acceptRanges: response.headers.get('accept-ranges') || '',
      contentRange: response.headers.get('content-range') || ''
    };
  } catch (error) {
    return { error: errorCode(error) };
  } finally {
    try { await response?.body?.cancel(); } catch {}
  }
}

export async function runStartupProbe(provider, log = console.log) {
  const summary = {
    event: 'torbox_startup_check',
    ok: false,
    account: false,
    sections: {},
    playbackLinkCreated: false
  };

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
      } catch (error) {
        summary.sections[kind] = { error: errorCode(error) };
      }
    }

    if (firstReady) {
      try {
        const stream = await provider.resolve(firstReady.id);
        summary.playbackLinkCreated = typeof stream?.url === 'string' && stream.url.startsWith('https://');
        if (summary.playbackLinkCreated) summary.mediaHost = new URL(stream.url).hostname;
      } catch (error) {
        summary.playbackError = errorCode(error);
        if (['MEDIA_HOST_NOT_VERIFIED', 'UNSAFE_PROVIDER_URL'].includes(summary.playbackError)) {
          try {
            const { kind, itemId, fileId } = parseVideoId(firstReady.id);
            const rawLink = await provider.request(`${kind}/requestdl`, {
              [KINDS[kind]]: itemId,
              file_id: fileId,
              zip_link: false,
              redirect: false
            }, { tokenInQuery: true });

            if (typeof rawLink === 'string') {
              const parsed = new URL(rawLink);
              summary.observedMediaHost = parsed.hostname;

              if (provider.key) {
                const secretParams = [...new Set([...parsed.searchParams.entries()]
                  .filter(([, value]) => value.includes(provider.key))
                  .map(([name]) => name))];
                summary.keyQueryParameters = secretParams;
                summary.keyOutsideQuery = parsed.pathname.includes(provider.key) || parsed.hash.includes(provider.key) || parsed.username.includes(provider.key) || parsed.password.includes(provider.key);

                summary.originalRange = await probeRange(provider.fetchFn, parsed.href);

                if (secretParams.length && !summary.keyOutsideQuery) {
                  const sanitized = new URL(parsed.href);
                  for (const name of secretParams) sanitized.searchParams.delete(name);
                  summary.sanitizedRange = await probeRange(provider.fetchFn, sanitized.href);
                }
              }
            }
          } catch (hostError) {
            summary.hostProbeError = errorCode(hostError);
          }
        }
      }
    }

    summary.ok = summary.account && Object.values(summary.sections).some(section => !section.error);
  } catch (error) {
    summary.error = errorCode(error);
  }

  log(JSON.stringify(summary));
  return summary;
}

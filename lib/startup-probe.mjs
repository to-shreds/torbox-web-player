import { AppError, KINDS, parseVideoId } from './torbox.mjs';

const errorCode = error => error instanceof AppError ? error.code : 'INTERNAL_ERROR';

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
        if (summary.playbackError === 'MEDIA_HOST_NOT_VERIFIED') {
          try {
            const { kind, itemId, fileId } = parseVideoId(firstReady.id);
            const rawLink = await provider.request(`${kind}/requestdl`, {
              [KINDS[kind]]: itemId,
              file_id: fileId,
              zip_link: false,
              redirect: false
            }, { tokenInQuery: true });
            if (typeof rawLink === 'string') summary.observedMediaHost = new URL(rawLink).hostname;
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

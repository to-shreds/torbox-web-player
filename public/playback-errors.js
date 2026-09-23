import { isTrustedMediaUrl, isTrustedRelayMediaUrl } from './runtime.js?v=restored11';
export function matchesFormat(file, format = 'all') {
  return format !== 'mp4' || /\.mp4$/i.test(file.title || '');
}
export async function diagnosePlaybackFailure(mediaUrl, browserCode) {
  const result = (kind, message, retry = true) => ({ kind, message, retry });
  if (!isTrustedMediaUrl(mediaUrl)) return result('session', 'This playback link is not trusted. Close and reopen the file.', false);
  const relayed = isTrustedRelayMediaUrl(mediaUrl);
  if (browserCode === 1) return result('cancelled', 'Playback was cancelled. Close and reopen the file to try again.');
  if (browserCode === 2) return result('network', relayed ? 'The protected stream could not reach this browser.' : 'The direct TorBox stream was interrupted or its temporary link expired.');
  if ([3, 4].includes(browserCode)) return result('codec', `This browser rejected the file format or codec (browser error ${browserCode}). The protected relay transports the original file but does not convert video or audio.`, false);
  return result('network', relayed ? 'The protected stream failed before playback started.' : 'Direct TorBox playback failed.');
}

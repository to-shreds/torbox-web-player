// Direct TorBox playback only. No Render media relay exists.
import { isTrustedDirectMediaUrl } from './runtime.js?v=2.2.0';
export function matchesFormat(file, format = 'all') {
  return format !== 'mp4' || /\.mp4$/i.test(file.title || '');
}
export async function diagnosePlaybackFailure(mediaUrl, browserCode) {
  const result = (kind, message, retry = true) => ({ kind, message, retry });
  if (!isTrustedDirectMediaUrl(mediaUrl)) return result('session', 'This playback link is not a trusted TorBox media URL. Close and reopen the file.');
  if (browserCode === 1) return result('cancelled', 'Playback was cancelled. Close and reopen the file to try again.');
  if (browserCode === 2) return result('network', 'The direct TorBox stream was interrupted or its temporary link expired. Try New playback link once.');
  if ([3, 4].includes(browserCode)) return result('codec', `TorBox delivered the file directly, but this browser rejected its format or codec (browser error ${browserCode}). Choose another version. This build does not convert video or audio.`, false);
  return result('network', 'Direct TorBox playback failed. Try New playback link once or choose another version.');
}

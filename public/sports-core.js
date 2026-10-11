// Public sports sources are separate from TorBox authentication and media rules.
export const SPORTS_MEDIA_HOSTS = Object.freeze([
  'rbmn-live.akamaized.net', 'play.redbull.com',
  'amg01444-tennischannel-amg01444c2-lg-us-959.playouts.now.amagi.tv',
  'amg01444-amg01444c3-lg-us-3412.playouts.now.amagi.tv',
  'amg01874-nhl-amg01874c1-lg-us-5458.playouts.now.amagi.tv'
]);
export function sportsMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 16000) throw new Error('Unverified sports source.');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !SPORTS_MEDIA_HOSTS.includes(u.hostname)) throw new Error('Unverified sports source.');
  return u.href;
}
export function cleanSportsCatalog(raw) {
  if (!raw || !Array.isArray(raw.items)) throw new Error('Sports could not be loaded.');
  const seen = new Set();
  const items = raw.items.slice(0, 160).flatMap(row => {
    if (!row || !/^[a-z0-9-]{1,100}$/.test(row.id) || seen.has(row.id) || !['live', 'replay'].includes(row.kind) || !['tennis', 'padel', 'pickleball', 'hockey', 'mixed'].includes(row.sport)) return [];
    const sources = (Array.isArray(row.sources) ? row.sources : []).slice(0, 4).flatMap(source => {
      try {
        if (source.type === 'hls') return [{type:'hls', label:String(source.label || 'Channel').slice(0, 70), url:sportsMediaUrl(source.url)}];
        if (source.type === 'redbull' && /^rrn:content:live-videos:[a-f0-9-]{36}:en-INT$/.test(source.videoId)) return [{type:'redbull',label:'Red Bull TV',videoId:source.videoId}];
      } catch {}
      return [];
    });
    if (!sources.length) return [];
    seen.add(row.id);
    // Deliberately discard descriptions, images, scores and provider result text.
    return [{id:row.id,title:String(row.title || 'Sports').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0, 140),kind:row.kind,sport:row.sport,date:/^\d{4}-\d{2}-\d{2}/.test(row.date || '') ? row.date.slice(0,10) : '',sources}];
  });
  return {updated:String(raw.updated || '').slice(0,10),items};
}
export async function resolveSportsSource(source, {signal, fetchFn=fetch}={}) {
  if (source.type === 'hls') return sportsMediaUrl(source.url);
  if (source.type !== 'redbull' || !/^rrn:content:live-videos:[a-f0-9-]{36}:en-INT$/.test(source.videoId || '')) throw new Error('Unverified replay.');
  const u = new URL('https://api-player.redbull.com/rbcom/videoresource');
  u.searchParams.set('videoId',source.videoId);
  const response = await fetchFn(u.href,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error('This replay is currently unavailable.');
  if (Number(response.headers?.get('content-length')) > 1024*1024) throw new Error('Unreadable replay response.');
  const data = await response.json();
  if ((Array.isArray(data.playabilityErrors) && data.playabilityErrors.length) || !data.videoUrl) throw new Error('This replay is unavailable in your location or has expired. Try another event.');
  return sportsMediaUrl(data.videoUrl);
}
export function replayResume(position, duration) {
  return Number.isFinite(position) && Number.isFinite(duration) && position >= 10 && duration > 0 && position < duration - 30 ? Math.max(0, position - 5) : 0;
}

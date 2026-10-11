// Public sports sources are separate from TorBox authentication and media rules.
export const SPORTS_MEDIA_HOSTS = Object.freeze([
  "aegis-cloudfront-1.tubi.video",
  "amg01074-fueltv-amg01074c1-firetv-us-3150.playouts.now.amagi.tv",
  "amg01074-fueltv-fueltvemeaen-rakuten-b6j62.amagi.tv",
  "amg01444-amg01444c3-lg-us-3412.playouts.now.amagi.tv",
  "amg01444-tennischannel-amg01444c2-lg-us-959.playouts.now.amagi.tv",
  "amg01444-tennischannelth-tennischannelnl-samsungnl-x3dq1.amagi.tv",
  "amg01874-nhl-amg01874c1-lg-us-5458.playouts.now.amagi.tv",
  "amg01935-amg01935c1-amgplt0165.playout.now3.amagi.tv",
  "amg02278-amg02278c1-flosports-worldwide-7592.playouts.now.amagi.tv",
  "amg02278-amg02278c2-flosports-worldwide-9916.playouts.now.amagi.tv",
  "amg12058-c15studio-amg12058c1-lg-us-5787.playouts.now.amagi.tv",
  "bein-esp-xumo.amagi.tv",
  "d11k1mnrgfposz.cloudfront.net",
  "d1e354daam8g5r.cloudfront.net",
  "d1jzu95oc8fgt3.cloudfront.net",
  "d1m1xk35ma8qfl.cloudfront.net",
  "d1t5afz6qed3xk.cloudfront.net",
  "d265y4sk8257lt.cloudfront.net",
  "d2a31kzot4f8t3.cloudfront.net",
  "d2icntm6fhxrry.cloudfront.net",
  "d2w9b8sam7j3zv.cloudfront.net",
  "d2w9q46ikgrcwx.cloudfront.net",
  "d36r8jifhgsk5j.cloudfront.net",
  "d39accvx65hq9o.cloudfront.net",
  "d3ialx0k0mla2a.cloudfront.net",
  "d7vulbd7rxo7j.cloudfront.net",
  "d9ssxzmclhfo4.cloudfront.net",
  "dc1644a9jazgj.cloudfront.net",
  "dpltey7dr5q2g.cloudfront.net",
  "dt1kh32hg3tft.cloudfront.net",
  "dzz957bqk62e8.cloudfront.net",
  "linear-600.frequency.stream",
  "linear-893.frequency.stream",
  "mvg-mv-xumo.otteravision.com",
  "pb-2y9ox4r1fy550.akamaized.net",
  "pb-5pdyic0cu7tri.akamaized.net",
  "pb-783hpus5r91wv.akamaized.net",
  "pb-ljudrmfw5j68n.akamaized.net",
  "pb-we3ltka9xobj6.akamaized.net",
  "pb-wm04vonaerv0k.akamaized.net",
  "play.redbull.com",
  "rbmn-live.akamaized.net",
  "sportsgrid-samsungus.amagi.tv",
  "xumo-xumoent-vc-122-sjv70.fast.nbcuni.com"
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
  const items = raw.items.slice(0, 600).flatMap(row => {
    if (!row || !/^[a-z0-9-]{1,100}$/.test(row.id) || seen.has(row.id) || !['live', 'replay'].includes(row.kind) || !["action", "athletics", "baseball", "basketball", "billiards", "climbing", "combat", "cricket", "cycling", "football", "golf", "hockey", "mixed", "motorsport", "outdoors", "padel", "pickleball", "rugby", "skateboarding", "soccer", "surfing", "tennis", "watersports", "wintersports", "wrestling"].includes(row.sport)) return [];
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
    return [{id:row.id,title:String(row.title || 'Sports').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0, 140),kind:row.kind,sport:row.sport,provider:String(row.provider || sources[0].label).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,70),date:/^\d{4}-\d{2}-\d{2}/.test(row.date || '') ? row.date.slice(0,10) : '',sources}];
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

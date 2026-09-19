const KEY='torbox-settings-v1';
export const DEFAULT_SETTINGS=Object.freeze({
  resolution:'auto',
  resumeRewindSeconds:10,
  autoNext:true,
  autoRecovery:true,
  bufferSeconds:12,
  driveWatchOnly:true,
  recentLimit:6,
  pauseOverlay:true
});
const resolutions=new Set(['auto','480p','720p','1080p','2160p']);
const rewind=new Set([0,5,10,15,30]);
const buffer=new Set([8,12,20,30]);
const recent=new Set([4,6,8,10]);
function store(){try{return localStorage}catch{return null}}
export function normalizeSettings(raw){
  const s=raw&&typeof raw==='object'?raw:{};
  return {
    resolution:resolutions.has(s.resolution)?s.resolution:DEFAULT_SETTINGS.resolution,
    resumeRewindSeconds:rewind.has(Number(s.resumeRewindSeconds))?Number(s.resumeRewindSeconds):DEFAULT_SETTINGS.resumeRewindSeconds,
    autoNext:s.autoNext!==false,
    autoRecovery:s.autoRecovery!==false,
    bufferSeconds:buffer.has(Number(s.bufferSeconds))?Number(s.bufferSeconds):DEFAULT_SETTINGS.bufferSeconds,
    driveWatchOnly:s.driveWatchOnly!==false,
    recentLimit:recent.has(Number(s.recentLimit))?Number(s.recentLimit):DEFAULT_SETTINGS.recentLimit,
    pauseOverlay:s.pauseOverlay!==false
  };
}
export function getSettings(storage=store()){
  if(!storage)return {...DEFAULT_SETTINGS};
  try{return normalizeSettings(JSON.parse(storage.getItem(KEY)||'{}'));}catch{return {...DEFAULT_SETTINGS};}
}
export function saveSettings(next,storage=store()){
  const value=normalizeSettings(next);
  try{storage?.setItem(KEY,JSON.stringify(value));}catch{}
  return value;
}
export function updateSettings(patch,storage=store()){return saveSettings({...getSettings(storage),...(patch||{})},storage);}
export function resetSettings(storage=store()){try{storage?.removeItem(KEY);}catch{}return {...DEFAULT_SETTINGS};}

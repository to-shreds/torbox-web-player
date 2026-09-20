const SNAPSHOT_STORAGE_KEY='torbox-state-snapshots-v1';
const VERSION_STORAGE_KEY='torbox-state-version-v1';
export const SNAPSHOT_KEYS=Object.freeze([
  'torbox-settings-v1',
  'torbox-recent-v1',
  'torbox-watchlist-v1',
  'torbox-search-history-v1',
  'torbox-source-memory-v1',
  'torbox-parental-controls-v1',
  'tw-viewer'
]);
export const MAX_SNAPSHOTS=3;
let sequence=0;
const storage=()=>{try{return localStorage}catch{return null}};
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120):'';
function normalizedSnapshot(raw){
  if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!Number.isFinite(raw.createdAt)||!raw.state||typeof raw.state!=='object'||Array.isArray(raw.state))return null;
  const state={};
  for(const key of SNAPSHOT_KEYS){
    const value=raw.state[key];
    if(value===null||typeof value==='string')state[key]=value;
  }
  return {id:raw.id,createdAt:raw.createdAt,reason:clean(raw.reason)||'Automatic backup',version:clean(raw.version),state};
}
export function listStateSnapshots(store=storage()){
  if(!store)return[];
  try{
    const parsed=JSON.parse(store.getItem(SNAPSHOT_STORAGE_KEY)||'[]');
    if(!Array.isArray(parsed))return[];
    return parsed.map(normalizedSnapshot).filter(Boolean).sort((a,b)=>b.createdAt-a.createdAt).slice(0,MAX_SNAPSHOTS);
  }catch{return[];}
}
function currentState(store){
  const state={};
  for(const key of SNAPSHOT_KEYS){
    const value=store.getItem(key);
    state[key]=value===null?null:String(value);
  }
  return state;
}
function hasState(state){return Object.values(state).some(value=>value!==null);}
function persistSnapshots(rows,store){
  let lastError;
  for(let keep=Math.min(MAX_SNAPSHOTS,rows.length);keep>=1;keep--){
    try{store.setItem(SNAPSHOT_STORAGE_KEY,JSON.stringify(rows.slice(0,keep)));return true;}
    catch(error){lastError=error;}
  }
  if(lastError)throw lastError;
  return false;
}
export function captureStateSnapshot(reason='Manual backup',version='',store=storage(),now=Date.now()){
  if(!store)return null;
  const state=currentState(store);if(!hasState(state))return null;
  const snapshot={id:`${now}-${++sequence}`,createdAt:now,reason:clean(reason)||'Manual backup',version:clean(version),state};
  const rows=[snapshot,...listStateSnapshots(store).filter(row=>row.id!==snapshot.id)].slice(0,MAX_SNAPSHOTS);
  try{persistSnapshots(rows,store);return snapshot;}catch{return null;}
}
export function snapshotForVersion(version,store=storage(),now=Date.now()){
  if(!store||typeof version!=='string'||!version)return null;
  let previous='';try{previous=store.getItem(VERSION_STORAGE_KEY)||'';}catch{}
  if(previous===version)return null;
  const snapshot=captureStateSnapshot(previous?`Before update ${previous} → ${version}`:`Before first ${version} launch`,previous,store,now);
  try{store.setItem(VERSION_STORAGE_KEY,version);}catch{}
  return snapshot;
}
function applyExactState(state,store){
  const before=currentState(store);
  try{
    for(const key of SNAPSHOT_KEYS){
      const value=Object.prototype.hasOwnProperty.call(state,key)?state[key]:null;
      if(value===null)store.removeItem(key);else store.setItem(key,value);
    }
  }catch(error){
    try{for(const key of SNAPSHOT_KEYS){const value=before[key];if(value===null)store.removeItem(key);else store.setItem(key,value);}}catch{}
    throw error;
  }
}
export function restoreStateSnapshot(id,{store=storage(),version='',captureCurrent=true,now=Date.now()}={}){
  if(!store||typeof id!=='string')throw new Error('Choose a valid local backup.');
  const selected=listStateSnapshots(store).find(row=>row.id===id);
  if(!selected)throw new Error('That local backup is no longer available.');
  if(captureCurrent)captureStateSnapshot('Before restoring a previous backup',version,store,now);
  applyExactState(selected.state,store);
  try{if(version)store.setItem(VERSION_STORAGE_KEY,version);}catch{}
  return selected;
}
export function stateSnapshotStorageKeys(){return {snapshots:SNAPSHOT_STORAGE_KEY,version:VERSION_STORAGE_KEY};}

import { DEFAULT_SETTINGS, normalizeSettings, getSettings } from './settings.js?v=2.3.0';
import { listRecent } from './history.js?v=2.3.0';
import { listWatchlist } from './watchlist.js?v=2.3.0';

// Versioned, deliberately narrow format. No PINs, parental allowances, selected
// viewer, search history, source learning, provider URLs or relay configuration.
export const PORTABLE_KEYS = Object.freeze(['torbox-settings-v1','torbox-recent-v1','torbox-watchlist-v1']);
export const SETTING_NAMES = Object.freeze(['interfaceMode','resolution','resumeRewindSeconds','autoNext','autoNextDelaySeconds','autoRecovery','bufferSeconds','recentLimit','showCompletedRecent','cleanupCompletedEpisodes','pauseOverlay','playbackRate','sleepTimerMinutes','stillWatchingMinutes','keepAwake','keyboardShortcuts','seekSeconds','showEpisodeProgress','rememberBrowse','catalogType','catalogFeed','catalogGenre','sourceSizeProfile','showWatchlist','watchlistLimit','showNextUp','nextUpLimit','showSearchHistory','searchHistoryLimit','longPressShortcuts','showPlaybackHealth','autoLearnSources','viewer1Name','viewer2Name','rememberViewer','homeDensity','searchDelayMs','preferCachedSources']);
const MAX_BYTES=131072, MAX_TOKEN=65536, PREFIX='tw2.';
const encoder=new TextEncoder(), decoder=new TextDecoder('utf-8',{fatal:true});
const bad=()=>new Error('This is not a valid supported player setup.');
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const digits=v=>typeof v==='string'&&/^\d{5,12}$/.test(v);
function keyText(v){if(typeof v!=='string'||v.trim().length<8||v.trim().length>512||/[\u0000-\u001f\u007f]/.test(v))throw bad();return v.trim();}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unb64(s){if(!/^[A-Za-z0-9_-]+$/.test(s)||s.length>MAX_TOKEN)throw bad();let text;try{text=atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4));}catch{throw bad();}return Uint8Array.from(text,c=>c.charCodeAt(0));}
function join(...parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;}
async function digest(bytes){return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)).slice(0,16);}
async function bounded(stream){const reader=stream.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('The setup expands beyond the safe size limit.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}return join(...parts);}
async function compress(bytes){if(typeof CompressionStream==='undefined')return {flag:0,bytes};const packed=await bounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')));return packed.length<bytes.length?{flag:1,bytes:packed}:{flag:0,bytes};}
async function expand(bytes,flag){if(!flag)return bytes;if(typeof DecompressionStream==='undefined')throw new Error('This browser cannot decompress the setup. Use a current browser.');return bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')));}
async function passwordKey(password,salt){if(typeof password!=='string'||password.length<10||password.length>200)throw new Error('Use a transfer password of 10 to 200 characters.');const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:210000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}

export function collectPortableSetup(apiKey,store=localStorage){
  const settings=getSettings(store),pairs=[];
  SETTING_NAMES.forEach((name,i)=>{if(settings[name]!==DEFAULT_SETTINGS[name])pairs.push([i,settings[name]]);});
  const recent=listRecent(store).map(r=>[r.type==='series'?1:0,r.id.slice(2),r.season??0,r.episode??0,Math.floor(r.position),Math.floor(r.duration),r.completed?1:0,Math.floor(r.updatedAt)]);
  const lists=['viewer-1','viewer-2'].map(viewer=>listWatchlist(viewer,store).map(r=>[r.type==='series'?1:0,r.id.slice(2)]));
  return validatePortableSetup([1,'torbox',keyText(apiKey),pairs,recent,lists]);
}
export function validatePortableSetup(value){
  if(!Array.isArray(value)||value.length!==6||value[0]!==1||value[1]!=='torbox')throw bad();
  keyText(value[2]);const [,,,pairs,recent,lists]=value;
  if(!Array.isArray(pairs)||pairs.length>SETTING_NAMES.length||!Array.isArray(recent)||recent.length>20||!Array.isArray(lists)||lists.length!==2)throw bad();
  const seen=new Set();
  for(const row of pairs){if(!Array.isArray(row)||row.length!==2||!integer(row[0],SETTING_NAMES.length-1)||seen.has(row[0]))throw bad();seen.add(row[0]);const name=SETTING_NAMES[row[0]];if(normalizeSettings({[name]:row[1]})[name]!==row[1])throw bad();}
  const identities=new Set();
  for(const r of recent){if(!Array.isArray(r)||r.length!==8||![0,1].includes(r[0])||!digits(r[1])||!integer(r[2],999)||!integer(r[3],9999)||(!r[0]&&(r[2]||r[3]))||(r[0]&&r[3]<1)||!integer(r[4],8640000)||!integer(r[5],8640000)||(r[5]>0&&r[4]>r[5])||![0,1].includes(r[6])||!integer(r[7]))throw bad();const id=r.slice(0,4).join(':');if(identities.has(id))throw bad();identities.add(id);}
  for(const list of lists){if(!Array.isArray(list)||list.length>100)throw bad();const ids=new Set();for(const r of list){if(!Array.isArray(r)||r.length!==2||![0,1].includes(r[0])||!digits(r[1]))throw bad();const id=r.join(':');if(ids.has(id))throw bad();ids.add(id);}}
  // Clone so a caller cannot mutate a validated object while a confirmation is open.
  return JSON.parse(JSON.stringify(value));
}
export function portableSummary(value){const v=validatePortableSetup(value);return {provider:'TorBox',continueWatching:v[4].filter(r=>!r[6]).length,recent:v[4].length,myList:v[5].reduce((n,l)=>n+l.length,0),settings:v[3].length};}
export async function encodePortableSetup(value,{password=''}={}){
  const bytes=encoder.encode(JSON.stringify(validatePortableSetup(value)));if(bytes.length>MAX_BYTES)throw bad();
  const compressed=await compress(bytes),header=new Uint8Array([1,password?1:0,compressed.flag]);let envelope;
  if(password){const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await passwordKey(password,salt);const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:header},key,compressed.bytes));envelope=join(header,salt,iv,encrypted);}
  else {const payload=join(header,compressed.bytes);envelope=join(payload,await digest(payload));}
  const token=PREFIX+b64(envelope);if(token.length>MAX_TOKEN)throw new Error('This setup is too large to transfer.');return token;
}
export function isProtectedSetup(token){return inspectEnvelope(token)[1]===1;}
function inspectEnvelope(token){if(typeof token!=='string'||!token.startsWith(PREFIX)||token.length>MAX_TOKEN)throw bad();const e=unb64(token.slice(PREFIX.length));if(e.length<20||e[0]!==1||![0,1].includes(e[1])||![0,1].includes(e[2]))throw bad();return e;}
export async function decodePortableSetup(token,{password=''}={}){
  const envelope=inspectEnvelope(token),header=envelope.slice(0,3);let bytes;
  if(envelope[1]){if(envelope.length<48)throw bad();const key=await passwordKey(password,envelope.slice(3,19));try{bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:envelope.slice(19,31),additionalData:header},key,envelope.slice(31)));}catch{throw new Error('The transfer password is incorrect or the file is damaged.');}}
  else{const payload=envelope.slice(0,-16),expected=await digest(payload),actual=envelope.slice(-16);if(!expected.every((v,i)=>v===actual[i]))throw new Error('The setup is damaged. Scan it again or export a fresh file.');bytes=envelope.slice(3,-16);}
  bytes=await expand(bytes,envelope[2]);if(bytes.length>MAX_BYTES)throw bad();let value;try{value=JSON.parse(decoder.decode(bytes));}catch{throw bad();}return validatePortableSetup(value);
}
export function makeSetupUrl(token,base){inspectEnvelope(token);const url=new URL(base);url.search='';url.hash='setup='+token;return url.href;}
export function tokenFromText(text){
  const value=String(text||'').trim();if(value.length>MAX_TOKEN+2048)throw bad();if(value.startsWith(PREFIX)){inspectEnvelope(value);return value;}
  let url;try{url=new URL(value);}catch{throw bad();}const match=/^#setup=(tw2\.[A-Za-z0-9_-]+)$/.exec(url.hash);if(!match)throw bad();inspectEnvelope(match[1]);return match[1];
}
export function stagedPortableState(value,now=Date.now()){
  const v=validatePortableSetup(value),settings={...DEFAULT_SETTINGS};for(const [i,x] of v[3])settings[SETTING_NAMES[i]]=x;
  const recent=v[4].map(r=>{const type=r[0]?'series':'movie',id='tt'+r[1];return {key:r[0]?`series:${id}:${r[2]}:${r[3]}`:`movie:${id}`,type,id,season:r[0]?r[2]:null,episode:r[0]?r[3]:null,title:id,episodeName:'',poster:'',resolution:settings.resolution,position:r[4],duration:r[5],completed:!!r[6],updatedAt:r[7]||now,metadataPending:true};});
  const lists={};v[5].forEach((list,i)=>{lists['viewer-'+(i+1)]=list.map((r,j)=>({type:r[0]?'series':'movie',id:'tt'+r[1],name:'tt'+r[1],poster:'',year:'',addedAt:now-j,metadataPending:true}));});
  return {'torbox-settings-v1':JSON.stringify(settings),'torbox-recent-v1':JSON.stringify(recent),'torbox-watchlist-v1':JSON.stringify(lists)};
}
export function writePortableState(state,store=localStorage){
  if(!state||Object.keys(state).length!==PORTABLE_KEYS.length||PORTABLE_KEYS.some(k=>typeof state[k]!=='string'))throw bad();
  const before=Object.fromEntries(PORTABLE_KEYS.map(k=>[k,store.getItem(k)]));
  try{for(const k of PORTABLE_KEYS)store.setItem(k,state[k]);}
  catch(error){let restored=true;for(const k of PORTABLE_KEYS)try{before[k]===null?store.removeItem(k):store.setItem(k,before[k]);}catch{restored=false;}throw new Error(restored?'This browser could not save the setup. Its previous setup was restored.':'Browser storage failed, including restoration. Do not clear the source device.');}
  return before;
}
export function restorePortableState(before,store=localStorage){for(const k of PORTABLE_KEYS)before[k]===null?store.removeItem(k):store.setItem(k,before[k]);}

// Metadata is disposable and recovered after import. Merge only metadata into
// the latest storage value so watching/removing/adding during hydration survives.
export async function hydratePortableMetadata(fetchMeta,store=localStorage,onChange=()=>{}){
  const read=(k,fallback)=>{try{return JSON.parse(store.getItem(k)||JSON.stringify(fallback));}catch{return fallback;}};
  const rows=[...read(PORTABLE_KEYS[1],[]),...Object.values(read(PORTABLE_KEYS[2],{})).flat()];
  const pending=[...new Map(rows.filter(r=>r?.metadataPending).map(r=>[r.type+':'+r.id,r])).values()];let index=0;
  async function worker(){while(index<pending.length){const row=pending[index++];let meta;try{meta=await fetchMeta(row.type,row.id);}catch{continue;}if(!meta||meta.id!==row.id||typeof meta.name!=='string')continue;
    const recents=read(PORTABLE_KEYS[1],[]),lists=read(PORTABLE_KEYS[2],{});let changed=false;
    for(const r of recents){if(r.metadataPending&&r.type===row.type&&r.id===row.id){const ep=meta.episodes?.find(e=>e.season===r.season&&e.episode===r.episode);Object.assign(r,{title:meta.name,poster:meta.poster||'',episodeName:ep?.name||'',metadataPending:false});changed=true;}}
    for(const list of Object.values(lists))for(const r of list){if(r.metadataPending&&r.type===row.type&&r.id===row.id){Object.assign(r,{name:meta.name,poster:meta.poster||'',year:meta.year||'',metadataPending:false});changed=true;}}
    if(changed){store.setItem(PORTABLE_KEYS[1],JSON.stringify(recents));store.setItem(PORTABLE_KEYS[2],JSON.stringify(lists));onChange();}
  }}
  await Promise.all(Array.from({length:Math.min(4,pending.length)},worker));
}

export async function splitSetupFrames(token,chunkSize=360){
  inspectEnvelope(token);const id=b64(await digest(encoder.encode(token))),parts=token.match(new RegExp('.{1,'+chunkSize+'}','g'))||[];
  if(parts.length>96)throw new Error('Use a setup file for this large collection.');return parts.map((s,i)=>`TW2:${id}:${parts.length}:${i}:${s}`);
}
export class SetupFrameCollector{
  constructor(){this.reset();}
  reset(){this.id='';this.total=0;this.parts=new Map();}
  async accept(frame){
    if(typeof frame!=='string'||frame.length>650)throw bad();const m=/^TW2:([A-Za-z0-9_-]{22}):(\d{1,2}):(\d{1,2}):(tw2\.[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)$/.exec(frame);if(!m)throw bad();
    const [,id,totalText,indexText,part]=m,total=+totalText,index=+indexText;if(total<1||total>96||index>=total)throw bad();
    if(this.id&&(this.id!==id||this.total!==total))throw new Error('A different setup is on screen. Reset the scanner before switching devices.');
    this.id=id;this.total=total;if(this.parts.has(index)&&this.parts.get(index)!==part)throw bad();this.parts.set(index,part);
    const result={received:this.parts.size,total,token:''};if(this.parts.size===total){const token=Array.from({length:total},(_,i)=>this.parts.get(i)).join('');inspectEnvelope(token);if(b64(await digest(encoder.encode(token)))!==id)throw bad();result.token=token;}return result;
  }
}

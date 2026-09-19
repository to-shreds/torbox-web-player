export const TRANSFER_STORAGE_KEYS=Object.freeze([
  'torbox-settings-v1',
  'torbox-recent-v1',
  'torbox-watchlist-v1',
  'torbox-search-history-v1',
  'torbox-parental-controls-v1',
  'tw-viewer'
]);
export const TRANSFER_TTL_MS=10*60*1000;
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH=20;
const PBKDF2_ITERATIONS=150000;
const MAX_STATE_CHARS=120*1024;

function storage(){try{return localStorage}catch{return null}}
function normalizeJsonValue(key,value){
  if(typeof value!=='string'||value.length>65536)throw new Error('A saved setting is too large to transfer.');
  if(key==='tw-viewer'){if(!/^viewer-[12]$/.test(value))throw new Error('The saved viewer could not be transferred.');return value;}
  try{JSON.parse(value)}catch{throw new Error('Saved player data could not be read.');}
  return value;
}
function bytesToBase64Url(bytes){
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function base64UrlToBytes(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('The transfer package is damaged.');
  const padded=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4),binary=atob(padded),out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;
}
function randomCode(cryptoObj){
  if(!cryptoObj?.getRandomValues)throw new Error('Secure browser cryptography is not available on this device.');
  const bytes=cryptoObj.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes,value=>CODE_ALPHABET[value&31]).join('');
}
export function normalizeTransferCode(value){
  const code=String(value||'').toUpperCase().replace(/[\s-]/g,'');
  if(code.length!==CODE_LENGTH||![...code].every(ch=>CODE_ALPHABET.includes(ch)))throw new Error('That transfer code is not valid.');
  return code;
}
export function formatTransferCode(value){const code=normalizeTransferCode(value);return code.match(/.{1,4}/g).join('-');}
async function sha256(bytes,cryptoObj){return new Uint8Array(await cryptoObj.subtle.digest('SHA-256',bytes));}
async function deriveTransferKey(code,salt,cryptoObj){
  if(!cryptoObj?.subtle)throw new Error('Secure browser cryptography is not available on this device.');
  const material=await cryptoObj.subtle.importKey('raw',new TextEncoder().encode(normalizeTransferCode(code)),'PBKDF2',false,['deriveKey']);
  return cryptoObj.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:PBKDF2_ITERATIONS},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function transferLookup(value,cryptoObj=globalThis.crypto){
  const code=normalizeTransferCode(value);
  return Array.from(await sha256(new TextEncoder().encode(code),cryptoObj),b=>b.toString(16).padStart(2,'0')).join('');
}
export function readTransferState(store=storage()){
  const state={};let total=0;if(!store)return state;
  for(const key of TRANSFER_STORAGE_KEYS){const raw=store.getItem(key);if(raw===null)continue;const value=normalizeJsonValue(key,raw);total+=value.length;if(total>MAX_STATE_CHARS)throw new Error('This setup has too much local data to transfer at once.');state[key]=value;}
  return state;
}
export function applyTransferredState(state,store=storage()){
  if(!store)throw new Error('This browser cannot save the transferred setup.');
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('The transfer package does not contain valid setup data.');
  const allowed=new Set(TRANSFER_STORAGE_KEYS),staged=[];let total=0;
  for(const [key,raw] of Object.entries(state)){
    if(!allowed.has(key))throw new Error('The transfer package contains unsupported setup data.');
    const value=normalizeJsonValue(key,raw);total+=value.length;if(total>MAX_STATE_CHARS)throw new Error('The transfer package is too large.');staged.push([key,value]);
  }
  for(const [key,value] of staged)store.setItem(key,value);
  return staged.length;
}
export async function createEncryptedTransfer(apiKey,{store=storage(),cryptoObj=globalThis.crypto,now=Date.now}={}){
  const keyText=typeof apiKey==='string'?apiKey.trim():'';
  if(keyText.length<8||keyText.length>512||/[\u0000-\u001f\u007f]/.test(keyText))throw new Error('Enter a valid debrid API key.');
  if(!cryptoObj?.subtle||!cryptoObj?.getRandomValues)throw new Error('Secure browser cryptography is not available on this device.');
  const code=randomCode(cryptoObj),salt=cryptoObj.getRandomValues(new Uint8Array(16)),iv=cryptoObj.getRandomValues(new Uint8Array(12));
  const payload={version:1,createdAt:now(),apiKey:keyText,state:readTransferState(store)};
  const plain=new TextEncoder().encode(JSON.stringify(payload));
  if(plain.length>128*1024)throw new Error('This setup has too much data to transfer at once.');
  const key=await deriveTransferKey(code,salt,cryptoObj);
  const encrypted=new Uint8Array(await cryptoObj.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  return {
    code:formatTransferCode(code),
    lookup:await transferLookup(code,cryptoObj),
    envelope:{version:1,salt:bytesToBase64Url(salt),iv:bytesToBase64Url(iv),data:bytesToBase64Url(encrypted)}
  };
}
export async function decryptEncryptedTransfer(code,envelope,{cryptoObj=globalThis.crypto}={}){
  if(!envelope||envelope.version!==1)throw new Error('This transfer package is not supported.');
  const salt=base64UrlToBytes(envelope.salt),iv=base64UrlToBytes(envelope.iv),data=base64UrlToBytes(envelope.data);
  if(salt.length!==16||iv.length!==12||data.length<17||data.length>180000)throw new Error('The transfer package is damaged.');
  try{
    const key=await deriveTransferKey(code,salt,cryptoObj);
    const plain=await cryptoObj.subtle.decrypt({name:'AES-GCM',iv},key,data);
    const payload=JSON.parse(new TextDecoder().decode(plain));
    const apiKey=typeof payload?.apiKey==='string'?payload.apiKey.trim():'';
    if(payload?.version!==1||apiKey.length<8||apiKey.length>512||!payload.state||typeof payload.state!=='object')throw new Error();
    return {...payload,apiKey};
  }catch(error){if(error?.message&&error.message!=='The transfer package is damaged.')throw new Error('The transfer code did not unlock this setup.');throw error;}
}
export function transferCodeFromHash(hash=globalThis.location?.hash||''){
  const match=/^#setup-transfer=([^&]+)$/.exec(String(hash||''));if(!match)return '';
  try{return formatTransferCode(decodeURIComponent(match[1]))}catch{return ''}
}
export function buildTransferLink(code,href=globalThis.location?.href||'https://example.invalid/'){
  const url=new URL(href);url.hash='setup-transfer='+encodeURIComponent(formatTransferCode(code));return url.href;
}

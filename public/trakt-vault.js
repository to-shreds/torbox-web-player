// Trakt credentials are kept in a separate, device-bound encrypted IndexedDB vault.
// They are never transferred with TorBox setup, sent to Render, or stored in localStorage.
const DATABASE='torbox-trakt-credentials-v1';
const OBJECT='secrets';
const DEVICE_KEY='aes-key';
const slot=viewer=>'oauth-'+(viewer==='viewer-2'?'viewer-2':'viewer-1');

async function open() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DATABASE,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(OBJECT);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function read(name) {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const req=db.transaction(OBJECT,'readonly').objectStore(OBJECT).get(name);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  } finally {db.close();}
}
async function write(name,value) {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(OBJECT,'readwrite');
      tx.objectStore(OBJECT).put(value,name);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  } finally {db.close();}
}
export async function saveTraktCredentials(viewer,credentials) {
  if(!crypto?.subtle||!credentials?.access_token||!credentials?.refresh_token)throw new Error('Secure credential storage is unavailable.');
  let key=await read(DEVICE_KEY);
  if(!key){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await write(DEVICE_KEY,key);}
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plaintext=new TextEncoder().encode(JSON.stringify(credentials));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plaintext));
  await write(slot(viewer),{iv:Array.from(iv),bytes:Array.from(bytes)});
}
export async function loadTraktCredentials(viewer) {
  try{
    if(!crypto?.subtle)return null;
    const [key,record]=await Promise.all([read(DEVICE_KEY),read(slot(viewer))]);
    if(!key||!record?.iv||!record?.bytes)return null;
    const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},key,new Uint8Array(record.bytes));
    const value=JSON.parse(new TextDecoder().decode(plaintext));
    return value?.access_token&&value?.refresh_token?value:null;
  }catch{return null;}
}
export async function removeTraktCredentials(viewer) {
  const db=await open();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(OBJECT,'readwrite');
      tx.objectStore(OBJECT).delete(slot(viewer));
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }finally{db.close();}
}

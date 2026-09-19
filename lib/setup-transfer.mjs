const LOOKUP_PATTERN=/^[a-f0-9]{64}$/;
const BASE64URL_PATTERN=/^[A-Za-z0-9_-]+$/;
export const DEFAULT_SETUP_TRANSFER_TTL_MS=10*60*1000;

export function normalizeSetupTransferEnvelope(raw){
  if(!raw||typeof raw!=='object'||raw.version!==1) return null;
  const salt=typeof raw.salt==='string'?raw.salt:'',iv=typeof raw.iv==='string'?raw.iv:'',data=typeof raw.data==='string'?raw.data:'';
  if(!BASE64URL_PATTERN.test(salt)||!BASE64URL_PATTERN.test(iv)||!BASE64URL_PATTERN.test(data))return null;
  if(salt.length<20||salt.length>24||iv.length<14||iv.length>20||data.length<20||data.length>180000)return null;
  return {version:1,salt,iv,data};
}

export class SetupTransfers{
  constructor({now=Date.now,ttlMs=DEFAULT_SETUP_TRANSFER_TTL_MS,maxRows=100}={}){this.now=now;this.ttlMs=ttlMs;this.maxRows=maxRows;this.rows=new Map();}
  prune(){const time=this.now();for(const [id,row] of this.rows)if(row.expires<=time)this.rows.delete(id);}
  create(lookup,envelope){
    this.prune();if(!LOOKUP_PATTERN.test(lookup||'')||this.rows.size>=this.maxRows||this.rows.has(lookup))return null;
    const clean=normalizeSetupTransferEnvelope(envelope);if(!clean)return null;
    const row={envelope:clean,expires:this.now()+this.ttlMs};this.rows.set(lookup,row);return row;
  }
  take(lookup){
    this.prune();if(!LOOKUP_PATTERN.test(lookup||''))return null;
    const row=this.rows.get(lookup);if(!row)return null;this.rows.delete(lookup);return row;
  }
}

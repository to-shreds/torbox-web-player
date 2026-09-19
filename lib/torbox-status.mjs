import { AppError } from './torbox.mjs';
export const TORBOX_STATUS_URL='https://status.torbox.app/';

export function parseOfficialTorBoxStatus(html){
  const text=String(html||'').replace(/\s+/g,' ').toLowerCase();
  if(/all services are online|all systems operational/.test(text)) return 'operational';
  const head=text.slice(0,18000);
  if(/major outage|partial outage|degraded performance|service disruption|investigating/.test(head)) return 'issue';
  return 'unknown';
}
async function boundedText(response,max=1024*1024){
  const reader=response.body?.getReader();if(!reader)return '';
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('too_large');chunks.push(Buffer.from(value));}}
  finally{try{await reader.cancel();}catch{}}
  return Buffer.concat(chunks).toString('utf8');
}
export class TorBoxStatusChecker{
  constructor({fetchFn=fetch,now=Date.now}={}){this.fetchFn=fetchFn;this.now=now;this.cachedOfficial=null;}
  async official(){
    if(this.cachedOfficial&&this.cachedOfficial.until>this.now())return this.cachedOfficial.value;
    let value='unknown';
    try{
      const r=await this.fetchFn(TORBOX_STATUS_URL,{headers:{Accept:'text/html'},redirect:'follow',signal:AbortSignal.timeout(7000)});
      if(r.ok)value=parseOfficialTorBoxStatus(await boundedText(r));
      else try{await r.body?.cancel();}catch{}
    }catch{}
    this.cachedOfficial={value,until:this.now()+60000};return value;
  }
  async check(provider){
    if(!provider?.account)throw new AppError('TORBOX_NOT_CONFIGURED','TorBox is not connected.',503);
    const [official,accountResult]=await Promise.all([
      this.official(),
      provider.account().then(()=>({ok:true})).catch(error=>({ok:false,code:error?.code||'TORBOX_UNAVAILABLE'}))
    ]);
    const checkedAt=new Date(this.now()).toISOString();
    if(accountResult.ok){
      return {
        ok:true,
        official,
        checkedAt,
        statusUrl:TORBOX_STATUS_URL,
        message:official==='issue'?'TorBox reports a service issue, but this account can still reach the API. Playback may be unreliable.':''
      };
    }
    return {
      ok:false,
      official,
      checkedAt,
      statusUrl:TORBOX_STATUS_URL,
      code:accountResult.code,
      message:official==='issue'
        ? 'TorBox is reporting a service issue and this account cannot currently reach the API.'
        : 'TorBox cannot currently be reached with this account. Try again after service recovers.'
    };
  }
}

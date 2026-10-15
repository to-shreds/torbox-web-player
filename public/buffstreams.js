export const DEFAULT_BUFFSTREAMS_BASE='https://mybuffstreams.plus';
export const BUFFSTREAMS_HELPER='https://sports-desk-links.onrender.com';

const MAX_RESPONSE_BYTES=256*1024;
const SPORT_NAMES={nfl:'NFL',cfb:'College football',nhl:'Hockey',nba:'Basketball',mlb:'Baseball',soccer:'Soccer',football:'Soccer',mma:'MMA',ufc:'MMA',boxing:'Boxing',wwe:'Wrestling',cfl:'CFL',f1:'Formula 1',tennis:'Tennis',rugby:'Rugby',cricket:'Cricket'};
const forbiddenHost=/(?:^|\.)(?:localhost|local|localdomain|internal|test|lan|home|onion|arpa)$/i;
const outcomeWords=/\b(?:results?|recaps?|highlights?|defeats?|defeated|beats?|beaten|won|wins?|winners?|lost|loses?|loss|scores?|scored)\b|\bvictory\s+(?:over|against)\b/i;
const scoreNumbers=/\b\d{1,3}\s*[-:]\s*\d{1,3}\b|\b\d{1,3}\b[^\n]*\b(?:vs\.?|versus|v\.?)\b[^\n]*\b\d{1,3}\b/i;

function publicUrl(value,addScheme=false){
  if(typeof value!=='string')throw new Error('Enter a public HTTPS website address.');
  let input=value.trim();
  if(!input||input.length>2048||/[\x00-\x20\x7f\\?#]/.test(input))throw new Error('Use an HTTPS address without a query or fragment.');
  if(addScheme&&!input.includes('://'))input='https://'+input;
  let url;
  try{url=new URL(input);}catch{throw new Error('Enter a valid HTTPS website address.');}
  const authority=input.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i)?.[1]||'';
  const labels=url.hostname.split('.');
  if(url.protocol!=='https:'||url.port||url.username||url.password||authority.includes('@')||url.search||url.hash||url.hostname.length>253||forbiddenHost.test(url.hostname)||labels.length<2||labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))||!/[a-z]/i.test(labels.at(-1))||/^[0-9.]+$/.test(url.hostname)){
    throw new Error('Use a public HTTPS website without a login or custom port.');
  }
  return url;
}

export function buffstreamsBase(value){
  return publicUrl(value,true).origin;
}

function eventInfo(url){
  const numbered=url.pathname.match(/^\/([a-z0-9-]+)\/([a-z0-9-]+)\/([0-9]{1,20})\/?$/);
  const named=url.pathname.match(/^\/title-game\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  const slug=numbered?.[1]||named?.[1];
  const sport=slug&&(SPORT_NAMES[slug]||Object.entries(SPORT_NAMES).find(([key])=>slug.startsWith(key+'-'))?.[1]);
  if(!sport)return null;
  return {slug,sport,number:numbered?.[3]||null};
}

function boundedText(value,max,label){
  if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f<>]/.test(value))throw new Error('The source returned an invalid '+label+'.');
  return value.trim();
}

function hasOutcome(text){
  return outcomeWords.test(text)||scoreNumbers.test(text)||/\((?:final|ft)\)|\bfinal\s*(?:score\s*)?:/i.test(text);
}

function catalogTime(value){
  if(typeof value!=='string'||value.length>80)throw new Error('The source returned an invalid update time.');
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
  const time=Date.parse(value);
  if(!match||!Number.isFinite(time)||Number(match[1])<1970||Number(match[1])>2200||time>Date.now()+5*60*1000)throw new Error('The source returned an invalid update time.');
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  if(date.getUTCFullYear()!==Number(match[1])||date.getUTCMonth()+1!==Number(match[2])||date.getUTCDate()!==Number(match[3]))throw new Error('The source returned an invalid update time.');
  return value;
}

export function cleanBuffstreamsCatalog(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.events)||!raw.events.length||raw.events.length>300)throw new Error('The source did not return a recognizable event list.');
  const source=publicUrl(raw.source).href;
  const origin=new URL(source).origin;
  const fetchedAt=catalogTime(raw.fetchedAt);
  const ids=new Set(),urls=new Set(),events=[];
  for(const item of raw.events){
    if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('The source returned an incomplete event list.');
    const id=boundedText(item.id,100,'event ID');
    const title=boundedText(item.title,180,'event title');
    const sport=boundedText(item.sport,60,'sport');
    const event=publicUrl(item.eventUrl);
    const info=eventInfo(event);
    if(!id||!title||!sport||!info||event.origin!==origin||ids.has(id)||urls.has(event.href)||typeof item.live!=='boolean')throw new Error('The source returned an incomplete or duplicate event list.');
    const validId=info.number?id===info.slug+':'+info.number:new RegExp('^'+info.slug+':[a-f0-9]{16}$').test(id);
    if(sport!==info.sport||!validId)throw new Error('The source returned an invalid event identity.');
    let sourceTime=boundedText(item.sourceTime,50,'source time');
    ids.add(id);urls.add(event.href);
    if(hasOutcome(title))continue;
    if(outcomeWords.test(sourceTime)||/\b\d{1,3}\s*-\s*\d{1,3}\b|\bfinal\b|\(ft\)/i.test(sourceTime))sourceTime='';
    events.push({id,title,sport,eventUrl:event.href,live:item.live,sourceTime});
  }
  if(!events.length)throw new Error('The source did not return a spoiler-free event list.');
  return {source,fetchedAt,events};
}

export function buffstreamsPlayerUrl(raw,expectedEventUrl){
  const expected=publicUrl(expectedEventUrl);
  if(!eventInfo(expected)||!raw||typeof raw!=='object'||Array.isArray(raw)||raw.playback!=='source-page'||raw.eventUrl!==expectedEventUrl)throw new Error('The source returned an invalid player response.');
  const player=publicUrl(raw.playerUrl);
  if(player.hostname!=='gooz.aapmains.net'||!/^\/new-stream-embed\/[0-9]{1,20}\/?$/.test(player.pathname))throw new Error('The source did not return a recognized direct player.');
  return player.href;
}

async function readJson(response){
  const contentType=response.headers?.get('content-type')||'';
  if(!/^application\/json(?:\s*;|\s*$)/i.test(contentType))throw new Error('The connection did not return a JSON response.');
  const length=response.headers?.get('content-length');
  if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE_BYTES))throw new Error('The connection returned an oversized response.');
  let text='';
  if(response.body?.getReader){
    const reader=response.body.getReader();
    const decoder=new TextDecoder('utf-8',{fatal:true});
    let size=0;
    try{
      while(true){
        const chunk=await reader.read();
        if(chunk.done)break;
        size+=chunk.value.byteLength;
        if(size>MAX_RESPONSE_BYTES){await reader.cancel().catch(()=>{});throw new Error('The connection returned an oversized response.');}
        text+=decoder.decode(chunk.value,{stream:true});
      }
      text+=decoder.decode();
    }finally{reader.releaseLock();}
  }else{
    text=await response.text();
    if(new TextEncoder().encode(text).byteLength>MAX_RESPONSE_BYTES)throw new Error('The connection returned an oversized response.');
  }
  try{
    const data=JSON.parse(text);
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();
    return data;
  }catch{throw new Error('The connection returned an invalid JSON response.');}
}

export async function requestBuffstreams(action,payload,{signal,fetchFn=globalThis.fetch}={}){
  if(!['catalog','player'].includes(action)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('Invalid sports request.');
  const source=publicUrl(payload.source).href;
  const body={source};
  if(action==='player'){
    const event=publicUrl(payload.eventUrl);
    if(event.origin!==new URL(source).origin||!eventInfo(event))throw new Error('The event does not belong to the selected source.');
    body.eventUrl=event.href;
  }
  const response=await fetchFn(BUFFSTREAMS_HELPER+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,credentials:'omit',redirect:'error',cache:'no-store'});
  const data=await readJson(response);
  if(!response.ok){
    const detail=typeof data.error==='string'?data.error.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300):'';
    const error=new Error(detail||'The sports connection returned HTTP '+response.status+'.');
    error.status=response.status;
    throw error;
  }
  return data;
}

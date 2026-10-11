import {DEFAULT_BUFFSTREAMS_BASE,buffstreamsBase,cleanBuffstreamsCatalog,buffstreamsPlayerUrl,requestBuffstreams} from './buffstreams.js?v=release-1.2.2-buffstreams-desk.1';

const $=id=>document.getElementById(id);
const KEY='tw-buffstreams-state-v1';
const FRESH_MS=5*60*1000;
export function createBuffstreamsDesk({adult,stopLocalPlayback}){
  const state={source:DEFAULT_BUFFSTREAMS_BASE,catalog:null,search:'',sport:'all',liveOnly:false};
  let active=false,generation=0,pending=null,freshTimer=null;
  try{const base=localStorage.getItem('tw-buffstreams-base');if(base)state.source=buffstreamsBase(base);}catch{}
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved){
      const catalog=saved.catalog?cleanBuffstreamsCatalog(saved.catalog):null;
      if(catalog&&catalog.source===saved.source){state.source=catalog.source;state.catalog=catalog;}
      state.search=typeof saved.search==='string'?saved.search.slice(0,100):'';
      state.sport=typeof saved.sport==='string'?saved.sport.slice(0,60):'all';state.liveOnly=saved.liveOnly===true;
    }
  }catch{}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));localStorage.setItem('tw-buffstreams-base',buffstreamsBase(state.source));return true;}catch{return false;}}
  function message(text){$('buffstreams-message').textContent=text;}
  function age(){return state.catalog?Math.max(0,Date.now()-Date.parse(state.catalog.fetchedAt)):Infinity;}
  function hidePlayerLink(){const link=$('buffstreams-open-player');link.hidden=true;link.removeAttribute('href');}
  function permit(){if(adult())return true;message('Switch to an adult viewer to use Buffstreams.');return false;}
  function finish(request){
    clearTimeout(request.timer);
    if(pending===request){pending=null;$('buffstreams-cancel').hidden=true;for(const id of ['buffstreams-save','buffstreams-reset','buffstreams-refresh'])$(id).disabled=false;}
    if(request.button){request.button.disabled=false;request.button.textContent='Watch ↗';}
  }
  function cancel(quiet=false){
    generation++;if(pending){const old=pending;old.controller.abort();try{old.popup?.close();}catch{}finish(old);if(!quiet)message('Cancelled. Your previous source and game list are unchanged.');}hidePlayerLink();
  }
  function begin(button=null){
    cancel(true);const request={ticket:generation,controller:new AbortController(),button,popup:null,timer:null};pending=request;
    request.timer=setTimeout(()=>request.controller.abort('timeout'),80000);
    $('buffstreams-cancel').hidden=false;for(const id of ['buffstreams-save','buffstreams-reset','buffstreams-refresh'])$(id).disabled=true;
    return request;
  }
  function current(request){return active&&pending===request&&request.ticket===generation&&!request.controller.signal.aborted;}
  function failed(error,request){
    if(request.ticket!==generation||!active)return;
    if(request.controller.signal.aborted&&request.controller.signal.reason!=='timeout')return;
    const reason=request.controller.signal.reason==='timeout'?'The connection took too long. The free service may be waking up; try again.':error.message||'Could not reach the game list.';
    message(reason+' Your previous source and game list are unchanged.');
  }
  function render(){
    const events=state.catalog?.events||[],fresh=age()<FRESH_MS;
    const sports=[...new Set(events.map(event=>event.sport))].sort((a,b)=>a.localeCompare(b));
    $('buffstreams-sport').replaceChildren(...[['all','All sports'],...sports.map(s=>[s,s])].map(([value,title])=>{const option=document.createElement('option');option.value=value;option.textContent=title;return option;}));
    if(!sports.includes(state.sport))state.sport='all';$('buffstreams-sport').value=state.sport;
    $('buffstreams-search').value=state.search;$('buffstreams-live-only').checked=state.liveOnly;
    $('buffstreams-updated').textContent=state.catalog?(fresh?'Updated ':'Saved list from ')+new Date(state.catalog.fetchedAt).toLocaleString()+(fresh?'':' · Refresh for current games'):'No games loaded yet';
    const q=state.search.trim().toLocaleLowerCase();
    const shown=events.filter(event=>(state.sport==='all'||event.sport===state.sport)&&(!state.liveOnly||(fresh&&event.live))&&(event.title+' '+event.sport).toLocaleLowerCase().includes(q));
    $('buffstreams-count').textContent=state.catalog?shown.length+' '+(shown.length===1?'game':'games')+(fresh?'':' · saved list'):'';
    $('buffstreams-events').replaceChildren(...shown.map(event=>{
      const card=document.createElement('article');card.className='buffstreams-game';card.dataset.buffstreamsId=event.id;
      const sport=document.createElement('span');sport.className='sports-badge';sport.textContent=event.sport;
      const title=document.createElement('strong');title.textContent=event.title;
      const time=document.createElement('span');time.className='muted';time.textContent=event.live?(fresh?'Live on source':'Listed live when saved'):(event.sourceTime?event.sourceTime+' · source time':'Listed on source');
      const watch=document.createElement('button');watch.type='button';watch.dataset.buffstreamsWatch=event.id;watch.textContent='Watch ↗';watch.addEventListener('click',()=>void watchEvent(event,watch));
      card.append(sport,title,time,watch);return card;
    }));
    if(!shown.length){const empty=document.createElement('p');empty.className='muted';empty.textContent=state.catalog?(state.liveOnly&&!fresh?'Refresh to check which games are live now.':'No matching games. Try another search or sport.'):'Loading games…';$('buffstreams-events').append(empty);}
  }
  async function load(source=state.source){
    if(!permit())return;
    const request=begin();message('Loading games. The free connection may take a minute to wake up…');
    try{
      const candidate=cleanBuffstreamsCatalog(await requestBuffstreams('catalog',{source},{signal:request.controller.signal}));
      if(!current(request))return;if(!permit())return;
      state.source=candidate.source;state.catalog=candidate;$('buffstreams-address').value=buffstreamsBase(state.source);
      const saved=persist();render();message(saved?'Game list updated.':'Game list updated for this visit. This browser could not save it.');
    }catch(error){failed(error,request);}finally{finish(request);}
  }
  async function watchEvent(event,button){
    if(!permit())return;
    const request=begin(button);button.disabled=true;button.textContent='Opening…';stopLocalPlayback();
    try{
      request.popup=window.open('./buffstreams-opening.html?v=release-1.2.2-buffstreams-desk.1','_blank');
      if(request.popup)request.popup.opener=null;
    }catch{try{request.popup?.close();}catch{}request.popup=null;}
    message('Finding the selected game player…');
    try{
      const result=await requestBuffstreams('player',{source:state.source,eventUrl:event.eventUrl},{signal:request.controller.signal});
      if(!current(request))return;if(!permit()){try{request.popup?.close();}catch{}return;}
      const url=buffstreamsPlayerUrl(result,event.eventUrl);
      if(request.popup&&!request.popup.closed){request.popup.location.replace(url);request.popup=null;message('The selected game opened in a new tab.');}
      else{const link=$('buffstreams-open-player');link.href=url;link.hidden=false;message('Player ready. Select Open game player to open it in a new tab.');}
    }catch(error){try{request.popup?.close();}catch{}request.popup=null;failed(error,request);}finally{finish(request);}
  }
  function save(reset=false){if(!permit())return;try{void load(reset?DEFAULT_BUFFSTREAMS_BASE:buffstreamsBase($('buffstreams-address').value));}catch(error){message(error.message+' Your previous source and game list are unchanged.');}}
  $('buffstreams-search').addEventListener('input',()=>{state.search=$('buffstreams-search').value.slice(0,100);persist();render();});
  $('buffstreams-sport').addEventListener('change',()=>{state.sport=$('buffstreams-sport').value;persist();render();});
  $('buffstreams-live-only').addEventListener('change',()=>{state.liveOnly=$('buffstreams-live-only').checked;persist();render();});
  $('buffstreams-refresh').addEventListener('click',()=>void load());$('buffstreams-save').addEventListener('click',()=>save());$('buffstreams-reset').addEventListener('click',()=>save(true));
  $('buffstreams-address').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save();}});
  $('buffstreams-cancel').addEventListener('click',()=>cancel());
  $('buffstreams-open-player').addEventListener('click',event=>{if(!permit()){event.preventDefault();hidePlayerLink();}else stopLocalPlayback();});
  $('buffstreams-address').value=buffstreamsBase(state.source);render();
  window.addEventListener('pagehide',()=>cancel(true));
  return {
    enter(){if(active||!permit())return;active=true;freshTimer=setInterval(render,30000);if(!state.catalog||age()>=FRESH_MS)void load();},
    leave(){active=false;clearInterval(freshTimer);freshTimer=null;cancel(true);},
    refresh(){void load();},
  };
}

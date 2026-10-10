import {cleanSportsCatalog, resolveSportsSource, sportsMediaUrl, replayResume} from './sports-core.js?v=release-1.2.0-sports.1';
import {getKidProfile} from './parental-controls.js?v=release-1.2.0-sports.1';

const $=id=>document.getElementById(id);
let catalog=null, loadPromise=null, selection=null, hls=null, abort=null, generation=0, deadline=null, bufferDeadline=null;
let bookmarkTimer=null, sourceIndex=0, mode='live', sport='all', quality=720, ready=false;
const video=$('sports-video');
function status(message){$('sports-player-message').textContent=message;}
function adult(){
  let viewer='viewer-1';try{viewer=localStorage.getItem('tw-viewer')||sessionStorage.getItem('tw-viewer')||viewer;}catch{}
  return !getKidProfile(viewer).enabled;
}
function saveBookmark(){
  if(selection?.kind!=='replay'||!ready||!Number.isFinite(video.duration))return;
  try{localStorage.setItem('tw-sports-resume:'+selection.id,JSON.stringify({position:video.currentTime,duration:video.duration}));}catch{}
}
function bookmark(item){try{return JSON.parse(localStorage.getItem('tw-sports-resume:'+item.id)||'null');}catch{return null;}}
function clearPlayer(){
  generation++;abort?.abort();abort=null;clearTimeout(deadline);clearTimeout(bufferDeadline);clearInterval(bookmarkTimer);
  hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();ready=false;
}
export function stopSports(){saveBookmark();clearPlayer();selection=null;if($('sports-player').open)$('sports-player').close();}
function sourceButtons(){
  $('sports-sources').replaceChildren(...selection.sources.map((source,index)=>{
    const b=document.createElement('button');b.type='button';b.textContent=source.label;b.setAttribute('aria-pressed',String(index===sourceIndex));b.addEventListener('click',()=>void play(selection,index));return b;
  }));
}
function failed(current,message){
  if(current!==generation)return;
  clearTimeout(deadline);clearTimeout(bufferDeadline);hls?.destroy();hls=null;video.pause();status(message+' Choose Retry or another channel.');$('sports-retry').hidden=false;
}
function setQuality(){
  if(!hls)return;
  const candidates=hls.levels.map((level,index)=>({height:level.height,index})).filter(x=>x.height>0&&x.height<=quality);
  hls.autoLevelCapping=quality===0?-1:(candidates.at(-1)?.index??0);
}
async function play(item,index=0,{startOver=false}={}){
  if(!adult()){stopSports();$('sports-message').textContent='Switch to an adult viewer to open Sports.';return;}
  saveBookmark();clearPlayer();selection=item;sourceIndex=index;const current=generation;abort=new AbortController();
  window.dispatchEvent(new CustomEvent('sports-playback-start'));
  $('sports-playing-title').textContent=item.title;$('sports-live-edge').hidden=item.kind!=='live';$('sports-start-over').hidden=item.kind!=='replay';$('sports-retry').hidden=true;
  sourceButtons();if(!$('sports-player').open)$('sports-player').showModal();status(item.kind==='live'?'Opening live channel…':'Opening replay…');
  deadline=setTimeout(()=>failed(current,'The source did not start.'),25000);
  try{
    const url=await resolveSportsSource(item.sources[index],{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)])});
    if(current!==generation)return;
    const resume=startOver?0:replayResume(bookmark(item)?.position,bookmark(item)?.duration);
    video.onloadedmetadata=()=>{if(current===generation&&item.kind==='replay'&&resume>0&&resume<video.duration-30)video.currentTime=resume;};
    video.onplaying=()=>{if(current!==generation)return;ready=true;clearTimeout(deadline);clearTimeout(bufferDeadline);$('sports-retry').hidden=true;status(item.kind==='live'?'Live · '+item.sources[index].label:'Replay · '+item.sources[index].label);};
    video.onerror=()=>failed(current,'This source could not play.');
    video.onwaiting=()=>{if(current!==generation||!ready||video.paused)return;clearTimeout(bufferDeadline);status('Buffering…');bufferDeadline=setTimeout(()=>failed(current,'The stream stopped responding.'),20000);};
    video.onpause=()=>{clearTimeout(bufferDeadline);saveBookmark();};
    video.onended=()=>{saveBookmark();clearTimeout(bufferDeadline);status('Replay finished.');};
    // hls.js requests, including playlists and segments, stay on public sports hosts.
    if(globalThis.Hls?.isSupported()){
      hls=new globalThis.Hls({enableWorker:false,maxBufferLength:30,capLevelToPlayerSize:true,manifestLoadingTimeOut:12000,fragLoadingTimeOut:15000,xhrSetup(xhr,url){sportsMediaUrl(url);xhr.withCredentials=false;}});
      hls.on(globalThis.Hls.Events.MANIFEST_PARSED,()=>{if(current!==generation)return;setQuality();video.play().catch(()=>{clearTimeout(deadline);status('Press Play to start.');});});
      hls.on(globalThis.Hls.Events.ERROR,(_,data)=>{if(data.fatal)failed(current,'The channel is unavailable or blocked in this location.');});
      hls.loadSource(url);hls.attachMedia(video);
    }else if(video.canPlayType('application/vnd.apple.mpegurl')){
      video.src=url;video.play().catch(()=>{clearTimeout(deadline);status('Press Play to start.');});
    }else throw new Error('This browser cannot play HLS. Try Chrome or Safari.');
    bookmarkTimer=setInterval(saveBookmark,5000);
  }catch(error){if(current===generation&&!abort?.signal.aborted)failed(current,error.message||'The source is unavailable.');}
}
function render(){
  const q=$('sports-search').value.trim().toLowerCase();
  const items=(catalog?.items||[]).filter(item=>item.kind===mode&&(sport==='all'||item.sport===sport)&&(item.title+' '+item.sport).toLowerCase().includes(q));
  $('sports-grid').replaceChildren(...items.map(item=>{
    const card=document.createElement('button');card.type='button';card.className='sports-card';card.dataset.sportsId=item.id;
    const badge=document.createElement('span');badge.className='sports-badge';badge.textContent=item.kind==='live'?'LIVE CHANNEL':'FULL REPLAY';
    const title=document.createElement('strong');title.textContent=item.title;
    const sub=document.createElement('span');sub.className='muted';sub.textContent=[item.sport==='mixed'?'Various sports':item.sport.charAt(0).toUpperCase()+item.sport.slice(1),item.date,item.kind==='replay'&&bookmark(item)?.position>=10?'Resume available':''].filter(Boolean).join(' · ');
    card.append(badge,title,sub);card.addEventListener('click',()=>void play(item));return card;
  }));
  $('sports-message').textContent=items.length?'':(catalog?'No '+(mode==='replay'?'replays':'channels')+' in this selection. Try All sports or the other tab.':'Loading sports…');
  for(const b of document.querySelectorAll('[data-sports-mode]'))b.setAttribute('aria-pressed',String(b.dataset.sportsMode===mode));
}
async function load(){
  if(catalog)return render();if(loadPromise)return loadPromise;
  loadPromise=(async()=>{try{
    const response=await fetch('./sports-catalog.json?v=release-1.2.0-sports.1',{credentials:'omit',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error();catalog=cleanSportsCatalog(await response.json());render();
  }catch{$('sports-message').textContent='Sports could not load. Press Refresh to try again.';}finally{loadPromise=null;}})();
  return loadPromise;
}
function openSports(){
  if(!adult()){$('sports-nav-message').textContent='Switch to an adult viewer to open Sports.';return;}
  $('sports-nav-message').textContent='';document.body.classList.add('sports-active');$('sports-panel').hidden=false;$('open-sports').setAttribute('aria-pressed','true');$('open-cinema').setAttribute('aria-pressed','false');void load();
}
$('open-sports').addEventListener('click',openSports);
$('open-cinema').addEventListener('click',()=>{stopSports();document.body.classList.remove('sports-active');$('sports-panel').hidden=true;$('open-sports').setAttribute('aria-pressed','false');$('open-cinema').setAttribute('aria-pressed','true');});
$('sports-refresh').addEventListener('click',()=>{catalog=null;void load();});
$('sports-search').addEventListener('input',render);$('sports-sport').addEventListener('change',()=>{sport=$('sports-sport').value;render();});
for(const b of document.querySelectorAll('[data-sports-mode]'))b.addEventListener('click',()=>{mode=b.dataset.sportsMode;render();});
$('close-sports-player').addEventListener('click',stopSports);$('sports-player').addEventListener('cancel',e=>{e.preventDefault();stopSports();});
$('sports-retry').addEventListener('click',()=>selection&&void play(selection,sourceIndex));
$('sports-start-over').addEventListener('click',()=>selection&&void play(selection,sourceIndex,{startOver:true}));
$('sports-live-edge').addEventListener('click',()=>{if(hls?.liveSyncPosition)video.currentTime=hls.liveSyncPosition;else if(video.seekable.length)video.currentTime=video.seekable.end(video.seekable.length-1)-2;void video.play().catch(()=>{});});
$('sports-quality').addEventListener('change',()=>{quality=Number($('sports-quality').value);setQuality();});
$('sports-fullscreen').addEventListener('click',()=>{void(video.requestFullscreen?.()||video.webkitEnterFullscreen?.());});
window.addEventListener('cinema-playback-start',stopSports);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&selection){saveBookmark();video.pause();clearTimeout(bufferDeadline);clearTimeout(deadline);}});
window.addEventListener('pagehide',stopSports);
if(location.hash==='#sports')openSports();

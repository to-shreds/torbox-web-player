import { loadPublicSources } from './source-client.js';
const $ = id => document.getElementById(id);
const GB = 1024 ** 3;
const element = (tag, text = '', className = '') => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
const button = (label, fn, primary = false) => { const b = element('button', label, primary ? 'primary' : ''); b.type = 'button'; b.addEventListener('click', fn); return b; };
const image = (url, label, className) => { const i = element('img', '', className); i.alt = label; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; i.src = url; i.addEventListener('error', () => { i.hidden = true; }); return i; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const resolutionOf = s => String(s?.resolution || s?.quality || '').toLowerCase();
export function sourceMatchesResolution(source, resolution = 'auto') {
  if (!resolution || resolution === 'auto') return true;
  const value = resolutionOf(source);
  if (resolution === '2160p') return value.includes('2160') || value.includes('4k');
  return value.includes(resolution.replace('p', ''));
}
export const filterSourcesByResolution = (list, resolution = 'auto') => list.filter(s => sourceMatchesResolution(s, resolution));
export function recommendSource(list, type = 'movie', resolution = 'auto') {
  const visible = filterSourcesByResolution(list, resolution); if (!visible.length) return null;
  const cachedFriendly = visible.filter(s => s.cached === true && s.browserFriendly && !s.audioRisk && !s.videoRisk);
  const cachedSafe = visible.filter(s => s.cached === true && !s.audioRisk && !s.videoRisk);
  const browserSafe = visible.filter(s => s.browserFriendly && !s.audioRisk);
  const cached = visible.filter(s => s.cached === true && !s.audioRisk);
  const pool = cachedFriendly.length ? cachedFriendly : cachedSafe.length ? cachedSafe : browserSafe.length ? browserSafe : cached.length ? cached : visible;
  const limit = type === 'series' ? 1 * GB : 3 * GB;
  const rank = s => {
    const r = resolutionOf(s), sizeScore = s.size == null ? 15 : s.size <= limit ? 110 : -Math.min(140, (s.size / limit - 1) * 90);
    const seedScore = Number.isSafeInteger(s.seeders) ? Math.min(35, Math.log2(s.seeders + 1) * 5) : 0;
    return (s.score || 0) + (s.cached === true ? 260 : 0) + (s.browserFriendly ? 100 : 0) - (s.audioRisk ? 180 : 0) - (s.videoRisk ? 100 : 0)
      + (r.includes('720') ? 135 : r.includes('1080') ? 55 : 0) + sizeScore + seedScore;
  };
  return [...pool].sort((a,b)=>rank(b)-rank(a)||(a.size??Infinity)-(b.size??Infinity))[0];
}
export const preferredSource = list => recommendSource(list, 'movie', 'auto');
export function episodeQueue(meta, target, now = Date.now()) {
  if (!meta || target?.type !== 'series' || !Array.isArray(meta.episodes)) return [];
  const released = meta.episodes.filter(e => !e.released || Date.parse(e.released) <= now).sort((a,b)=>a.season-b.season||a.episode-b.episode);
  const index = released.findIndex(e => e.season === target.season && e.episode === target.episode);
  if (index < 0) return [];
  return released.slice(index + 1).map(e => ({ type:'series', id:meta.id, season:e.season, episode:e.episode, name:e.name || `Episode ${e.episode}` }));
}
export function lowerResolutionOrder(current, selected = 'auto') {
  const value = String(current || selected || '').toLowerCase();
  const tier = value.includes('2160') || value.includes('4k') ? '2160p' : value.includes('1080') ? '1080p' : value.includes('720') ? '720p' : value.includes('480') ? '480p' : selected !== 'auto' ? selected : '720p';
  const order = ['2160p','1080p','720p','480p']; const index = order.indexOf(tier);
  return index >= 0 ? order.slice(index + 1) : ['720p','480p'];
}
const formatBytes = value => Number.isFinite(value) && value > 0 ? (value >= GB ? `${(value / GB).toFixed(value >= 10*GB ? 1 : 2)} GB` : `${Math.max(1,Math.round(value/1024**2))} MB`) : '—';
const qualityText = s => [s.resolution || s.quality, s.releaseQuality, s.videoCodec, ...(s.audioCodecs || []).slice(0,2), s.container].filter(Boolean).join(' · ') || 'Unknown';
const feedNames = { popular:'Popular', featured:'Featured', new:'New' };
const getResolution = () => { try { return sessionStorage.getItem('tw-source-resolution') || 'auto'; } catch { return 'auto'; } };
const setResolution = value => { try { sessionStorage.setItem('tw-source-resolution', value); } catch {} };
function createResolutionSelect(value = getResolution()) {
  const select = element('select');
  for (const [v,t] of [['auto','Auto · 720p'],['480p','480p'],['720p','720p'],['1080p','1080p'],['2160p','4K']]) { const o=element('option',t);o.value=v;select.append(o); }
  select.value = value; select.addEventListener('change',()=>setResolution(select.value)); return select;
}

export function createDiscoveryUI({ api, play, loadLibrary }) {
  let view='discover', active=false, catalogGeneration=0, titleGeneration=0, sourceGeneration=0, preparationGeneration=0;
  let catalogAbort,titleAbort,sourceAbort,searchTimer,pollTimer,metas=[],nextSkip=null,currentMeta;

  function cancelSource(){++preparationGeneration;++sourceGeneration;sourceAbort?.abort();clearTimeout(pollTimer);}
  function cancelTitle(){++titleGeneration;titleAbort?.abort();cancelSource();}
  function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function displayTab(next){
    view=next;$('discover-panel').hidden=next!=='discover';$('library-panel').hidden=next!=='library';
    $('discover-tab').setAttribute('aria-selected',String(next==='discover'));$('library-tab').setAttribute('aria-selected',String(next==='library'));
    $('page-title').textContent=next==='discover'?'Discover':'My files';$('search').placeholder=next==='discover'?'Search movies and shows':'Search TorBox files';
    $('recent-section').hidden = next !== 'discover';
  }
  async function openLibrary(){displayTab('library');++catalogGeneration;catalogAbort?.abort();await loadLibrary();}
  async function openDiscover(){displayTab('discover');await browse();}

  async function browse(more=false){
    if(!active||view!=='discover')return;const offset=more?nextSkip:0;if(offset===null)return;
    const generation=++catalogGeneration;catalogAbort?.abort();catalogAbort=new AbortController();$('catalog-more').disabled=true;$('catalog-retry').hidden=true;
    if(!more){metas=[];nextSkip=null;$('catalog-grid').replaceChildren();$('catalog-more').hidden=true;}
    const query=$('search').value.trim();message('catalog-message',query?'Searching…':'Loading browse…');
    try{
      const params=new URLSearchParams({type:$('catalog-type').value,q:query,skip:String(offset),genre:$('catalog-genre').value,feed:$('catalog-feed').value});
      const data=await api('/api/discover/catalog?'+params,{signal:AbortSignal.any([catalogAbort.signal,AbortSignal.timeout(20000)])});
      if(generation!==catalogGeneration||!active||view!=='discover')return;
      metas=more?[...new Map([...metas,...data.metas].map(m=>[m.id,m])).values()]:data.metas;nextSkip=data.nextSkip;
      const fragment=document.createDocumentFragment();
      for(const meta of metas){
        const card=button('',()=>showTitle(meta));card.className='poster-card';card.setAttribute('aria-label',`Open ${meta.name}`);
        const art=element('div','','poster-art');if(meta.poster)art.append(image(meta.poster,'','poster-image'));art.append(element('span',meta.name,'poster-fallback'));
        card.append(art,element('strong',meta.name),element('span',meta.year||(meta.type==='series'?'Show':'Movie'),'muted'));fragment.append(card);
      }
      $('catalog-grid').replaceChildren(fragment);$('catalog-more').hidden=nextSkip===null;
      if(query)message('catalog-message',metas.length?`${metas.length} results`:'No matches. Try a shorter title or IMDb ID.');
      else {const shown=feedNames[data.feed]||'Browse';message('catalog-message',data.fallback?`${feedNames[data.requestedFeed]||'Browse'} unavailable · showing ${shown}`:metas.length?shown:'No titles in this browse view.');}
    }catch(e){
      if(generation===catalogGeneration&&active&&view==='discover'){message('catalog-message',query?(e.name==='TimeoutError'?'Search timed out.':e.message):'Browse is temporarily unavailable. Search still works.',true);$('catalog-retry').hidden=false;}
    }finally{if(generation===catalogGeneration)$('catalog-more').disabled=false;}
  }

  function buildContext(meta,target,episodeName,resolution,source){
    return {title:meta?.name||'',poster:meta?.poster||'',episodeName:episodeName||'',resolution,current:{...target,name:episodeName||''},sourceResolution:source?.resolution||source?.quality||'',queue:target.type==='series'?episodeQueue(meta,target):[]};
  }

  async function registeredSources(target, signal){
    const sources=await loadPublicSources(target,{signal});if(!sources.length)throw new Error('No source found.');
    const result=await api('/api/discover/sources',{method:'POST',data:{target,sources},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
    if(!result.sources?.length)throw new Error('No supported source found.');return result;
  }

  async function readyFile(source, { signal, unattended=false } = {}){
    let result=await api('/api/discover/prepare',{method:'POST',data:{source:source.id,onlyCached:source.cached===true},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
    const deadline=Date.now()+300000;
    while(Date.now()<deadline){
      if(result.state==='ready')return result;
      if(result.state==='choose_file'){
        if(!result.files?.length)throw new Error('No matching video file was found.');
        if(unattended&&result.files.length!==1)throw new Error('This package has multiple possible files and cannot be selected automatically.');
        result=await api('/api/discover/status?'+new URLSearchParams({source:source.id,file:result.files[0].id}),{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});continue;
      }
      if(result.state!=='preparing')throw new Error(result.message||'This source is unavailable.');
      await delay(3500);result=await api('/api/discover/status?'+new URLSearchParams({source:source.id}),{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
    }
    throw new Error('TorBox is still preparing this source. Try again shortly.');
  }

  async function quickPlay(meta,target,episodeName='',trigger){
    const original=trigger?.textContent;if(trigger){trigger.disabled=true;trigger.textContent='Opening…';}
    message('detail-message','Finding the recommended source…');
    try{
      const resolution=getResolution(),registered=await registeredSources(target,AbortSignal.timeout(45000));
      const best=recommendSource(registered.sources,target.type,resolution)||recommendSource(registered.sources,target.type,'auto');
      if(!best)throw new Error('No source matches this resolution.');
      message('detail-message',best.cached?'Opening cached source…':'Preparing recommended source…');
      const result=await readyFile(best,{signal:AbortSignal.timeout(330000),unattended:true});
      const context=buildContext(meta,target,episodeName,resolution,best);
      if($('source-dialog').open)$('source-dialog').close();if($('title-dialog').open)$('title-dialog').close();
      await play(result.file,context);return true;
    }catch(e){message('detail-message',e.message,true);return false;}
    finally{if(trigger&&trigger.isConnected){trigger.disabled=false;trigger.textContent=original;}}
  }

  function titleResolutionControl(){
    const label=element('label','Quality','compact-select');const select=createResolutionSelect();label.append(select);return label;
  }

  async function showTitle(meta){
    cancelTitle();currentMeta=null;const generation=titleGeneration;titleAbort=new AbortController();$('title-content').replaceChildren();$('episode-area').replaceChildren();
    $('detail-title').textContent=meta.name;message('detail-message','Loading…');if(!$('title-dialog').open)$('title-dialog').showModal();
    try{
      const data=await api(`/api/discover/meta?type=${meta.type}&id=${meta.id}`,{signal:AbortSignal.any([titleAbort.signal,AbortSignal.timeout(20000)])});
      if(generation!==titleGeneration||!$('title-dialog').open||!active)return;currentMeta=data.meta;
      const summary=element('div','','title-summary');if(currentMeta.poster)summary.append(image(currentMeta.poster,currentMeta.name,'detail-poster'));
      const copy=element('div','','title-copy');copy.append(element('p',[currentMeta.year,currentMeta.runtime,...currentMeta.genres].filter(Boolean).join(' · '),'muted'),element('p',currentMeta.description||'','title-description'));summary.append(copy);
      $('title-content').replaceChildren(summary);message('detail-message','');
      if(currentMeta.type==='movie')renderMovieActions(currentMeta);else renderEpisodes(currentMeta);
    }catch(e){if(generation===titleGeneration&&active)message('detail-message',e.name==='AbortError'?'Cancelled.':e.message,true);}
  }

  function renderMovieActions(meta){
    const bar=element('div','','movie-action-bar');bar.append(titleResolutionControl());
    const actions=element('div','','row-actions');const playButton=button('Play',()=>quickPlay(meta,{type:'movie',id:meta.id},'',playButton),true);
    actions.append(playButton,button('More options',()=>openOptions(meta,{type:'movie',id:meta.id})));bar.append(actions);$('episode-area').replaceChildren(bar);
  }

  function renderEpisodes(meta){
    const controls=element('div','','episode-controls');const seasonLabel=element('label','Season','compact-select');const seasonSelect=element('select');
    const seasons=[...new Set(meta.episodes.map(e=>e.season))];for(const n of seasons){const o=element('option',n===0?'Specials':`Season ${n}`);o.value=String(n);seasonSelect.append(o);}
    if(seasons.some(n=>n>0))seasonSelect.value=String(seasons.find(n=>n>0));seasonLabel.append(seasonSelect);controls.append(seasonLabel,titleResolutionControl());
    const list=element('div','','episode-list');
    const render=()=>{
      list.replaceChildren();
      for(const episode of meta.episodes.filter(e=>e.season===+seasonSelect.value)){
        const row=element('article','','episode-row');const number=element('strong',String(episode.episode).padStart(2,'0'),'episode-number');
        const info=element('div','','episode-info');info.append(element('strong',episode.name));if(episode.description)info.append(element('span',episode.description,'episode-overview'));
        const actions=element('div','','episode-actions');const target={type:'series',id:meta.id,season:episode.season,episode:episode.episode};
        const playButton=button('Play',()=>quickPlay(meta,target,episode.name,playButton),true);const more=button('More',()=>openOptions(meta,target,episode.name));more.setAttribute('aria-label',`More options for ${episode.name}`);
        actions.append(playButton,more);row.append(number,info,actions);
        if(episode.released&&Date.parse(episode.released)>Date.now()){playButton.disabled=true;more.disabled=true;row.classList.add('future');}
        list.append(row);
      }
    };
    seasonSelect.addEventListener('change',render);$('episode-area').replaceChildren(controls,list);
    if(!seasons.length){$('episode-area').append(element('p','No episode list is available.'));return;}render();
  }

  async function openOptions(meta,target,episodeName=''){
    currentMeta=meta;if(!$('source-dialog').open)$('source-dialog').showModal();$('source-title').textContent=episodeName?`${meta.name} · S${target.season}E${target.episode}`:meta.name;
    await findSources(meta,target,episodeName);
  }

  function renderSourceTable(meta,list,target,episodeName,generation,area,status,resolution){
    area.replaceChildren(status);const controls=element('div','','source-controls');const label=element('label','Resolution');const select=createResolutionSelect(resolution);label.append(select);controls.append(label);area.append(controls);
    const visible=filterSourcesByResolution(list,resolution);
    if(!visible.length){area.append(element('p','No sources match this resolution.','source-note'));select.addEventListener('change',()=>renderSourceTable(meta,list,target,episodeName,generation,area,status,select.value));return;}
    const best=recommendSource(visible,target.type,resolution),context=best?buildContext(meta,target,episodeName,resolution,best):null;
    if(best){
      const box=element('section','','recommended');const copy=element('div','','recommended-copy');
      copy.append(element('div','Recommended','recommended-kicker'),element('div',best.title,'recommended-title'),element('p',[best.cached?'Cached':'Not cached',qualityText(best),formatBytes(best.size)].join(' · '),'recommended-meta'));
      box.append(copy,button(best.cached?'Play':'Prepare',async()=>{try{const result=await readyFile(best,{signal:AbortSignal.timeout(330000)});$('source-dialog').close();if($('title-dialog').open)$('title-dialog').close();await play(result.file,context);}catch(e){status.textContent=e.message;status.classList.add('error');}},true));area.append(box);
    }
    const wrap=element('div','','source-table-wrap'),table=element('table','','source-table'),head=document.createElement('thead'),hr=document.createElement('tr');
    for(const title of ['Filename','Size','Seeders','Quality','TorBox',''])hr.append(element('th',title));head.append(hr);table.append(head);const body=document.createElement('tbody');
    for(const source of visible){
      const row=document.createElement('tr');if(best?.id===source.id)row.className='recommended-row';
      row.append(element('td',source.title,'filename'),element('td',formatBytes(source.size)),element('td',Number.isSafeInteger(source.seeders)?String(source.seeders):'—'),element('td',qualityText(source)),element('td',source.cached?'Cached':source.cached===false?'Not cached':'Unknown',source.cached?'cache-yes':'cache-no'));
      const action=document.createElement('td');action.append(button(source.cached?'Play':'Prepare',async()=>{try{const result=await readyFile(source,{signal:AbortSignal.timeout(330000)});$('source-dialog').close();if($('title-dialog').open)$('title-dialog').close();await play(result.file,buildContext(meta,target,episodeName,resolution,source));}catch(e){status.textContent=e.message;status.classList.add('error');}}));row.append(action);body.append(row);
    }
    table.append(body);wrap.append(table);area.append(wrap);
    if(visible.every(s=>s.seeders==null))area.append(element('p','Seeder counts are unavailable from the current index. Filename is the release name until TorBox resolves the internal file.','source-note'));
    select.addEventListener('change',()=>{setResolution(select.value);renderSourceTable(meta,list,target,episodeName,generation,area,status,select.value);});
  }

  async function findSources(meta,target,episodeName=''){
    cancelSource();const generation=sourceGeneration;sourceAbort=new AbortController();const area=$('source-options'),status=element('p','Finding sources…','status subtle-status');area.replaceChildren(status);
    const alive=()=>active&&generation===sourceGeneration&&$('source-dialog').open;
    try{
      const result=await registeredSources(target,sourceAbort.signal);if(!alive())return;status.textContent=result.warning||'';renderSourceTable(meta,result.sources,target,episodeName,generation,area,status,getResolution());
    }catch(e){if(alive()){status.textContent=e.message;status.classList.add('error');area.append(button('Retry',()=>findSources(meta,target,episodeName)));}}
  }

  async function playNext(context){
    if(!active||!context?.queue?.length)return false;const next=context.queue[0],rest=context.queue.slice(1);
    try{
      const meta=await api(`/api/discover/meta?type=series&id=${next.id}`,{signal:AbortSignal.timeout(20000)});
      const registered=await registeredSources(next,AbortSignal.timeout(45000));
      let best=recommendSource(registered.sources,'series',context.resolution||'auto')||recommendSource(registered.sources,'series','auto');if(!best||best.audioRisk)return false;
      const result=await readyFile(best,{signal:AbortSignal.timeout(330000),unattended:true});
      await play(result.file,{title:meta.meta.name,poster:meta.meta.poster||context.poster,episodeName:next.name||'',resolution:context.resolution||'auto',current:next,sourceResolution:best.resolution||best.quality||'',queue:rest});return true;
    }catch{return false;}
  }

  async function recoverPlayback(context){
    if(!active||!context?.current)return false;
    try{
      const registered=await registeredSources(context.current,AbortSignal.timeout(45000));
      for(const resolution of lowerResolutionOrder(context.sourceResolution,context.resolution)){
        const best=recommendSource(registered.sources,context.current.type,resolution);if(!best||best.audioRisk||best.videoRisk)continue;
        try{
          const result=await readyFile(best,{signal:AbortSignal.timeout(330000),unattended:true});
          await play(result.file,{...context,resolution,sourceResolution:best.resolution||best.quality||resolution});return true;
        }catch{}
      }
    }catch{}
    return false;
  }

  async function resumeRecent(entry){
    if(!entry||!['movie','series'].includes(entry.type))return false;
    message('catalog-message','Resuming…');
    try{
      const data=await api(`/api/discover/meta?type=${entry.type}&id=${entry.id}`,{signal:AbortSignal.timeout(20000)}),meta=data.meta;
      const target=entry.type==='series'?{type:'series',id:entry.id,season:entry.season,episode:entry.episode}:{type:'movie',id:entry.id};
      const name=entry.type==='series'?(meta.episodes.find(e=>e.season===entry.season&&e.episode===entry.episode)?.name||entry.episodeName):'';
      const registered=await registeredSources(target,AbortSignal.timeout(45000)),resolution=entry.resolution||'auto';
      const best=recommendSource(registered.sources,target.type,resolution)||recommendSource(registered.sources,target.type,'auto');if(!best)throw new Error('No source is available to resume.');
      const result=await readyFile(best,{signal:AbortSignal.timeout(330000),unattended:true});
      await play(result.file,buildContext(meta,target,name,resolution,best));message('catalog-message','');return true;
    }catch(e){message('catalog-message',e.message,true);return false;}
  }

  $('discover-tab').addEventListener('click',openDiscover);$('library-tab').addEventListener('click',openLibrary);
  for(const id of ['catalog-type','catalog-feed','catalog-genre'])$(id).addEventListener('change',()=>browse());
  $('catalog-more').addEventListener('click',()=>browse(true));$('catalog-retry').addEventListener('click',()=>browse());
  $('search').addEventListener('input',()=>{clearTimeout(searchTimer);if(view!=='discover')return;++catalogGeneration;catalogAbort?.abort();searchTimer=setTimeout(()=>browse(),350);});
  $('close-title').addEventListener('click',()=>$('title-dialog').close());$('title-dialog').addEventListener('close',()=>{++titleGeneration;titleAbort?.abort();});
  $('close-source').addEventListener('click',()=>$('source-dialog').close());$('source-dialog').addEventListener('close',cancelSource);
  $('viewer').addEventListener('change',()=>{cancelTitle();if($('title-dialog').open)$('title-dialog').close();if($('source-dialog').open)$('source-dialog').close();});
  return {
    async activate(){active=true;await openDiscover();},openLibrary,playNext,recoverPlayback,resumeRecent,
    suspend(){active=false;++catalogGeneration;catalogAbort?.abort();cancelTitle();clearTimeout(searchTimer);metas=[];nextSkip=null;currentMeta=null;$('catalog-grid').replaceChildren();$('title-content').replaceChildren();$('episode-area').replaceChildren();$('source-options').replaceChildren();if($('title-dialog').open)$('title-dialog').close();if($('source-dialog').open)$('source-dialog').close();}
  };
}
import { saveTraktCredentials, loadTraktCredentials, removeTraktCredentials } from './trakt-vault.js?v=release-1.2.12-sound.1';

const API='https://api.trakt.tv';
const AUTHORIZE='https://auth.trakt.tv/oauth/authorize';
const REDIRECT='https://to-shreds.github.io/torbox-web-player/';
const CLIENT_KEY='torbox-trakt-client-id-v1';
const PENDING_KEY='torbox-trakt-oauth-pending-v1';
const PREF_KEY='torbox-trakt-preferences-v1:';
const HISTORY_KEY='torbox-trakt-history-v1:';
const MAX_WATCHED=24;
const MAX_REMOTE_PROGRESS=30;
const allowedViewer=value=>value==='viewer-2'?'viewer-2':'viewer-1';
const imdb=value=>/^tt[0-9]{5,12}$/.test(value||'')?value:'';
const clean=value=>typeof value==='string'?value.slice(0,180):'';
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const episodeNumber=value=>typeof value==='number'||typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;
const epoch=value=>{const n=Date.parse(value||'');return Number.isFinite(n)?n:0;};
const asPercent=(position,duration)=>Number.isFinite(duration)&&duration>0&&Number.isFinite(position)?Math.max(0,Math.min(100,position/duration*100)):0;
const jsonGet=(key,fallback)=>{try{const data=JSON.parse(localStorage.getItem(key)||'null');return data??fallback;}catch{return fallback;}};
const jsonSet=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
const randomBase64url=length=>{
  const bytes=crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
};
const safeId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{20,128}$/.test(id)?id:'';


function restoreCachedRows(raw,playback){
  if(!Array.isArray(raw))return [];
  const seen=new Set(),rows=[];
  for(const item of raw){
    if(!item||!imdb(item.id)||!['series','movie'].includes(item.type))continue;
    if(item.type==='series'&&(!Number.isSafeInteger(episodeNumber(item.season))||episodeNumber(item.season)<0||!Number.isSafeInteger(episodeNumber(item.episode))||episodeNumber(item.episode)<1))continue;
    const key=item.type==='movie'?'movie:'+item.id:'series:'+item.id+':'+number(item.season)+':'+number(item.episode);
    if(item.key!==key||seen.has(key)||!Number.isFinite(item.updatedAt)||item.updatedAt<=0)continue;
    if(playback&&!(number(item.traktPercent)>1&&number(item.traktPercent)<95))continue;
    const row={key,type:item.type,id:item.id,season:item.type==='series'?number(item.season):null,episode:item.type==='series'?number(item.episode):null,title:clean(item.title)||'Untitled',episodeName:clean(item.episodeName),poster:'',resolution:'auto',position:0,duration:0,completed:!playback,updatedAt:item.updatedAt};
    if(playback)row.traktPercent=number(item.traktPercent);
    rows.push(row);seen.add(key);
    if(rows.length>=(playback?MAX_REMOTE_PROGRESS:MAX_WATCHED))break;
  }
  return rows;
}

export function traktMedia(item) {
  const target=item?.current;
  const id=imdb(target?.id);
  if(!id||!['movie','series'].includes(target.type))return null;
  if(target.type==='movie')return {type:'movie',id};
  const season=episodeNumber(target.season),episode=episodeNumber(target.episode);
  if(!Number.isSafeInteger(season)||!Number.isSafeInteger(episode)||season<0||episode<1)return null;
  return {type:'series',id,season,episode};
}

function rowFromTrakt(entry,playback=false){
  if(!entry||typeof entry!=='object')return null;
  const series=entry.type==='episode';
  if(!series&&entry.type!=='movie')return null;
  const id=imdb(series?entry.show?.ids?.imdb:entry.movie?.ids?.imdb);
  if(!id)return null;
  const season=series?episodeNumber(entry.episode?.season):null;
  const episode=series?episodeNumber(entry.episode?.number):null;
  if(series&&(!Number.isSafeInteger(season)||season<0||!Number.isSafeInteger(episode)||episode<1))return null;
  const title=clean(series?entry.show?.title:entry.movie?.title)||'Untitled';
  const key=series?'series:'+id+':'+season+':'+episode:'movie:'+id;
  const updatedAt=epoch(playback?entry.paused_at:entry.watched_at);
  if(!updatedAt)return null;
  const progress=playback?number(entry.progress):0;
  if(playback&&!(progress>1&&progress<95))return null;
  return {key,type:series?'series':'movie',id,season,episode,title,episodeName:series?clean(entry.episode?.title):'',poster:'',resolution:'auto',position:0,duration:0,completed:!playback,updatedAt,...(playback?{traktPercent:Math.min(94,Math.max(1,progress))}:{})};
}
export function normalizeTraktHistory(entries,limit=MAX_WATCHED){
  const seen=new Set();
  return (Array.isArray(entries)?entries:[]).map(row=>rowFromTrakt(row)).filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt).filter(row=>{if(seen.has(row.key))return false;seen.add(row.key);return true;}).slice(0,Math.max(0,limit));
}
export function normalizeTraktPlayback(entries,limit=MAX_REMOTE_PROGRESS){
  const seen=new Set();
  return (Array.isArray(entries)?entries:[]).map(row=>rowFromTrakt(row,true)).filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt).filter(row=>{if(seen.has(row.key))return false;seen.add(row.key);return true;}).slice(0,Math.max(0,limit));
}
export function mergeContinueWatching(local=[],remote=[],limit=6){
  const originals=Array.isArray(local)?local.filter(Boolean):[];
  const keys=new Set(originals.map(row=>row.type+':'+row.id));
  const merged=[...originals,...(Array.isArray(remote)?remote:[]).filter(row=>row&&!keys.has(row.type+':'+row.id))];
  const seen=new Set(),result=[];
  for(const row of merged.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))){
    const titleKey=row.type+':'+row.id;
    if(seen.has(titleKey))continue;
    seen.add(titleKey);
    if(row.completed)continue;
    result.push(row);
    if(result.length>=limit)break;
  }
  return result;
}
export function traktScrobbleObject(media,episodeIds=null){
  if(!media)return null;
  if(media.type==='movie')return {movie:{ids:{imdb:media.id}}};
  const ids=episodeIds?.ids||{};
  if(Number.isSafeInteger(ids.trakt)&&ids.trakt>0)return {episode:{ids:{trakt:ids.trakt}}};
  if(imdb(ids.imdb))return {episode:{ids:{imdb:ids.imdb}}};
  return null;
}

export class TraktIntegration {
  constructor({getViewer,onChanged,openWatched}={}){
    this.getViewer=getViewer||(()=> 'viewer-1');
    this.onChanged=onChanged||(()=>{});
    this.openWatched=openWatched||(()=>{});
    this.credentials=new Map();
    this.inflight=new Map();
    this.refresher=new Map();
    this.generations=new Map();
    this.remote=new Map();
    this.episodes=new Map();
    this.states=new WeakMap();
    this.requests=Promise.resolve();
    this.lastPost=0;
    this.message='';
  }
  id(){try{return safeId(localStorage.getItem(CLIENT_KEY)||'');}catch{return '';}}
  viewer(){return allowedViewer(this.getViewer());}
  preferences(viewer=this.viewer()){const data=jsonGet(PREF_KEY+allowedViewer(viewer),{});return {enabled:data.enabled===true,importHistory:data.importHistory===true};}
  setPreferences(viewer,patch){return jsonSet(PREF_KEY+allowedViewer(viewer),{...this.preferences(viewer),...patch});}
  cache(viewer=this.viewer()){
    const v=allowedViewer(viewer);
    if(!this.remote.has(v)){
      const cached=jsonGet(HISTORY_KEY+v,{});
      this.remote.set(v,{watched:restoreCachedRows(cached.watched,false),playback:restoreCachedRows(cached.playback,true),updatedAt:number(cached.updatedAt)});
    }
    return this.remote.get(v);
  }
  generation(viewer){return this.generations.get(viewer)||0;}
  connected(viewer){return this.credentials.has(viewer)&&this.credentials.get(viewer)?.client_id===this.id();}
  current(viewer,generation){return this.generation(viewer)===generation&&this.connected(viewer);}
  assertCurrent(viewer,generation){if(!this.current(viewer,generation))throw new Error('Trakt connection changed.');}
  canScrobble(viewer){return this.connected(viewer)&&this.preferences(viewer).enabled===true;}
  recentPlayback(viewer=this.viewer()){
    if(!this.connected(viewer)||!this.preferences(viewer).importHistory)return [];
    return this.cache(viewer).playback;
  }
  recentWatched(viewer=this.viewer()){
    if(!this.connected(viewer)||!this.preferences(viewer).importHistory)return [];
    return this.cache(viewer).watched;
  }
  remotePercent(target,viewer=this.viewer()){
    if(!this.connected(viewer)||!this.preferences(viewer).importHistory)return 0;
    const media=traktMedia({current:target});
    if(!media)return 0;
    const key=media.type==='series'?'series:'+media.id+':'+media.season+':'+media.episode:'movie:'+media.id;
    return this.cache(viewer).playback.find(row=>row.key===key)?.traktPercent||0;
  }
  async init(){
    this.bindControls();
    // Clean OAuth codes out of the URL before any backend or third-party requests.
    await this.completeOAuth();
    await Promise.all(['viewer-1','viewer-2'].map(async v=>{
      const generation=this.generation(v);
      const credentials=await loadTraktCredentials(v);
      if(generation===this.generation(v)&&credentials&&credentials.client_id===this.id())this.credentials.set(v,credentials);
    }));
    this.cache('viewer-1');this.cache('viewer-2');
    this.updateUI();
    const v=this.viewer();
    if(this.credentials.has(v)&&this.preferences(v).importHistory&&Date.now()-this.cache(v).updatedAt>3600000)void this.syncHistory(v);
    this.onChanged();
  }
  async completeOAuth(){
    const url=new URL(location.href),code=url.searchParams.get('code'),state=url.searchParams.get('state'),error=url.searchParams.get('error');
    let pending=null;try{pending=JSON.parse(sessionStorage.getItem(PENDING_KEY)||'null');}catch{}
    if(!state||(!code&&!error))return;
    url.searchParams.delete('code');url.searchParams.delete('state');url.searchParams.delete('error');url.searchParams.delete('error_description');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
    try{sessionStorage.removeItem(PENDING_KEY);}catch{}
    if(!pending||pending.state!==state||Date.now()-pending.time>600000||Date.now()<pending.time||!safeId(pending.clientId)) {this.message='Trakt sign-in could not be verified. Connect again.';return;}
    if(error){this.message='Trakt authorization was cancelled.';return;}
    const generation=this.generation(pending.viewer);
    try{
      const response=await fetch(API+'/oauth/token',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,client_id:pending.clientId,redirect_uri:pending.redirect,grant_type:'authorization_code',code_verifier:pending.verifier}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Trakt could not complete authorization ('+response.status+').');
      const tokens=await response.json();
      const credentials=this.normalizeCredentials(tokens,pending.clientId);
      if(generation!==this.generation(pending.viewer)||pending.clientId!==this.id())return;
      await saveTraktCredentials(pending.viewer,credentials);
      if(generation!==this.generation(pending.viewer)||pending.clientId!==this.id())return;
      this.credentials.set(pending.viewer,credentials);
      this.setPreferences(pending.viewer,{enabled:true,importHistory:true});
      this.message='Trakt connected to '+(pending.viewer==='viewer-2'?'Viewer 2':'Viewer 1')+'.';
      void this.syncHistory(pending.viewer);
    }catch(e){this.message=e.message||'Trakt connection failed.';}
  }
  normalizeCredentials(value,clientId){
    if(!value?.access_token||!value?.refresh_token)throw new Error('Trakt did not provide usable authorization credentials.');
    const issued=number(value.created_at)||Math.floor(Date.now()/1000);
    const ttl=number(value.expires_in)||604800;
    return {client_id:clientId,access_token:value.access_token,refresh_token:value.refresh_token,expires_at:(issued+ttl)*1000};
  }
  async connect(){
    const field=document.getElementById('trakt-client-id');
    const id=safeId(field?.value?.trim()||'');
    if(!id)throw new Error('Enter your Trakt application Client ID first.');
    if(!crypto?.subtle||!globalThis.isSecureContext)throw new Error('Trakt sign-in requires a secure HTTPS browser.');
    try{localStorage.setItem(CLIENT_KEY,id);}catch{throw new Error('This browser cannot save the Trakt app ID.');}
    const verifier=randomBase64url(48),state=randomBase64url(24);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
    const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const pending={viewer:this.viewer(),clientId:id,state,verifier,time:Date.now(),redirect:REDIRECT};
    sessionStorage.setItem(PENDING_KEY,JSON.stringify(pending));
    const url=new URL(AUTHORIZE);
    for(const [key,value] of Object.entries({response_type:'code',client_id:id,redirect_uri:REDIRECT,state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
    location.assign(url.href);
  }
  async ensureToken(viewer){
    const saved=this.credentials.get(viewer),generation=this.generation(viewer);
    if(!saved||saved.client_id!==this.id())throw new Error('Connect Trakt in Settings.');
    if(saved.expires_at>Date.now()+60000)return saved.access_token;
    if(!this.refresher.has(viewer)){
      const task=(async()=>{
        const response=await fetch(API+'/oauth/token',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:saved.refresh_token,client_id:saved.client_id,redirect_uri:REDIRECT,grant_type:'refresh_token'}),signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error('Trakt authorization expired. Reconnect in Settings.');
        const current=this.normalizeCredentials(await response.json(),saved.client_id);
        this.assertCurrent(viewer,generation);
        await saveTraktCredentials(viewer,current);
        this.assertCurrent(viewer,generation);
        this.credentials.set(viewer,current);
        return current.access_token;
      })();
      this.refresher.set(viewer,task);
      void task.finally(()=>{if(this.refresher.get(viewer)===task)this.refresher.delete(viewer);}).catch(()=>{});
    }
    return this.refresher.get(viewer);
  }
  async request(viewer,path,{method='GET',body}={}){
    const generation=this.generation(viewer),clientId=this.id();
    const token=await this.ensureToken(viewer);
    this.assertCurrent(viewer,generation);
    const result=await fetch(API+path,{method,mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json','trakt-api-version':'2','trakt-api-key':clientId,Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
    if(result.status===204)return null;
    if(result.status===429)throw new Error('Trakt is rate-limiting requests. Try again later.');
    if(!result.ok)throw new Error('Trakt request failed ('+result.status+').');
    return result.json();
  }
  async lookupEpisode(media,viewer){
    const key=media.id+':'+media.season+':'+media.episode;
    if(this.episodes.has(key))return this.episodes.get(key);
    const result=await this.request(viewer,'/shows/'+media.id+'/seasons/'+media.season+'/episodes/'+media.episode);
    if(result?.season!==media.season||result?.number!==media.episode||!traktScrobbleObject(media,result))throw new Error('Trakt could not identify this episode; skipping scrobble.');
    this.episodes.set(key,result);
    return result;
  }
  async syncHistory(viewer=this.viewer()){
    if(!this.connected(viewer)||!this.preferences(viewer).importHistory)return;
    if(this.inflight.has(viewer))return this.inflight.get(viewer);
    const generation=this.generation(viewer);
    const task=(async()=>{
      try{
        const [watched,playback]=await Promise.all([
          this.request(viewer,'/sync/history?page=1&limit=40'),
          this.request(viewer,'/sync/playback')
        ]);
        const rows={watched:normalizeTraktHistory(watched),playback:normalizeTraktPlayback(playback),updatedAt:Date.now()};
        if(!this.current(viewer,generation)||!this.preferences(viewer).importHistory)return;
        this.remote.set(viewer,rows);
        jsonSet(HISTORY_KEY+viewer,rows);
        this.message='Trakt watch history updated.';
        this.onChanged();
      }catch(e){if(this.current(viewer,generation))this.message='Trakt history could not be updated: '+e.message;}
      finally{this.updateUI();}
    })();
    this.inflight.set(viewer,task);
    try{return await task;}finally{if(this.inflight.get(viewer)===task)this.inflight.delete(viewer);}
  }
  async disconnect(){
    const v=this.viewer(),existing=this.credentials.get(v);
    // Invalidate pending refreshes, history and queued scrobbles before awaiting storage.
    this.generations.set(v,this.generation(v)+1);
    this.credentials.delete(v);this.refresher.delete(v);this.inflight.delete(v);
    this.setPreferences(v,{enabled:false,importHistory:false});
    this.remote.delete(v);
    try{localStorage.removeItem(HISTORY_KEY+v);}catch{}
    this.message='Trakt disconnected on this device. You can also revoke access in your Trakt account.';
    this.updateUI();this.onChanged();
    await removeTraktCredentials(v);
    if(existing?.access_token){
      void fetch(API+'/oauth/revoke',{method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:existing.access_token,client_id:existing.client_id}),signal:AbortSignal.timeout(8000)}).catch(()=>{});
    }
  }
  queueAction(context,action,progress){
    const viewer=allowedViewer(context?.viewer);
    const playback=context?.playbackContext;
    const media=traktMedia(playback);
    if(!media||!this.canScrobble(viewer))return;
    const bodyBase=media,generation=this.generation(viewer);
    const work=async()=>{
      if(!this.current(viewer,generation)||!this.canScrobble(viewer))return;
      try{
        const item=traktScrobbleObject(bodyBase,bodyBase.type==='series'?await this.lookupEpisode(bodyBase,viewer):null);
        if(!item||!this.current(viewer,generation)||!this.canScrobble(viewer))return;
        const delay=Math.max(0,1100-(Date.now()-this.lastPost));
        if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
        if(!this.current(viewer,generation)||!this.canScrobble(viewer))return;
        this.lastPost=Date.now();
        await this.request(viewer,'/scrobble/'+action,{method:'POST',body:{...item,progress:Math.round(Math.max(0,Math.min(100,progress))*100)/100}});
      }catch(e){if(this.current(viewer,generation)){this.message='Trakt scrobbling unavailable: '+e.message;this.updateUI();}}
    };
    this.requests=this.requests.then(work,work);
  }
  progress(context,finished=false){
    const video=context?.video;
    return finished?100:asPercent(video?.currentTime,video?.duration);
  }
  playing(context){
    if(!context||context.partyGuest&&!this.credentials.has(context.viewer))return;
    let state=this.states.get(context);
    if(!state){state={mode:'idle'};this.states.set(context,state);}
    if(state.mode==='playing'||state.mode==='stopped')return;
    state.mode='playing';
    this.queueAction(context,'start',this.progress(context));
  }
  paused(context){
    const state=this.states.get(context);
    if(!state||state.mode!=='playing'||context?.video?.ended)return;
    state.mode='paused';
    const progress=this.progress(context);
    if(progress>=1)this.queueAction(context,'pause',progress);
  }
  stopped(context,finished=false){
    const state=this.states.get(context);
    if(!state||state.mode==='stopped')return;
    state.mode='stopped';
    const progress=this.progress(context,finished);
    if(progress>=1)this.queueAction(context,'stop',progress);
  }
  renderHistory(){
    const section=document.getElementById('trakt-recent-section'),list=document.getElementById('trakt-recent-list');
    if(!section||!list)return;
    const rows=this.recentWatched().slice(0,12);
    section.hidden=!rows.length||document.getElementById('discover-panel')?.hidden===true;
    const frag=document.createDocumentFragment();
    for(const row of rows){
      const button=document.createElement('button');button.type='button';button.className='trakt-history-entry';
      button.textContent=row.title+(row.type==='series'?' · S'+row.season+'E'+row.episode:'')+' · Watched';
      button.addEventListener('click',()=>this.openWatched(row));
      frag.append(button);
    }
    list.replaceChildren(frag);
  }
  updateUI(){
    const viewer=this.viewer(),connected=this.credentials.has(viewer)&&this.credentials.get(viewer)?.client_id===this.id();
    const toggle=document.getElementById('trakt-scrobble-toggle');
    if(toggle){toggle.disabled=!connected;toggle.checked=connected&&this.preferences(viewer).enabled;toggle.title=connected?'Scrobble playback to Trakt':'Connect Trakt in Settings';}
    const status=document.getElementById('trakt-status');
    if(status)status.textContent=(connected?'Connected for '+(viewer==='viewer-1'?'Viewer 1':'Viewer 2')+'. ':'Not connected for this viewer. ')+(this.message||'');
    const field=document.getElementById('trakt-client-id');if(field&&document.activeElement!==field)field.value=this.id();
    const enabled=document.getElementById('trakt-import-history');if(enabled){enabled.checked=connected&&this.preferences(viewer).importHistory;enabled.disabled=!connected;}
    const disconnect=document.getElementById('trakt-disconnect');if(disconnect)disconnect.disabled=!connected;
    const sync=document.getElementById('trakt-sync');if(sync)sync.disabled=!connected||!this.preferences(viewer).importHistory;
    const connect=document.getElementById('trakt-connect');if(connect)connect.textContent=connected?'Reconnect Trakt':'Connect Trakt';
  }
  viewerChanged(){
    this.message='';
    this.updateUI();this.renderHistory();
    if(this.credentials.has(this.viewer())&&this.preferences().importHistory&&Date.now()-this.cache().updatedAt>3600000)void this.syncHistory();
  }
  bindControls(){
    document.getElementById('trakt-scrobble-toggle')?.addEventListener('change',e=>{
      const v=this.viewer();
      if(!this.credentials.has(v)){e.target.checked=false;return;}
      this.setPreferences(v,{enabled:e.target.checked});
      this.message=e.target.checked?'Scrobbling enabled.':'Scrobbling paused. Local history is unaffected.';
      this.updateUI();
    });
    document.getElementById('trakt-connect')?.addEventListener('click',async e=>{
      e.target.disabled=true;this.message='Opening Trakt authorization…';this.updateUI();
      try{await this.connect();}catch(error){this.message=error.message;this.updateUI();e.target.disabled=false;}
    });
    document.getElementById('trakt-disconnect')?.addEventListener('click',async()=>{try{await this.disconnect();}catch(e){this.message=e.message;this.updateUI();}});
    document.getElementById('trakt-sync')?.addEventListener('click',()=>void this.syncHistory());
    document.getElementById('trakt-import-history')?.addEventListener('change',e=>{
      const v=this.viewer();this.setPreferences(v,{importHistory:e.target.checked});
      this.message=e.target.checked?'Trakt watched and resume history will appear on Discover.':'Trakt history hidden. Local history is unchanged.';
      this.updateUI();this.onChanged();
      if(e.target.checked)void this.syncHistory(v);
    });
  }
}
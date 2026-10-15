import {normalizePartySnapshot,createPartyClock,partyDriftCorrection,partyUpdateIsNewer} from './watch-party-core.js?v=release-1.2.4-recovery.1';

const $=id=>document.getElementById(id);
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export function createWatchParty({api,getPlayback,playFile,isAllowed,isSignedIn,getViewer}) {
  let room=null,snapshot=null,invite='',generation=0,operation=null,pollTimer=null,tickTimer=null,startTimer=null,inFlight=false;
  let videoAbort=null,bound=null,pendingCommand=null,commandSeq=0,expectedSeek=null,userSeeking=false,expectedPauses=0,expectedPlays=[];
  let buffering=false,blocked=false,connectionLost=false,preparing=false,transitioning=false,unlocking=false,failures=0,playPending=false,selectedViewer='';
  const clock=createPartyClock();
  const dialog=$('watch-party-dialog');
  const fromHash=()=>{const match=/^#party=([A-Za-z0-9_-]{43})$/.exec(location.hash);return match?.[1]||'';};
  let pendingInvite=fromHash(),inviteShown=false;
  if(pendingInvite)$('party-join-code').value=pendingInvite;
  const permitted=()=>isSignedIn()&&isAllowed()&&(!room||getViewer()===selectedViewer);
  const hidden=()=>document.hidden&&document.pictureInPictureElement!==bound?.video;
  function message(value,error=false){$('party-status').textContent=value;$('party-status').classList.toggle('error',error);}
  function internal(action){try{return action();}catch{return undefined;}}
  function pauseLocal(){const video=bound?.video;if(video&&!video.paused){expectedPauses++;try{video.pause();}catch{expectedPauses--;}}}
  function playLocal(video){
    if(!video.paused)return video.play();
    const token={video};expectedPlays.push(token);
    const remove=()=>{expectedPlays=expectedPlays.filter(item=>item!==token);};
    try{const result=video.play();Promise.resolve(result).catch(remove);return result;}catch(error){remove();throw error;}
  }
  function cancelTimers(){clearTimeout(pollTimer);clearInterval(tickTimer);clearTimeout(startTimer);pollTimer=null;tickTimer=null;startTimer=null;}
  function unbind(){videoAbort?.abort();videoAbort=null;const video=bound?.video;if(video&&video.playbackRate!==1)internal(()=>{video.playbackRate=1;});bound=null;expectedSeek=null;userSeeking=false;expectedPauses=0;expectedPlays=[];unlocking=false;}
  function setInline(value,phase=''){
    const node=$('party-player-status');node.hidden=!room;if(node.textContent!==value)node.textContent=value;node.dataset.phase=phase;
    $('party-resume').hidden=!room||(!blocked&&bound?.ready===true);
  }
  function render(){
    const active=!!room,phase=room?.state.phase||'';
    dialog.dataset.phase=phase;$('party-status').dataset.phase=phase;
    $('party-create').disabled=active||transitioning||!getPlayback()?.playbackProof||!permitted();
    $('party-join').disabled=active||transitioning||!permitted();$('party-leave').hidden=!active;
    $('party-share').hidden=!active||!invite;$('party-controls').hidden=!active;
    $('party-play').disabled=!active||preparing;$('party-pause').disabled=!active||preparing;
    $('party-sync').disabled=!active||!bound;$('party-ready').hidden=!active||(!blocked&&bound?.ready===true);
    $('party-ready').disabled=!bound?.ready||preparing||unlocking;$('party-resume').disabled=!bound?.ready||preparing||unlocking;
    if(!active){$('party-summary').textContent='Start a video to create a party, or paste an invitation to join. Each person connects TorBox on their own device.';setInline('');return;}
    $('party-summary').textContent=[room.media.title,room.media.fileTitle].filter(Boolean).join(' · ');
    const count=Number(!!room.members.host?.present)+Number(!!room.members.guest?.present);
    const reason=connectionLost?'Connection interrupted. Playback is paused while reconnecting.':preparing?'Loading the exact party video…':blocked?'Tap Ready to watch to allow playback.':!room.members.guest?'Waiting for the other viewer.':phase==='playing'?'Watching together · shared play, pause and seeking.':phase==='scheduled'?'Starting together…':room.state.reason||'Paused together.';
    message(`${count}/2 viewers · ${reason}`,connectionLost);
    setInline('Watch party · '+reason,phase);
    dialog.dataset.role=room.role;
  }
  async function call(path,data,{signal=operation?.signal,keepalive=false,timeoutMs=9000}={}) {
    const sentAt=performance.now(),current=generation;
    const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
    const result=await api('/api/watch-party/'+path,{method:'POST',data,signal:bounded,keepalive,timeoutMs,background:true,restoreSession:false});
    if(current===generation&&Number.isFinite(result?.serverTime))clock.sample({sentAt,receivedAt:performance.now(),serverTime:result.serverTime});
    return result;
  }
  function accept(result,current=generation){
    if(current!==generation)return false;
    const next=normalizePartySnapshot(result);
    if(!next||next.room.id!==room?.id)return false;
    if(snapshot&&JSON.stringify(next.room.media)!==JSON.stringify(snapshot.room.media)){void leave({notify:true,notice:'The party video changed unexpectedly. Create a new party.'});return true;}
    if(snapshot&&!partyUpdateIsNewer(next,snapshot))return true;
    snapshot=next;room=next.room;connectionLost=false;failures=0;render();correct();
    clearTimeout(startTimer);startTimer=null;
    const serverNow=clock.now(),until=serverNow===null?0:room.state.at-serverNow;
    if(room.state.playing&&until>0&&until<=10000)startTimer=setTimeout(()=>{startTimer=null;correct();},Math.ceil(until));
    return true;
  }
  function correct(){
    if(!room||!bound||!permitted())return;
    const video=bound.video,serverNow=clock.now();
    if(connectionLost||hidden()||serverNow===null){pauseLocal();return;}
    if(unlocking)return;
    if(video.readyState<1||!Number.isFinite(video.duration)||video.duration<=0){pauseLocal();return;}
    const correction=partyDriftCorrection({state:room.state,serverNow,currentTime:video.currentTime,duration:video.duration,ready:bound.ready&&video.readyState>=3,buffering,autoplayBlocked:blocked,seeking:userSeeking});
    if(!correction.shouldPlay)pauseLocal();
    if(Number.isFinite(correction.seekTo)&&!userSeeking&&video.readyState>=1&&Math.abs(video.currentTime-correction.seekTo)>.08){expectedSeek=correction.seekTo;internal(()=>{video.currentTime=correction.seekTo;});}
    if(Number.isFinite(correction.playbackRate)&&Math.abs(video.playbackRate-correction.playbackRate)>.001)internal(()=>{video.playbackRate=correction.playbackRate;});
    if(correction.shouldPlay&&video.paused&&!playPending){
      playPending=true;const current=generation;
      let pending;try{pending=playLocal(video);}catch(error){pending=Promise.reject(error);}
      Promise.resolve(pending).catch(error=>{if(current===generation&&bound?.video===video&&error.name!=='AbortError'){blocked=error.name==='NotAllowedError';buffering=!blocked;pauseLocal();render();schedule(0);}}).finally(()=>{if(current===generation)playPending=false;});
    }
  }
  function schedule(delay=800){clearTimeout(pollTimer);if(room)pollTimer=setTimeout(()=>void sync(),delay);}
  async function sync(){
    if(!room||inFlight)return;
    if(!permitted()){void leave({notice:'The party ended because this viewer or connection changed.'});return;}
    const current=generation,context=bound,video=context?.video,command=pendingCommand;pendingCommand=null;
    inFlight=true;
    try{
      const result=await call('sync',{roomId:room.id,...(context?.playbackProof?{playbackProof:context.playbackProof}:{}),ready:!!context?.ready&&video.readyState>=3&&!preparing&&!hidden()&&!blocked&&!connectionLost,buffering:buffering||!!video?.seeking,blocked:blocked||hidden()||!context?.ready,position:Math.min(room.media.duration,Number.isFinite(video?.currentTime)?video.currentTime:room.state.position),duration:Number.isFinite(video?.duration)&&video.duration>0?video.duration:room.media.duration,...(command?{command}:{})});
      if(current!==generation)return;
      if(!accept(result,current))throw new Error('The party returned an invalid update.');
    }catch(error){
      if(current!==generation||operation?.signal.aborted)return;
      if(['WATCH_PARTY_NOT_FOUND','WATCH_PARTY_MEDIA_MISMATCH','WATCH_PARTY_DURATION_MISMATCH','WATCH_PARTY_PLAYBACK_REQUIRED','LOGIN_REQUIRED'].includes(error.code)){await leave({notify:false,notice:error.message});return;}
      if(command&&!pendingCommand)pendingCommand=command;
      connectionLost=true;failures++;pauseLocal();render();
    }finally{if(current===generation){inFlight=false;schedule(pendingCommand?0:Math.min(5000,800*Math.max(1,failures)));}}
  }
  function command(type,position){
    if(!room||!bound||!permitted()||preparing)return;
    pendingCommand={seq:++commandSeq,type,...(Number.isFinite(position)?{position}:{} )};
    schedule(0);
  }
  function attach(context){
    unbind();bound=context;buffering=false;blocked=false;playPending=false;
    videoAbort=new AbortController();const video=context.video;
    const listen=(name,handler)=>video.addEventListener(name,handler,{signal:videoAbort.signal});
    listen('loadedmetadata',()=>{pauseLocal();render();schedule(0);});
    listen('canplay',()=>{buffering=false;render();schedule(0);correct();});
    listen('waiting',()=>{if(!video.paused){buffering=true;pauseLocal();schedule(0);render();}});
    listen('stalled',()=>{if(!video.paused&&video.readyState<3){buffering=true;pauseLocal();schedule(0);render();}});
    listen('playing',()=>{buffering=false;blocked=false;render();if(unlocking)return;if(room?.state.playing&&!connectionLost&&!hidden())schedule(0);else pauseLocal();});
    listen('play',()=>{if(expectedPlays.length){expectedPlays.shift();return;}if(!connectionLost&&!hidden())command('play',video.currentTime);});
    listen('pause',()=>{if(expectedPauses>0){expectedPauses--;return;}if(!buffering&&!connectionLost&&!hidden()&&room?.state.playing&&!video.ended)command('pause',video.currentTime);});
    listen('seeking',()=>{userSeeking=!(Number.isFinite(expectedSeek)&&Math.abs(video.currentTime-expectedSeek)<.4);});
    listen('seeked',()=>{const publish=userSeeking;userSeeking=false;expectedSeek=null;buffering=false;if(publish)command('seek',video.currentTime);else schedule(0);});
    listen('ended',()=>command('pause',Math.max(0,video.duration||video.currentTime)));
    listen('error',()=>{blocked=true;pauseLocal();schedule(0);render();});
    pauseLocal();render();schedule(0);
  }
  function activate(result){
    const next=normalizePartySnapshot(result);if(!next)throw new Error('The party could not be read. Try a new invitation.');
    snapshot=next;room=next.room;selectedViewer=getViewer();invite=TOKEN.test(result.joinToken||'')?result.joinToken:'';
    commandSeq=0;pendingCommand=null;connectionLost=false;failures=0;
    if(invite){const url=new URL(location.href);url.search='';url.hash='party='+invite;$('party-link').value=url.href;}
    tickTimer=setInterval(correct,200);render();schedule(0);
    window.dispatchEvent(new CustomEvent('watch-party-start'));
  }
  async function create(){
    if(room||transitioning||!permitted())return;
    const context=getPlayback();if(!context?.playbackProof||!context.ready){message('Start a video, then create a party.',true);return;}
    const current=++generation;operation?.abort();operation=new AbortController();clock.reset();
    transitioning=true;render();internal(()=>context.video.pause());message('Creating your party…');
    try{
      const result=await call('create',{playbackProof:context.playbackProof,target:context.playbackContext?.current||null,title:context.playbackContext?.title||context.file.title,position:context.video.currentTime,duration:context.video.duration});
      if(current!==generation||!permitted())return;activate(result);attach(context);
    }catch(error){if(current===generation)message(error.message,true);}finally{if(current===generation){transitioning=false;render();}}
  }
  function invitation(value){
    value=String(value||'').trim();if(TOKEN.test(value))return value;
    try{const url=new URL(value),base=path=>path.replace(/index\.html$/,'').replace(/key\/$/,'');if(url.origin!==location.origin||url.username||url.password||url.search||base(url.pathname)!==base(location.pathname))return '';const m=/^#party=([A-Za-z0-9_-]{43})$/.exec(url.hash);return m?.[1]||'';}catch{return '';}
  }
  async function join(){
    if(room||transitioning||!permitted())return;
    const token=invitation($('party-join-code').value);if(!token){message('Paste a complete party invitation or code.',true);return;}
    const current=++generation;operation?.abort();operation=new AbortController();clock.reset();transitioning=true;render();message('Joining the party…');
    try{
      const result=await call('join',{token});if(current!==generation||!permitted())return;
      activate(result);preparing=true;render();pauseLocal();
      const prepared=await call('prepare',{roomId:room.id},{timeoutMs:65000});if(current!==generation||!room||!permitted())return;
      const ok=await playFile(prepared.file,{...prepared.playbackContext,watchPartyRoom:room.id,forceStartOver:true});
      if(current!==generation)return;
      if(!ok)throw new Error('The party video could not start on this device.');
      preparing=false;pendingInvite='';if(fromHash())history.replaceState(null,'',location.pathname+location.search);render();schedule(0);
      if(dialog.open)dialog.close();
    }catch(error){if(current===generation){if(room)await leave({notice:error.message});else message(error.message,true);}}finally{if(current===generation){transitioning=false;render();}}
  }
  async function ready(){
    if(!room||!bound?.ready||!permitted()||unlocking)return;
    const video=bound.video,current=generation;blocked=false;unlocking=true;render();let deadline;
    try{await Promise.race([playLocal(video),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Playback is still loading.')),4000);})]);if(current!==generation)return;buffering=false;}
    catch(error){if(current===generation){blocked=error.name==='NotAllowedError';buffering=!blocked;}}
    finally{clearTimeout(deadline);if(current===generation){unlocking=false;if(!room?.state.playing)pauseLocal();render();schedule(0);}}
  }
  async function leave({notify=true,notice='You left the watch party.',quiet=false}={}){
    const previous=room;generation++;operation?.abort();operation=null;cancelTimers();pauseLocal();unbind();room=null;snapshot=null;invite='';preparing=false;transitioning=false;pendingCommand=null;inFlight=false;blocked=false;connectionLost=false;playPending=false;clock.reset();render();
    if(!quiet)message(notice);
    if(previous&&notify)try{await call('leave',{roomId:previous.id},{signal:AbortSignal.timeout(5000),keepalive:true});}catch{}
  }
  function open(){refreshAccess();if(!isAllowed())return;if(!isSignedIn()){message('Connect TorBox on this device before joining a watch party.',true);return;}if(!dialog.open)dialog.showModal();render();}
  function refreshAccess(){
    $('open-watch-party').hidden=!isAllowed();$('player-watch-party').hidden=!isAllowed();
    if(!isAllowed()&&dialog.open)dialog.close();
    if(room&&!permitted())void leave({notice:'The party ended because the viewer changed.'});
    if(pendingInvite&&!inviteShown&&isSignedIn()&&isAllowed()){inviteShown=true;open();}
  }
  $('open-watch-party').addEventListener('click',open);$('player-watch-party').addEventListener('click',open);
  $('close-watch-party').addEventListener('click',()=>dialog.close());
  $('party-create').addEventListener('click',()=>void create());$('party-join').addEventListener('click',()=>void join());
  $('party-leave').addEventListener('click',()=>void leave());$('party-play').addEventListener('click',()=>command('play',bound?.video.currentTime));$('party-pause').addEventListener('click',()=>command('pause',bound?.video.currentTime));
  $('party-sync').addEventListener('click',()=>{correct();schedule(0);});$('party-ready').addEventListener('click',()=>void ready());$('party-resume').addEventListener('click',()=>void ready());
  $('party-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('party-link').value);message('Invitation copied. Send it to the other viewer.');}catch{$('party-link').focus();$('party-link').select();message('Select and copy the invitation above.');}});
  window.addEventListener('hashchange',()=>{const token=fromHash();if(token){pendingInvite=token;inviteShown=false;$('party-join-code').value=token;refreshAccess();}});
  document.addEventListener('visibilitychange',()=>{if(room){if(hidden())pauseLocal();schedule(0);}});
  window.addEventListener('pagehide',()=>{if(room)void leave({quiet:true});});
  setInterval(refreshAccess,1000);refreshAccess();
  return {isActive:()=>!!room,beforePlayback(context){if(!(room&&preparing&&context?.watchPartyRoom===room.id))void leave({quiet:!room,notice:'The party ended because the video changed.'});},onPlayback(context){if(room&&preparing&&context.playbackContext?.watchPartyRoom===room.id)attach(context);},mediaReady(context){if(room&&bound===context){pauseLocal();render();schedule(0);return true;}return false;},leave};
}

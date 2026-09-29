const BUILD='restored14';
const startedAt=Date.now();
let startupTimer=null;
const stageNode=()=>document.querySelector('#startup-stage');
const detailNode=()=>document.querySelector('#startup-detail');
const elapsedNode=()=>document.querySelector('#startup-elapsed');
function tickStartup(){
  const target=elapsedNode();if(!target)return;
  const seconds=Math.max(0,Math.floor((Date.now()-startedAt)/1000));
  target.textContent=seconds<2?'Starting…':`Working · ${seconds}s`;
}
function setStartupStage(stage,detail=''){
  const target=stageNode();if(target)target.textContent=stage;
  const secondary=detailNode();if(secondary)secondary.textContent=detail;
  tickStartup();
}
function stopStartupTimer(){if(startupTimer)clearInterval(startupTimer);startupTimer=null;}
globalThis.__torboxStartup={stage:setStartupStage,stop:stopStartupTimer,startedAt};
setStartupStage('Starting player…','Loading the app and waking the private player service.');
startupTimer=setInterval(tickStartup,1000);

async function refreshServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.register(`./sw.js?v=${BUILD}`,{updateViaCache:'none'});
    await registration.update().catch(()=>{});
  }catch{}
}
function warmBackend(){
  try{
    const origin=document.querySelector('meta[name="api-origin"]')?.content?.trim();
    if(!origin)return;
    fetch(new URL('/healthz',origin),{mode:'cors',cache:'no-store',signal:AbortSignal.timeout(65000)}).catch(()=>{});
  }catch{}
}
function showStartupFailure(){
  stopStartupTimer();
  setStartupStage('The player could not start.','Reload this page once. If it still fails, open the recovery link.');
  const panel=document.querySelector('#loading');if(!panel||document.querySelector('#startup-reload'))return;
  const button=document.createElement('button');button.id='startup-reload';button.type='button';button.className='primary';button.textContent='Reload';
  button.addEventListener('click',()=>location.reload());panel.append(button);
}

// Wake the backend immediately, but keep service-worker refresh off the critical startup path.
warmBackend();
setStartupStage('Loading player…','Connecting to the private player service.');
try{
  await import(`./app.js?v=${BUILD}`);
  void refreshServiceWorker();
}catch(error){
  console.error('player_boot_failed',error);
  void refreshServiceWorker();
  showStartupFailure();
}

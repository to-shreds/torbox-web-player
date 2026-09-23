const BUILD='restored11';
const loadingMessage=()=>document.querySelector('#loading p');
async function refreshServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  try{
    const registration=await navigator.serviceWorker.register(`./sw.js?v=${BUILD}`,{updateViaCache:'none'});
    await registration.update().catch(()=>{});
  }catch{}
}
function showStartupFailure(){
  const target=loadingMessage();if(!target)return;
  target.textContent='The player could not start. Reload this page once. If it still fails, open the latest recovery link.';
  const panel=document.querySelector('#loading');if(!panel||document.querySelector('#startup-reload'))return;
  const button=document.createElement('button');button.id='startup-reload';button.type='button';button.className='primary';button.textContent='Reload';
  button.addEventListener('click',()=>location.reload());panel.append(button);
}
await refreshServiceWorker();
try{await import(`./app.js?v=${BUILD}`);}catch(error){console.error('player_boot_failed',error);showStartupFailure();}
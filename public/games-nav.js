import {getKidProfile} from './parental-controls.js?v=release-1.2.2-games.4';
import {leaveSports} from './sports.js?v=release-1.2.2-games.4';

const $=id=>document.getElementById(id);
let generation=0;
function adult(){
  let viewer='viewer-1';
  try{viewer=localStorage.getItem('tw-viewer')||sessionStorage.getItem('tw-viewer')||viewer;}catch{}
  return !getKidProfile(viewer).enabled;
}
export function leaveGames(){
  generation++;
  window.dispatchEvent(new CustomEvent('games-tab-close'));
  document.body.classList.remove('games-active');
  $('games-panel').hidden=true;
  $('open-games').setAttribute('aria-pressed','false');
}
async function openGames(){
  if(!adult()){
    $('sports-nav-message').textContent='Switch to an adult viewer to open Games.';
    if(location.hash==='#games'){
      history.replaceState(null,'',location.pathname+location.search);
      $('open-cinema').click();
    }
    return;
  }
  leaveSports();
  const current=++generation;
  $('sports-nav-message').textContent='';
  document.body.classList.add('games-active');$('games-panel').hidden=false;
  $('open-games').setAttribute('aria-pressed','true');
  $('open-cinema').setAttribute('aria-pressed','false');
  $('open-sports').setAttribute('aria-pressed','false');
  if(!location.hash||location.hash==='#sports'||location.hash==='#games')history.replaceState(null,'',location.pathname+location.search+'#games');
  window.dispatchEvent(new CustomEvent('games-playback-start'));
  try{
    await import('./games.js?v=release-1.2.2-games.4');
    if(current!==generation||!document.body.classList.contains('games-active'))return;
    window.dispatchEvent(new CustomEvent('games-tab-open'));
  }catch{
    if(current===generation)$('games-message').textContent='Games could not start. Reload to retry.';
  }
}
$('open-games').addEventListener('click',()=>void openGames());
$('login-games').addEventListener('click',()=>void openGames());
$('open-cinema').addEventListener('click',()=>{
  leaveGames();
  if(location.hash==='#games')history.replaceState(null,'',location.pathname+location.search);
});
window.addEventListener('sports-tab-open',leaveGames);
window.addEventListener('hashchange',()=>{
  if(location.hash==='#games')void openGames();
  else if(document.body.classList.contains('games-active')){
    leaveGames();
    if(location.hash==='#sports')$('open-sports').click();
    else $('open-cinema').click();
  }
});
if(location.hash==='#games')void openGames();

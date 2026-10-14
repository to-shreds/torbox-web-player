import {extraPlayerUrl, extraKeyCommand, readExtraStatus} from './extra-games-core.js?v=release-1.2.2-games.4';
import {getKidProfile} from './parental-controls.js?v=release-1.2.2-games.4';

const $ = id => document.getElementById(id);
const dialog = $('extra-game-player');
let frame = $('extra-game-frame');
let selection = null, tabOpen = false, generation = 0, deadline = null, viewerTimer = null, muted = false, muteSent = null;
let pauseIntent = false, pauseSent = false;
let extraFullscreenOwned = false;
const held = new Map();
function viewer() {
  try { const value = localStorage.getItem('tw-viewer') || sessionStorage.getItem('tw-viewer'); return ['viewer-1','viewer-2'].includes(value) ? value : 'viewer-1'; }
  catch { return 'viewer-1'; }
}
function adult() { return !getKidProfile(viewer()).enabled; }
function permitted() { return tabOpen && adult() && selection?.viewer === viewer(); }
function state(value, message) {
  dialog.dataset.state = value;
  if (message !== undefined) $('extra-game-message').textContent = message;
  $('extra-game-pause').textContent = value === 'playing' ? 'Pause' : 'Resume';
  $('extra-game-pause').disabled = !['playing','paused'].includes(value);
  $('extra-game-restart').disabled = !selection;
  $('extra-game-mute').disabled = !['playing','paused'].includes(value);
}
function post(command, fields = {}) {
  if (selection && frame.contentWindow) frame.contentWindow.postMessage({type:'torbox-extra-command',command,...fields},location.origin);
}
function muteChild() {
  if (!selection || !frame.contentWindow || (muteSent?.target === frame.contentWindow && muteSent.muted === muted)) return;
  muteSent = {target:frame.contentWindow,muted}; post('mute',{muted});
}
function releaseKeys() {
  for (const key of held.keys()) post('key',{key,pressed:false});
  held.clear();
  for (const button of $('extra-game-touch').children) button.classList.remove('is-pressed');
}
function keySource(code, source, pressed) {
  if (pressed) {
    if (!permitted() || dialog.dataset.state !== 'playing') return;
    let sources = held.get(code);
    if (!sources) { sources = new Set(); held.set(code,sources); }
    if (!sources.size) frame.contentWindow?.postMessage(extraKeyCommand(code,true),location.origin);
    sources.add(source);
  } else {
    const sources = held.get(code); if (!sources) return;
    sources.delete(source);
    if (!sources.size) { post('key',{key:code,pressed:false}); held.delete(code); }
  }
}
function checkViewer() {
  if (selection && !permitted()) { closeExtraGame(); $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return false; }
  return !!selection;
}
export function pauseExtraGame() {
  if (!selection) return;
  pauseIntent = true; pauseSent = dialog.dataset.state !== 'loading';
  releaseKeys(); post('pause');
  if (dialog.dataset.state !== 'error' && dialog.dataset.state !== 'loading') state('paused','Paused. Press Resume to continue.');
}
export function closeExtraGame() {
  releaseKeys(); post('close'); generation++; clearTimeout(deadline); clearInterval(viewerTimer); deadline = null; viewerTimer = null;
  selection = null; frame.removeAttribute('src');
  if (dialog.open) dialog.close();
  const ownedFullscreen = extraFullscreenOwned;
  extraFullscreenOwned = false; document.body.classList.remove('extra-game-fullscreen');
  if (ownedFullscreen && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
  state('closed',''); dialog.dataset.frames = '0';
}
function renderKeys(item) {
  $('extra-game-touch').replaceChildren(...item.keys.map(binding => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'extra-game-key'; button.textContent = binding.label; button.dataset.extraKey = String(binding.code);
    button.addEventListener('pointerdown',event => {
      if (!checkViewer() || dialog.dataset.state !== 'playing') return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); button.classList.add('is-pressed'); keySource(binding.code,'pointer:'+event.pointerId,true);
    });
    for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,event => { keySource(binding.code,'pointer:'+event.pointerId,false); if (!held.has(binding.code)) button.classList.remove('is-pressed'); });
    button.addEventListener('keydown',event => { if (!['Enter',' '].includes(event.key) || event.repeat) return; event.preventDefault(); keySource(binding.code,'button:'+binding.code,true); button.classList.toggle('is-pressed',held.has(binding.code)); });
    button.addEventListener('keyup',event => { if (!['Enter',' '].includes(event.key)) return; event.preventDefault(); keySource(binding.code,'button:'+binding.code,false); button.classList.toggle('is-pressed',held.has(binding.code)); });
    button.addEventListener('blur',() => { keySource(binding.code,'button:'+binding.code,false); if (!held.has(binding.code)) button.classList.remove('is-pressed'); });
    button.addEventListener('contextmenu',event => event.preventDefault());
    return button;
  }));
  $('extra-game-touch').hidden = !item.keys.length;
}
function mount(item) {
  const current = generation;
  pauseSent = false;
  muteSent = null;
  const nextFrame = document.createElement('iframe'); nextFrame.id = 'extra-game-frame'; nextFrame.title = item.title; nextFrame.allow = 'autoplay; fullscreen'; nextFrame.allowFullscreen = true;
  frame.replaceWith(nextFrame); frame = nextFrame;
  frame.addEventListener('error',() => { if (current === generation) fail('The game could not open. Choose Restart to try again.'); });
  frame.src = extraPlayerUrl(item);
  clearTimeout(deadline); deadline = setTimeout(() => { if (current === generation && dialog.dataset.state === 'loading') fail('The game did not open in time. Choose Restart to try again.'); },25000);
}
function fail(message) {
  clearTimeout(deadline); deadline = null; releaseKeys(); post('pause'); state('error',message);
}
export function playExtraGame(item) {
  if (!tabOpen || !adult()) { $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return; }
  const url = extraPlayerUrl(item); // Validate before replacing an active game.
  closeExtraGame(); selection = {item,viewer:viewer(),url};
  pauseIntent = document.hidden || !document.hasFocus();
  $('extra-game-title').textContent = item.title; $('extra-game-platform').textContent = item.platform === 'dos' ? 'DOS' : 'BROWSER';
  $('extra-game-controls').textContent = item.controls; $('extra-game-license').textContent = item.license;
  $('extra-game-source').href = item.source;
  $('extra-game-mute').textContent = muted ? 'Unmute' : 'Mute'; $('extra-game-mute').setAttribute('aria-pressed',String(muted));
  renderKeys(item); state('loading','Opening game…'); dialog.dataset.frames = '0';
  if (!dialog.open) dialog.showModal();
  window.dispatchEvent(new CustomEvent('games-playback-start'));
  mount(item); viewerTimer = setInterval(checkViewer,1000);
}
window.addEventListener('message',event => {
  if (!selection || !dialog.open) return;
  const message = readExtraStatus(event,frame.contentWindow,location.origin);
  if (!message || !checkViewer()) return;
  if (dialog.dataset.state === 'error' && message.state !== 'error') return;
  if (message.state !== 'loading') { clearTimeout(deadline); deadline = null; }
  if (message.state === 'playing' && pauseIntent) {
    releaseKeys();
    if (!pauseSent) { pauseSent = true; post('pause'); }
    muteChild(); state('paused','Paused. Press Resume to continue.'); dialog.dataset.frames = String(message.frames);
    return;
  }
  if (message.state !== 'playing') releaseKeys();
  state(message.state,message.message); dialog.dataset.frames = String(message.frames);
  if (message.state === 'playing' || message.state === 'paused') muteChild();
});
function resumeExtraGame() {
  if (!checkViewer()) return;
  pauseIntent = false; pauseSent = false;
  frame.focus(); post('resume');
}
function restartExtraGame() {
  if (!checkViewer()) return;
  const item = selection.item;
  releaseKeys(); post('close'); generation++;
  state('loading','Restarting game…'); dialog.dataset.frames = '0'; mount(item);
}
$('close-extra-game-player').addEventListener('click',closeExtraGame);
dialog.addEventListener('cancel',event => { event.preventDefault(); closeExtraGame(); });
$('extra-game-pause').addEventListener('click',() => { if (!checkViewer()) return; if (dialog.dataset.state === 'playing') pauseExtraGame(); else resumeExtraGame(); });
$('extra-game-restart').addEventListener('click',restartExtraGame);
$('extra-game-mute').addEventListener('click',() => {
  if (!checkViewer()) return;
  muted = !muted; $('extra-game-mute').textContent = muted ? 'Unmute' : 'Mute'; $('extra-game-mute').setAttribute('aria-pressed',String(muted)); muteChild();
});
$('extra-game-fullscreen').addEventListener('click',() => {
  if (!checkViewer()) return;
  const current = generation;
  const wasPlaying = dialog.dataset.state === 'playing' && !pauseIntent;
  if (extraFullscreenOwned && document.fullscreenElement === document.documentElement) { void document.exitFullscreen().catch(() => { if (current === generation) $('extra-game-message').textContent = 'Full screen could not close. Use your browser\'s exit full screen control.'; }); return; }
  if (!document.documentElement.requestFullscreen) { $('extra-game-message').textContent = 'Full screen is unavailable in this browser. Rotate your device for a wider layout.'; return; }
  extraFullscreenOwned = true;
  void document.documentElement.requestFullscreen().then(() => {
    if (current !== generation || !dialog.open || !permitted()) {
      extraFullscreenOwned = false; document.body.classList.remove('extra-game-fullscreen');
      if (document.fullscreenElement === document.documentElement && !document.body.classList.contains('nes-game-fullscreen')) void document.exitFullscreen().catch(() => {});
      return;
    }
    document.body.classList.toggle('extra-game-fullscreen',document.fullscreenElement === document.documentElement);
    // Keep the active iframe intact, but move its modal above the fullscreen
    // root in the top layer so the actual game remains visible.
    if (document.fullscreenElement === document.documentElement) {
      releaseKeys(); dialog.close(); dialog.showModal();
      if (wasPlaying && !document.hidden && document.hasFocus()) { pauseIntent = false; pauseSent = false; frame.focus(); post('resume'); }
    }
  }).catch(() => { extraFullscreenOwned = false; document.body.classList.remove('extra-game-fullscreen'); if (current === generation) $('extra-game-message').textContent = 'Full screen is unavailable. Rotate your device for a wider layout.'; });
});
document.addEventListener('fullscreenchange',() => {
  if (document.fullscreenElement !== document.documentElement) extraFullscreenOwned = false;
  document.body.classList.toggle('extra-game-fullscreen',extraFullscreenOwned && dialog.open && document.fullscreenElement === document.documentElement);
});
for (const id of ['extra-game-pause','extra-game-restart','extra-game-mute','extra-game-fullscreen']) $(id).addEventListener('pointerdown',event => event.preventDefault());
window.addEventListener('games-tab-open',() => { tabOpen = adult(); });
window.addEventListener('games-tab-close',() => { tabOpen = false; closeExtraGame(); });
for (const type of ['cinema-playback-start','sports-playback-start']) window.addEventListener(type,closeExtraGame);
document.addEventListener('visibilitychange',() => { if (document.hidden) pauseExtraGame(); });
window.addEventListener('blur',() => queueMicrotask(() => { if (!document.hasFocus()) pauseExtraGame(); }));
window.addEventListener('storage',event => { if (['tw-viewer','torbox-parental-controls-v1'].includes(event.key)) checkViewer(); });
window.addEventListener('pagehide',closeExtraGame);

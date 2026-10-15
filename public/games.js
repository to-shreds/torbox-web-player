import {ENGINE_ASSET_VERSION, MAX_ROM_BYTES, MAX_CATALOG_BYTES, cleanGamesCatalog, validateRom, romHash, saveIdentity, makeSaveRecord, validSaveRecord, fetchBytes, createStateStore} from './games-core.js?v=release-1.2.5-search.1';
import {getKidProfile} from './parental-controls.js?v=release-1.2.5-search.1';
import {nesPointerPosition} from './games-pointer.js?v=release-1.2.5-search.1';
import {emptyCheats, normalizeCheatSet, parseCheatLines, applyCheats, readCheats, writeCheats, importCheats, exportCheats} from './games-cheats.js?v=release-1.2.5-search.1';
import {cleanExtraGamesCatalog} from './extra-games-core.js?v=release-1.2.5-search.1';
import {playExtraGame, closeExtraGame} from './extra-games.js?v=release-1.2.5-search.1';

const $ = id => document.getElementById(id);
const dialog = $('games-player');
const canvas = $('games-canvas');
const context = canvas.getContext('2d', {alpha: false});
const image = context.createImageData(256, 240);
const pixels = new Uint32Array(image.data.buffer);
const store = createStateStore();
const cheatsPanel = $('games-cheats-panel');
let cheatSet = emptyCheats(), editingCheat = null;
let catalog = null, extraCatalog = null, catalogPromise = null, enginePromise = null;
let catalogError = false, extraCatalogError = false;
let tabOpen = false, generation = 0, actionGeneration = 0, abort = null;
let nes = null, selection = null, running = false, fatal = false, resumeSaved = null;
let nesFullscreenOwned = false;
let frameRequest = 0, frameCount = 0, lastFrame = 0, accumulator = 0, saveTimer = null;
let saveTail = Promise.resolve(), soundEnabled = true, sound = null;
let zapperEnabled = false, zapperReleaseTimer = null, zapperStartedAt = 0;
const zapperPointers = new Set();
const held = new Map();
const pointerKeys = new Map();
const activePointers = new Set();
const keys = new Map([
  ['ArrowUp',[1,4]],['ArrowDown',[1,5]],['ArrowLeft',[1,6]],['ArrowRight',[1,7]],['KeyX',[1,0]],['KeyZ',[1,1]],['Enter',[1,3]],['ShiftLeft',[1,2]],['ShiftRight',[1,2]],
  ['KeyI',[2,4]],['KeyK',[2,5]],['KeyJ',[2,6]],['KeyL',[2,7]],['KeyN',[2,0]],['KeyM',[2,1]],['Digit8',[2,3]],['Digit7',[2,2]],
]);

function viewer() {
  try { const value = localStorage.getItem('tw-viewer') || sessionStorage.getItem('tw-viewer'); return ['viewer-1','viewer-2'].includes(value) ? value : 'viewer-1'; }
  catch { return 'viewer-1'; }
}
function adult() { return !getKidProfile(viewer()).enabled; }
function status(message) { $('games-player-message').textContent = message; }
function state(value) { dialog.dataset.state = value; }
function textFocused(target) { return target?.closest?.('input,textarea,select,[contenteditable="true"]') || target?.isContentEditable; }
function actionKey(event) { return event.code === 'Enter' && event.target?.closest?.('button,a,summary'); }
function controls(enabled) { for (const id of ['games-pause','games-save','games-load','games-start-fresh','games-zapper','games-cheats']) if ($(id)) $(id).disabled = !enabled; }
function clearScreen() { pixels.fill(0xff000000); context.putImageData(image, 0, 0); canvas.dataset.frames = '0'; }

class AudioOutput {
  constructor() {
    this.context = null; this.node = null; this.closed = false;
    this.left = new Float32Array(512); this.right = new Float32Array(512); this.at = 0;
    this.ready = Promise.resolve();
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error();
      this.context = new AudioContextClass();
      if (!this.context.audioWorklet) throw new Error();
      this.ready = this.context.audioWorklet.addModule('./vendor/nes-audio-worklet.js?v=release-1.2.5-search.1').then(() => {
        if (this.closed) return;
        this.node = new AudioWorkletNode(this.context, 'torbox-nes-audio', {outputChannelCount:[2]});
        this.node.connect(this.context.destination);
      }).catch(() => { if (!this.closed) $('games-audio-message').textContent = 'Audio is unavailable in this browser. The game still works.'; });
      void this.context.resume().catch(() => {});
    } catch { $('games-audio-message').textContent = 'Audio is unavailable in this browser. The game still works.'; }
  }
  write(left, right) {
    if (!this.node || !running || !soundEnabled) return;
    this.left[this.at] = left; this.right[this.at] = right;
    if (++this.at === this.left.length) this.flush();
  }
  flush() {
    if (this.at && this.node) this.node.port.postMessage({type:'samples',left:this.left.slice(0,this.at),right:this.right.slice(0,this.at)});
    this.at = 0;
  }
  clear() { this.at = 0; this.node?.port.postMessage({type:'clear'}); }
  resume() { if (soundEnabled && this.context && !this.closed) void this.context.resume().catch(() => { $('games-audio-message').textContent = 'Tap a game control or Unmute to enable sound.'; }); }
  pause() { this.clear(); if (this.context && !this.closed) void this.context.suspend().catch(() => {}); }
  close() { this.closed = true; this.clear(); this.node?.disconnect(); if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {}); }
}

function ensureEngine() {
  if (window.jsnes?.NES) return Promise.resolve(window.jsnes);
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('The NES engine did not load. Close the game and try again.')); }, 10000);
    script.src = `./vendor/jsnes-${ENGINE_ASSET_VERSION}.min.js?v=${ENGINE_ASSET_VERSION}`;
    script.onload = () => { clearTimeout(timer); if (window.jsnes?.NES) resolve(window.jsnes); else reject(new Error('The NES engine could not start.')); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('The NES engine could not load. Close the game and try again.')); };
    document.head.appendChild(script);
  }).catch(error => { enginePromise = null; throw error; });
  return enginePromise;
}

function input(source, player, button, pressed) {
  const key = `${player}:${button}`;
  let sources = held.get(key);
  if (pressed) {
    if (!running || !nes) return;
    if (!sources) { sources = new Set(); held.set(key, sources); }
    if (!sources.size) nes.buttonDown(player, button);
    sources.add(source);
  } else if (sources) {
    sources.delete(source);
    if (!sources.size) { nes?.buttonUp(player, button); held.delete(key); }
  }
}
function releaseSource(source) {
  for (const [key, sources] of [...held]) if (sources.has(source)) { const [player,button] = key.split(':').map(Number); input(source,player,button,false); }
}
function releaseInputs() {
  if (nes) for (let player = 1; player <= 2; player++) for (let button = 0; button < 10; button++) nes.buttonUp(player,button);
  held.clear(); pointerKeys.clear(); activePointers.clear();
  resetZapper();
  for (const button of dialog.querySelectorAll('.games-touch-key')) button.classList.remove('is-pressed');
}
function resetZapper() {
  clearTimeout(zapperReleaseTimer); zapperReleaseTimer = null; zapperPointers.clear();
  nes?.zapperFireUp();
  nes?.zapperMove(zapperEnabled ? -1 : null,zapperEnabled ? -1 : null);
}
function showZapperMode() {
  canvas.classList.toggle('games-zapper-active',zapperEnabled);
  if ($('games-zapper')) {
    $('games-zapper').setAttribute('aria-pressed',String(zapperEnabled));
    $('games-zapper').textContent = zapperEnabled ? 'Light gun: On' : 'Light gun: Off';
  }
}
function aimZapper(event) {
  const position = nesPointerPosition(canvas.getBoundingClientRect(),event.clientX,event.clientY);
  nes?.zapperMove(position?.x ?? -1,position?.y ?? -1);
  return position;
}
function finishZapperPointer(event) {
  if (!zapperPointers.has(event.pointerId)) return;
  zapperPointers.delete(event.pointerId);
  if (zapperPointers.size) return;
  // Keep a quick tap visible to the next emulated controller read.
  clearTimeout(zapperReleaseTimer);
  const delay = Math.max(0,100-(performance.now()-zapperStartedAt));
  zapperReleaseTimer = setTimeout(() => { zapperReleaseTimer = null; if (!zapperPointers.size) nes?.zapperFireUp(); },delay);
}
function gamepads() {
  const activeSources = new Set();
  const pads = Array.from(navigator.getGamepads?.() || []).filter(pad => pad?.connected && pad.mapping === 'standard').slice(0,2);
  const map = [[0,0],[1,1],[8,2],[9,3],[12,4],[13,5],[14,6],[15,7]];
  for (let index = 0; index < pads.length; index++) {
    const pad = pads[index], player = index + 1;
    for (const [physical, button] of map) {
      const source = `pad:${pad.index}:player:${player}:button:${physical}`;
      if (pad.buttons[physical]?.pressed) { activeSources.add(source); input(source,player,button,true); }
    }
    for (const [axis, limit, button] of [[0,-.45,6],[0,.45,7],[1,-.45,4],[1,.45,5]]) {
      const source = `pad:${pad.index}:player:${player}:axis:${button}`;
      const value = pad.axes[axis] || 0;
      if (limit < 0 ? value < limit : value > limit) { activeSources.add(source); input(source,player,button,true); }
    }
  }
  for (const sources of held.values()) for (const source of [...sources]) if (source.startsWith('pad:') && !activeSources.has(source)) releaseSource(source);
}

function draw(buffer) {
  for (let i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | buffer[i];
  context.putImageData(image,0,0);
  canvas.dataset.frames = String(++frameCount);
}
function frame(timestamp) {
  if (!running || !nes) return;
  if (!adult() || selection?.viewer !== viewer()) { closeGame(); $('games-message').textContent = 'Open Games with an adult viewer to continue.'; return; }
  gamepads();
  accumulator += Math.min(lastFrame ? timestamp - lastFrame : 1000/60, 80);
  lastFrame = timestamp;
  let count = 0;
  try {
    while (accumulator >= 1000/60 && count++ < 3) { nes.frame(); accumulator -= 1000/60; }
    if (accumulator > 1000/60 * 3) accumulator = 0;
    sound?.flush();
  } catch {
    fatal = true; pauseGame({save:false}); state('error');
    $('games-pause').disabled = true; $('games-save').disabled = true;
    status('This game stopped because the emulator could not run it. Try Start fresh or another ROM version.');
    return;
  }
  frameRequest = requestAnimationFrame(frame);
}

function saveGame(slot = 'auto', announce = false) {
  if (!nes || !selection?.identity || fatal || !frameCount) { if (announce) status('Play the game before saving a new manual slot.'); return Promise.resolve(false); }
  let record;
  try { record = makeSaveRecord(selection.viewer, selection.hash, nes.toJSON()); }
  catch { if (announce) status('This game could not be saved. Try again.'); return Promise.resolve(false); }
  const identity = selection.identity, current = generation;
  saveTail = saveTail.catch(() => {}).then(() => store.put(identity,record,slot)).then(() => {
    if (announce && current === generation) status('Game saved. Load save restores this manual slot.');
    return true;
  }).catch(error => {
    if (current === generation) { $('games-audio-message').textContent = 'Saves are unavailable: '+error.message; if (announce) status('The game is running, but it could not be saved.'); }
    return false;
  });
  return saveTail;
}
function pauseGame({save = true} = {}) {
  const wasRunning = running;
  running = false; cancelAnimationFrame(frameRequest); frameRequest = 0;
  clearInterval(saveTimer); saveTimer = null; releaseInputs(); sound?.pause();
  if (nes && !fatal) { state('paused'); $('games-pause').textContent = 'Resume'; if (wasRunning) status('Paused. Press Resume to continue.'); }
  if (save && wasRunning) void saveGame();
}
function startGame() {
  if (!tabOpen || !adult() || selection?.viewer !== viewer()) { closeGame(); $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return; }
  if (!nes || fatal || running || document.hidden || !cheatsPanel.hidden) return;
  actionGeneration++;
  if (resumeSaved) {
    try { nes.fromJSON(resumeSaved.state); applyCheats(nes,cheatSet); resumeSaved = null; }
    catch { resumeSaved = null; nes.reloadROM(); applyCheats(nes,cheatSet); status('The saved game could not resume. Started from the beginning.'); }
  }
  releaseInputs(); running = true; lastFrame = 0; accumulator = 0;
  state('playing'); $('games-pause').textContent = 'Pause';
  status('Playing. Progress saves automatically on this browser.');
  sound?.resume();
  saveTimer = setInterval(() => { if (running) void saveGame(); },15000);
  frameRequest = requestAnimationFrame(frame);
}
export function closeGame() {
  closeExtraGame();
  pauseGame(); generation++; actionGeneration++; abort?.abort(); abort = null;
  sound?.close(); sound = null; nes = null; selection = null; resumeSaved = null; fatal = false;
  zapperEnabled = false; showZapperMode();
  hideCheats(); cheatSet = emptyCheats(); cancelCheatEdit(); $('games-cheat-list').replaceChildren(); $('games-cheat-message').textContent = '';
  controls(false); state('closed'); delete dialog.dataset.saveKey;
  if (dialog.open) dialog.close();
  const ownedFullscreen = nesFullscreenOwned;
  nesFullscreenOwned = false; document.body.classList.remove('nes-game-fullscreen');
  if (ownedFullscreen && document.fullscreenElement === document.documentElement) void document.exitFullscreen().catch(() => {});
}

async function play(item, file = null) {
  if (!adult() || !tabOpen) { $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return; }
  closeGame();
  const current = generation, selectedViewer = viewer();
  abort = new AbortController(); const signal = abort.signal;
  selection = {title:item.title,viewer:selectedViewer};
  $('games-playing-title').textContent = item.title;
  $('games-audio-message').textContent = ''; clearScreen(); controls(false); frameCount = 0;
  state('loading'); status('Opening game…');
  if (!dialog.open) dialog.showModal();
  window.dispatchEvent(new CustomEvent('games-playback-start'));
  // Create audio in the initiating tap, before asynchronous ROM loading.
  sound = new AudioOutput();
  try {
    const engineTask = ensureEngine();
    const bytesTask = file ? file.arrayBuffer().then(buffer => new Uint8Array(buffer)) : fetchBytes('./'+item.rom,{signal});
    const [engine, bytes] = await Promise.all([engineTask,bytesTask]);
    if (current !== generation) return;
    const valid = validateRom(bytes);
    const hash = await romHash(valid.bytes);
    if (current !== generation) return;
    if (!tabOpen || !adult() || selectedViewer !== viewer()) { closeGame(); $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return; }
    selection = {title:item.title,viewer:selectedViewer,hash,identity:saveIdentity(selectedViewer,hash)};
    dialog.dataset.saveKey = selection.identity;
    cheatSet = readCheats(selection.identity);
    nes = new engine.NES({onFrame:draw,onAudioSample:(left,right) => sound?.write(left,right),sampleRate:sound?.context?.sampleRate || 48000});
    nes.loadROM(valid.bytes);
    applyCheats(nes,cheatSet);
    await saveTail;
    let saved = null;
    try { saved = await store.get(selection.identity); }
    catch (error) { if (current === generation) $('games-audio-message').textContent = 'Saves are unavailable: '+error.message; }
    if (current !== generation || !tabOpen || !adult() || selectedViewer !== viewer()) { if (current === generation) closeGame(); return; }
    controls(true); canvas.focus({preventScroll:true});
    if (validSaveRecord(saved,selectedViewer,hash)) {
      resumeSaved = saved; state('paused'); $('games-pause').textContent = 'Resume'; sound?.pause();
      status('Saved progress found. Press Resume to continue or Start fresh to begin again.');
    } else startGame();
  } catch (error) {
    if (current !== generation || signal.aborted) return;
    pauseGame({save:false}); fatal = true; nes = null; controls(false); state('error');
    status(error.name === 'TimeoutError' ? 'The game did not load in time. Close it and try again.' : error.message || 'The game could not load. Close it and try another file.');
  }
}

async function loadManual() {
  if (!nes || !selection || !adult()) return;
  const current = generation, action = ++actionGeneration, identity = selection.identity, selectedViewer = selection.viewer, hash = selection.hash;
  pauseGame(); $('games-load').disabled = true; status('Loading saved game…');
  try {
    await saveTail;
    const record = await store.get(identity,'manual');
    if (current !== generation || action !== actionGeneration) return;
    if (!validSaveRecord(record,selectedViewer,hash)) { status('No manual save exists for this game and viewer. Press Resume to continue.'); return; }
    nes.fromJSON(record.state); applyCheats(nes,cheatSet); fatal = false; resumeSaved = null; releaseInputs(); controls(true);
    if (!cheatsPanel.hidden) pauseGame({save:false});
    startGame();
    status('Loaded your manual save.');
  } catch { if (current === generation && action === actionGeneration) status('This save could not load. Press Resume or Start fresh.'); }
  finally { if (current === generation) $('games-load').disabled = !nes; }
}
function freshGame() {
  if (!nes || !adult()) return;
  actionGeneration++;
  pauseGame({save:false}); resumeSaved = null; fatal = false;
  try { nes.reloadROM(); applyCheats(nes,cheatSet); frameCount = 0; controls(true); clearScreen(); if (!cheatsPanel.hidden) pauseGame({save:false}); startGame(); if (!cheatsPanel.hidden) status('Started fresh. Finish editing codes, then press Resume.'); }
  catch { fatal = true; controls(false); state('error'); status('This ROM could not restart. Close it and try another game.'); }
}

function hideCheats() {
  actionGeneration++;
  cheatsPanel.hidden = true; $('games-cheats').setAttribute('aria-expanded','false'); dialog.classList.remove('games-cheats-open');
}
function cancelCheatEdit() {
  actionGeneration++;
  editingCheat = null; $('games-cheat-name').value = ''; $('games-cheat-codes').value = '';
  $('games-cheat-submit').textContent = 'Add codes'; $('games-cheat-cancel-edit').hidden = true;
}
function canEditCheats() {
  if (!nes || !selection?.identity) return false;
  if (!adult() || selection.viewer !== viewer()) { closeGame(); $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return false; }
  return true;
}
function renderCheats() {
  $('games-cheats-enabled').checked = cheatSet.enabled;
  const active = cheatSet.enabled ? cheatSet.codes.filter(row => row.enabled).length : 0;
  $('games-cheat-count').textContent = `${active} active / ${cheatSet.codes.length} saved ${cheatSet.codes.length === 1 ? 'code' : 'codes'}`;
  $('games-cheats-clear').disabled = !cheatSet.codes.length;
  $('games-cheat-list').replaceChildren(...cheatSet.codes.map((entry,index) => {
    const row = document.createElement('div'); row.className = 'games-cheat-row'; row.dataset.cheatCode = entry.code;
    const label = document.createElement('label'); label.className = 'games-cheat-toggle';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.className = 'games-cheat-enabled'; toggle.checked = entry.enabled;
    toggle.setAttribute('aria-label','Enable '+(entry.name || entry.code));
    const content = document.createElement('span'); content.className = 'games-cheat-copy';
    const name = document.createElement('strong'); name.textContent = entry.name || `Code ${index+1}`;
    const code = document.createElement('code'); code.textContent = entry.code; content.append(name,code); label.append(toggle,content);
    toggle.addEventListener('change',() => setCheats({...cheatSet,codes:cheatSet.codes.map((item,i) => i === index ? {...item,enabled:toggle.checked} : item)},'Code updated.'));
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'games-cheat-edit'; edit.textContent = 'Edit';
    edit.addEventListener('click',() => { actionGeneration++; editingCheat = entry.code; $('games-cheat-name').value = entry.name; $('games-cheat-codes').value = entry.code; $('games-cheat-submit').textContent = 'Save change'; $('games-cheat-cancel-edit').hidden = false; $('games-cheat-codes').focus(); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'games-cheat-remove'; remove.textContent = 'Remove';
    remove.addEventListener('click',() => { setCheats({...cheatSet,codes:cheatSet.codes.filter((_,i) => i !== index)},'Code removed.'); if (editingCheat === entry.code) cancelCheatEdit(); });
    row.append(label,edit,remove); return row;
  }));
}
function setCheats(raw, message = 'Codes saved.') {
  if (!canEditCheats()) return false;
  actionGeneration++;
  try {
    const model = normalizeCheatSet(raw);
    applyCheats(nes,model); cheatSet = model; renderCheats();
    try { writeCheats(selection.identity,model); $('games-cheat-message').textContent = message+(model.enabled ? '' : ' Cheats are off until you enable them.'); }
    catch { $('games-cheat-message').textContent = 'Codes applied for this session, but this browser could not save them.'; }
    return true;
  } catch (error) { renderCheats(); $('games-cheat-message').textContent = error.message || 'These codes could not be applied.'; return false; }
}
function openCheats() {
  if (!canEditCheats()) return;
  actionGeneration++; pauseGame();
  cheatsPanel.hidden = false; $('games-cheats').setAttribute('aria-expanded','true'); dialog.classList.add('games-cheats-open');
  $('games-cheat-message').textContent = ''; renderCheats();
  status('Paused for Game Genie. Press Resume when you are finished.');
  $('games-cheat-codes').focus({preventScroll:true}); dialog.scrollTop = 0;
}
function resumeFromCheats() {
  if (!canEditCheats()) return;
  hideCheats(); canvas.focus({preventScroll:true}); startGame();
  if (fatal) status('This game stopped. Choose Start fresh to restart it with your current codes.');
}
async function importCheatFile(file) {
  if (!file || !canEditCheats()) return;
  if (file.size > 64*1024) { $('games-cheat-message').textContent = 'Choose a code JSON file no larger than 64 KiB.'; return; }
  const current = generation, identity = selection.identity, action = ++actionGeneration;
  let timer;
  try {
    $('games-cheat-message').textContent = 'Importing codes…';
    const text = await Promise.race([file.text(),new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('The code file did not load in time. Try again.')),10000); })]);
    if (current !== generation || action !== actionGeneration || selection?.identity !== identity) return;
    const model = importCheats(text);
    if (setCheats(model,'Code list imported.')) cancelCheatEdit();
  } catch (error) { if (current === generation && action === actionGeneration && selection?.identity === identity) $('games-cheat-message').textContent = error.message || 'This code file could not import.'; }
  finally { clearTimeout(timer); }
}

function render() {
  const query = $('games-search').value.trim().toLocaleLowerCase();
  const platform = $('games-platform').value;
  const all = [...(catalog?.items || []).map(item => ({...item,platform:'nes'})),...(extraCatalog?.items || [])];
  const items = all.filter(item => (platform === 'all' || platform === item.platform) && item.title.toLocaleLowerCase().includes(query)).sort((a,b) => a.title.localeCompare(b.title,undefined,{sensitivity:'base'}) || a.id.localeCompare(b.id));
  $('games-grid').replaceChildren(...items.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'games-card'; button.dataset.gameId = item.id; button.dataset.gamePlatform = item.platform;
    const badge = document.createElement('span'); badge.className = 'eyebrow'; badge.textContent = item.platform === 'web' ? 'BROWSER' : item.platform.toUpperCase();
    const title = document.createElement('strong'); title.textContent = item.title;
    button.append(badge,title); button.addEventListener('click',() => { if (item.platform === 'nes') void play(item); else { closeGame(); playExtraGame(item); } }); return button;
  }));
  $('games-count').textContent = catalog || extraCatalog ? `${items.length} ${items.length === 1 ? 'game' : 'games'}` : '';
  $('games-message').textContent = catalogError ? 'The NES game list could not load. Press Refresh, or open a NES file from your device.' : items.length ? '' : all.length ? 'No matching games. Try another search or platform.' : catalog || extraCatalog ? 'No games have been added yet. Open a .nes game file from your device to play.' : 'Loading games…';
  $('games-extra-message').textContent = extraCatalogError ? 'DOS and browser games could not load. Press Refresh to try again.' : '';
}
async function loadCatalog() {
  if (catalog && extraCatalog) { render(); return; }
  if (catalogPromise) return catalogPromise;
  catalogPromise = (async () => {
    render();
    const tasks = [];
    if (!catalog) tasks.push((async () => { try {
      const bytes = await fetchBytes('./games-catalog.json?v=release-1.2.5-search.1',{maxBytes:MAX_CATALOG_BYTES,timeoutMs:10000});
      catalog = cleanGamesCatalog(JSON.parse(new TextDecoder().decode(bytes))); catalogError = false;
    } catch { catalogError = true; } finally { render(); } })());
    if (!extraCatalog) tasks.push((async () => { try {
      const bytes = await fetchBytes('./extra-games-catalog.json?v=release-1.2.5-search.1',{maxBytes:MAX_CATALOG_BYTES,timeoutMs:10000});
      extraCatalog = cleanExtraGamesCatalog(JSON.parse(new TextDecoder().decode(bytes))); extraCatalogError = false;
    } catch { extraCatalogError = true; } finally { render(); } })());
    await Promise.allSettled(tasks);
    catalogPromise = null;
  })();
  return catalogPromise;
}

$('games-search').addEventListener('input',render);
$('games-platform').addEventListener('change',render);
$('games-refresh').addEventListener('click',() => { if (!catalogPromise) { catalog = null; extraCatalog = null; catalogError = false; extraCatalogError = false; void loadCatalog(); } });
$('games-file').addEventListener('change',event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (!/\.nes$/i.test(file.name)) { $('games-message').textContent = 'Choose an uncompressed .nes game file.'; return; }
  if (file.size > MAX_ROM_BYTES) { $('games-message').textContent = 'This game is larger than the 16 MiB limit.'; return; }
  void play({title:file.name.replace(/\.nes$/i,'')},file);
});
$('close-games-player').addEventListener('click',closeGame);
dialog.addEventListener('cancel',event => { event.preventDefault(); closeGame(); });
$('games-pause').addEventListener('click',() => running ? pauseGame() : cheatsPanel.hidden ? startGame() : resumeFromCheats());
$('games-save').addEventListener('click',() => void saveGame('manual',true));
$('games-load').addEventListener('click',() => void loadManual());
$('games-start-fresh').addEventListener('click',freshGame);
$('games-cheats').addEventListener('click',() => { if (cheatsPanel.hidden) openCheats(); else { hideCheats(); canvas.focus({preventScroll:true}); } });
$('games-cheats-done').addEventListener('click',resumeFromCheats);
$('games-cheats-enabled').addEventListener('change',event => setCheats({...cheatSet,enabled:event.target.checked},'Cheat switch updated.'));
$('games-cheat-cancel-edit').addEventListener('click',cancelCheatEdit);
for (const id of ['games-cheat-name','games-cheat-codes']) $(id).addEventListener('input',() => { actionGeneration++; });
$('games-cheat-form').addEventListener('submit',event => {
  event.preventDefault();
  if (!canEditCheats()) return;
  try {
    const entries = parseCheatLines($('games-cheat-codes').value,$('games-cheat-name').value);
    if (!entries.length) throw new Error('Enter at least one code.');
    let codes;
    if (editingCheat) {
      if (entries.length !== 1) throw new Error('Edit one code at a time. Cancel edit to add several codes.');
      codes = cheatSet.codes.map(entry => entry.code === editingCheat ? {...entries[0],enabled:entry.enabled} : entry);
    } else codes = [...cheatSet.codes,...entries];
    if (setCheats({...cheatSet,codes},editingCheat ? 'Code changed.' : 'Codes added.')) cancelCheatEdit();
  } catch (error) { $('games-cheat-message').textContent = error.message || 'Check your code format and try again.'; }
});
$('games-cheats-clear').addEventListener('click',() => { if (setCheats({...cheatSet,codes:[]},'All codes removed.')) cancelCheatEdit(); });
$('games-cheats-import').addEventListener('change',event => { const file = event.target.files?.[0]; event.target.value = ''; void importCheatFile(file); });
$('games-cheats-export').addEventListener('click',() => {
  if (!canEditCheats()) return;
  try {
    const blob = new Blob([exportCheats(cheatSet)],{type:'application/json'}), url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `nes-cheats-${selection.hash.slice(0,12)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000); $('games-cheat-message').textContent = 'Code list exported.';
  } catch { $('games-cheat-message').textContent = 'The code list could not export. Try again.'; }
});
$('games-fullscreen').addEventListener('click',() => {
  if (!adult() || selection?.viewer !== viewer()) { closeGame(); $('games-message').textContent = 'Switch to an adult viewer to play Games.'; return; }
  const current = generation;
  const wasRunning = running;
  if (nesFullscreenOwned && document.fullscreenElement === document.documentElement) { void document.exitFullscreen().catch(() => { if (current === generation) status('Full screen could not close. Use your browser\'s exit full screen control.'); }); return; }
  if (!document.documentElement.requestFullscreen) { status('Full screen is unavailable in this browser. Rotate your device for a wider layout.'); return; }
  nesFullscreenOwned = true;
  void document.documentElement.requestFullscreen().then(() => {
    if (current !== generation || !dialog.open || !adult() || selection?.viewer !== viewer()) {
      nesFullscreenOwned = false; document.body.classList.remove('nes-game-fullscreen');
      if (document.fullscreenElement === document.documentElement && !document.body.classList.contains('extra-game-fullscreen')) void document.exitFullscreen().catch(() => {});
      return;
    }
    document.body.classList.toggle('nes-game-fullscreen',document.fullscreenElement === document.documentElement);
    // The fullscreen root is promoted above an existing modal in the browser's
    // top layer. Re-promote this same dialog without replacing its emulator.
    if (document.fullscreenElement === document.documentElement) {
      dialog.close(); dialog.showModal();
      (cheatsPanel.hidden ? canvas : $('games-cheat-codes')).focus({preventScroll:true});
      if (wasRunning && !document.hidden && document.hasFocus()) startGame();
    }
  }).catch(() => { nesFullscreenOwned = false; document.body.classList.remove('nes-game-fullscreen'); if (current === generation) status('Full screen is unavailable. Rotate your device for a wider layout.'); });
});
document.addEventListener('fullscreenchange',() => {
  if (document.fullscreenElement !== document.documentElement) nesFullscreenOwned = false;
  document.body.classList.toggle('nes-game-fullscreen',nesFullscreenOwned && dialog.open && document.fullscreenElement === document.documentElement);
});
$('games-mute').addEventListener('click',() => {
  soundEnabled = !soundEnabled; $('games-mute').textContent = soundEnabled ? 'Mute' : 'Unmute'; $('games-mute').setAttribute('aria-pressed',String(!soundEnabled));
  if (soundEnabled && running) sound?.resume(); else sound?.pause();
});
$('games-zapper')?.addEventListener('click',() => {
  zapperEnabled = !zapperEnabled; resetZapper(); showZapperMode();
  status(zapperEnabled ? 'Light gun on. Aim on the game screen, then click or tap to shoot.' : 'Light gun off.');
});
canvas.addEventListener('pointermove',event => {
  if (zapperEnabled && running && tabOpen) { if (event.pointerType === 'touch') event.preventDefault(); aimZapper(event); }
});
canvas.addEventListener('pointerdown',event => {
  if (!zapperEnabled || !running || !tabOpen || event.button > 0 || !aimZapper(event)) return;
  event.preventDefault(); clearTimeout(zapperReleaseTimer); zapperReleaseTimer = null;
  canvas.focus({preventScroll:true});
  zapperPointers.add(event.pointerId); zapperStartedAt = performance.now();
  canvas.setPointerCapture(event.pointerId); nes.zapperFireDown(); sound?.resume();
});
for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type,finishZapperPointer);
canvas.addEventListener('pointerleave',event => { if (zapperEnabled && running && event.pointerType !== 'touch' && !zapperPointers.has(event.pointerId)) nes?.zapperMove(-1,-1); });
canvas.addEventListener('contextmenu',event => { if (zapperEnabled) event.preventDefault(); });
document.addEventListener('keydown',event => {
  if (!tabOpen || !dialog.open || !running || textFocused(event.target) || actionKey(event) || event.ctrlKey || event.altKey || event.metaKey) return;
  const binding = keys.get(event.code); if (!binding) return;
  event.preventDefault(); event.stopPropagation(); input('key:'+event.code,...binding,true); sound?.resume();
});
document.addEventListener('keyup',event => {
  const binding = keys.get(event.code); if (!binding) return;
  releaseSource('key:'+event.code);
  if (tabOpen && dialog.open && running && !textFocused(event.target) && !actionKey(event)) { event.preventDefault(); event.stopPropagation(); }
});
function setPointer(pointerId, button) {
  const source = 'pointer:'+pointerId; releaseSource(source);
  const previous = pointerKeys.get(pointerId);
  if (!button || !running) pointerKeys.delete(pointerId); else pointerKeys.set(pointerId,button);
  if (previous) previous.classList.toggle('is-pressed',[...pointerKeys.values()].includes(previous));
  if (!button || !running) return;
  button.classList.add('is-pressed');
  for (const value of button.dataset.buttons.split(',')) input(source,1,Number(value),true);
}
for (const button of dialog.querySelectorAll('.games-touch-key')) {
  button.addEventListener('pointerdown',event => {
    if (!running || !tabOpen) return;
    event.preventDefault(); activePointers.add(event.pointerId); button.setPointerCapture(event.pointerId); setPointer(event.pointerId,button); sound?.resume();
  });
  button.addEventListener('pointermove',event => {
    if (!activePointers.has(event.pointerId)) return;
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.games-touch-key');
    if (target !== pointerKeys.get(event.pointerId)) setPointer(event.pointerId,target && dialog.contains(target) ? target : null);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,event => { activePointers.delete(event.pointerId); setPointer(event.pointerId,null); });
  button.addEventListener('contextmenu',event => event.preventDefault());
}
window.addEventListener('games-tab-open',() => {
  if (!adult()) return;
  tabOpen = true; void loadCatalog();
});
window.addEventListener('games-tab-close',() => { tabOpen = false; closeGame(); });
for (const type of ['cinema-playback-start','sports-playback-start']) window.addEventListener(type,closeGame);
document.addEventListener('visibilitychange',() => { if (document.hidden) { actionGeneration++; pauseGame(); } });
window.addEventListener('blur',() => { actionGeneration++; if (running) pauseGame(); });
window.addEventListener('pagehide',closeGame);
window.addEventListener('storage',event => { if (event.key === 'tw-viewer' || event.key === 'torbox-parental-controls-v1') { if (selection && (!adult() || selection.viewer !== viewer())) closeGame(); } });
clearScreen();

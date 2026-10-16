import {getKidProfile} from './parental-controls.js?v=release-1.2.8-party.1';

const $ = id => document.getElementById(id);
const canvas = $('dos-canvas'), paint = canvas.getContext('2d', {alpha: false});
const BUILD = 'release-1.2.8-party.1', VENDOR_VERSION = '8.5.2';
const MAX_BUNDLE = 32 * 1024 * 1024, START_TIMEOUT = 20000;
const origin = location.origin, workers = new Map(), heldKeys = new Map(), heldMouse = new Map();
const mousePulses = new Map();
let generation = 0, ci = null, controller = null, runtimePromise = null, selected = null;
let running = false, closed = false, pauseIntent = false, muted = false, frames = 0, image = null, sound = null, lastStatus = 0;
const NativeWorker = window.Worker;
// Tracking is local to this isolated player. A canceled startup cannot leave
// an unpublished worker running or terminate a later game's worker.
window.Worker = class extends NativeWorker {
  constructor(...args) { super(...args); workers.set(this, generation); if (closed) this.terminate(); }
  terminate() { workers.delete(this); return super.terminate(); }
};

function viewer() {
  try { const value = localStorage.getItem('tw-viewer') || sessionStorage.getItem('tw-viewer'); return ['viewer-1','viewer-2'].includes(value) ? value : 'viewer-1'; }
  catch { return 'viewer-1'; }
}
function allowed() { return !getKidProfile(viewer()).enabled && (!selected?.viewer || selected.viewer === viewer()); }
function post(state, message = $('dos-status').textContent) {
  document.body.dataset.state = state; $('dos-status').textContent = message;
  $('dos-pause').disabled = !ci; $('dos-pause').textContent = running ? 'Pause' : 'Resume';
  if (parent !== window) parent.postMessage({type: 'torbox-extra-status', state, message, frames}, origin);
}
function stopWorkers(current) { for (const [worker, owner] of workers) if (owner === current) worker.terminate(); }
function releaseInputs() {
  for (const pulse of mousePulses.values()) { clearTimeout(pulse.timer); clearTimeout(pulse.downTimer); }
  if (ci) {
    for (const key of heldKeys.keys()) ci.sendKeyEvent(key, false);
    const buttons = new Set([...heldMouse.values(), ...mousePulses.keys()]);
    for (const button of buttons) ci.sendMouseButton(button, false);
    if (buttons.size) ci.sendMouseSync();
  }
  heldKeys.clear(); heldMouse.clear(); mousePulses.clear();
}
function key(source, code, pressed) {
  if (!Number.isInteger(code) || code < 32 || code > 348 || typeof pressed !== 'boolean') return;
  let sources = heldKeys.get(code);
  if (pressed) {
    if (!running || !ci || !allowed()) return;
    if (!sources) { sources = new Set(); heldKeys.set(code, sources); }
    if (!sources.size) ci.sendKeyEvent(code, true);
    sources.add(source); sound?.resume();
  } else if (sources) {
    sources.delete(source);
    if (!sources.size) { ci?.sendKeyEvent(code, false); heldKeys.delete(code); }
  }
}
function pause(message = 'Paused. Press Resume to continue.') {
  pauseIntent = true; running = false; releaseInputs(); ci?.pause(); sound?.pause();
  if (!closed) post(ci ? 'paused' : document.body.dataset.state, message);
}
function resume() {
  pauseIntent = false;
  if (!ci || closed) return;
  if (!allowed()) { void close('Switch to an adult viewer to play DOS games.'); return; }
  if (document.hidden) return;
  releaseInputs(); running = true; ci.resume(); if (!muted) sound?.resume();
  post('playing', 'Playing. Click the screen to use the keyboard and mouse.');
}
async function close(message = 'Game closed.', announce = true) {
  const previous = generation++, previousCI = ci;
  controller?.abort(); controller = null;
  pauseIntent = true; running = false; releaseInputs(); ci = null; sound?.close(); sound = null; closed = true;
  stopWorkers(previous);
  if (previousCI) void previousCI.exit().catch(() => {});
  if (announce) post('paused', message);
}

async function bytes(url, maxBytes, signal) {
  const response = await fetch(url, {credentials: 'omit', redirect: 'error', signal});
  if (!response.ok) throw new Error('A game file could not load. Close the game and try again.');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('This game file exceeds its size limit.');
  const reader = response.body?.getReader();
  if (!reader) { const buffer = new Uint8Array(await response.arrayBuffer()); if (buffer.length > maxBytes) throw new Error('This game file exceeds its size limit.'); return buffer; }
  const chunks = []; let length = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > maxBytes) throw new Error('This game file exceeds its size limit.'); chunks.push(next.value); }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function script(path) {
  return new Promise((resolve, reject) => {
    const node = document.createElement('script'), timer = setTimeout(() => { node.remove(); reject(new Error('The DOS engine did not load in time.')); }, START_TIMEOUT);
    node.src = path; node.onload = () => { clearTimeout(timer); resolve(); }; node.onerror = () => { clearTimeout(timer); node.remove(); reject(new Error('The DOS engine could not load.')); };
    document.head.append(node);
  });
}
async function compiledModule(name, basename) {
  const url = './vendor/dos/' + basename;
  const [binary] = await Promise.all([bytes(url + '.wasm?v=' + VENDOR_VERSION, 2 * 1024 * 1024, AbortSignal.timeout(START_TIMEOUT)), script(url + '.js?v=' + VENDOR_VERSION)]);
  const factory = window[name];
  if (typeof factory !== 'function') throw new Error('The DOS engine could not initialize.');
  const wasmModule = await WebAssembly.compile(binary);
  return {wasmModule, instantiate: async initial => {
    initial.instantiateWasm = (imports, receive) => { void WebAssembly.instantiate(wasmModule, imports).then(instance => receive(instance, wasmModule)); };
    await factory(initial);
  }};
}
function runtime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    await script('./vendor/dos/emulators.js?v=' + VENDOR_VERSION);
    const engine = window.emulators;
    if (!engine?.dosboxWorker) throw new Error('The DOS engine could not initialize.');
    engine.pathPrefix = new URL('./vendor/dos/', location.href).href; engine.pathSuffix = '?v=' + VENDOR_VERSION;
    // Upstream's browser loader evaluates fetched JS. Register unmodified local
    // script factories and compiled WASM directly, keeping unsafe-eval disabled.
    window.compiled.WDOSBOX = compiledModule('WDOSBOX', 'wdosbox');
    window.compiled.WLIBZIP = compiledModule('WLIBZIP', 'wlibzip');
    await Promise.all([window.compiled.WDOSBOX, window.compiled.WLIBZIP]);
    return engine;
  })().catch(error => { runtimePromise = null; throw error; });
  return runtimePromise;
}

class Sound {
  constructor() {
    this.context = null; this.nodes = new Set(); this.at = 0; this.closed = false;
    try { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) this.context = new Audio({latencyHint: 'interactive'}); } catch {}
    if (!this.context) $('dos-audio-status').textContent = 'Sound is unavailable in this browser.';
    else { $('dos-audio-status').textContent = 'Tap the screen or a game control to enable sound.'; this.context.addEventListener('statechange', () => { if (!this.closed && this.context.state === 'running') $('dos-audio-status').textContent = ''; }); }
  }
  resume() { if (!muted && this.context && !this.closed) void this.context.resume().catch(() => {}); }
  push(samples, frequency) {
    const ctx = this.context;
    if (!ctx || this.closed || muted || !running || ctx.state !== 'running' || !samples?.length || !Number.isFinite(frequency) || frequency <= 0) return;
    if (this.at > ctx.currentTime + .25) return;
    const buffer = ctx.createBuffer(1, samples.length, frequency); buffer.copyToChannel(samples, 0);
    const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination); this.nodes.add(node);
    node.onended = () => { this.nodes.delete(node); node.disconnect(); };
    this.at = Math.max(ctx.currentTime + .01, this.at); node.start(this.at); this.at += samples.length / frequency;
  }
  pause() { for (const node of this.nodes) { try { node.stop(); } catch {} node.disconnect(); } this.nodes.clear(); this.at = 0; if (this.context && !this.closed) void this.context.suspend().catch(() => {}); }
  close() { this.pause(); this.closed = true; if (this.context) void this.context.close().catch(() => {}); }
}
function frame(rgb, rgba, current) {
  if (current !== generation || !running || !ci) return;
  if (!allowed()) { void close('Switch to an adult viewer to play DOS games.'); return; }
  const width = ci.width(), height = ci.height(), source = rgb || rgba;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 1536 || !source) return;
  if (canvas.width !== width || canvas.height !== height || !image) { canvas.width = width; canvas.height = height; image = paint.createImageData(width, height); }
  const stride = rgb ? 3 : 4;
  if (source.length !== width * height * stride) return;
  for (let i = 0, at = 0; at < image.data.length; i += stride, at += 4) { image.data[at] = source[i]; image.data[at + 1] = source[i + 1]; image.data[at + 2] = source[i + 2]; image.data[at + 3] = 255; }
  paint.putImageData(image, 0, 0); canvas.dataset.frames = String(++frames);
  if (performance.now() - lastStatus > 1000) { lastStatus = performance.now(); post('playing'); }
}
async function start() {
  await close(undefined, false); closed = false; pauseIntent = false;
  const current = generation, selectedViewer = viewer();
  if (!allowed()) { post('error', 'Switch to an adult viewer to play DOS games.'); return; }
  controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(START_TIMEOUT)]);
  let timer;
  const startupTimer = setTimeout(() => {
    if (current !== generation) return;
    void close(); post('error', 'The DOS game did not start in time. Press Restart to try again.');
  }, START_TIMEOUT);
  frames = 0; canvas.dataset.frames = '0'; paint.fillStyle = '#000'; paint.fillRect(0, 0, canvas.width, canvas.height); post('loading', 'Opening DOS game…');
  try {
    const id = new URLSearchParams(location.search).get('game');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) throw new Error('Choose a DOS game from the Games tab.');
    const catalogBytes = await bytes('./extra-games-catalog.json?v=' + BUILD, 256 * 1024, signal);
    const catalog = JSON.parse(new TextDecoder().decode(catalogBytes));
    if (catalog?.version !== 1 || !Array.isArray(catalog.items) || catalog.items.length > 2000) throw new Error('The DOS game list is invalid.');
    const matches = catalog.items.filter(item => item?.id === id && item.platform === 'dos');
    if (matches.length !== 1 || !/^games-data\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.jsdos$/.test(matches[0].bundle || '') || matches[0].bundle.includes('..')) throw new Error('This DOS game is not available in the game list.');
    const item = matches[0];
    const [engine, bundle] = await Promise.all([runtime(), bytes('./' + item.bundle, MAX_BUNDLE, signal)]);
    if (current !== generation || signal.aborted || selectedViewer !== viewer() || !allowed()) return;
    if (bundle.length < 4 || bundle[0] !== 0x50 || bundle[1] !== 0x4b) throw new Error('This DOS game bundle is invalid.');
    selected = {id, viewer: selectedViewer};
    $('dos-controls').textContent = typeof item.controls === 'string' ? item.controls.slice(0, 500) : 'Click the game screen to use your keyboard and mouse.';
    sound = new Sound();
    const pending = engine.dosboxWorker(bundle, {audioWorklet: false});
    pending.then(late => { if (current !== generation) { void late.exit().catch(() => {}); stopWorkers(current); } }).catch(() => {});
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The DOS game did not start in time. Press Restart to try again.')), START_TIMEOUT); });
    const instance = await Promise.race([pending, timeout]);
    if (current !== generation || signal.aborted || selectedViewer !== viewer() || !allowed()) { void instance.exit().catch(() => {}); stopWorkers(current); return; }
    ci = instance; running = true;
    ci.events().onFrame((rgb, rgba) => frame(rgb, rgba, current));
    ci.events().onSoundPush(samples => { if (current === generation) sound?.push(samples, ci?.soundFrequency()); });
    ci.events().onExit(() => { if (current === generation && !closed) { running = false; releaseInputs(); sound?.pause(); post('paused', 'The DOS program finished. Press Restart to play again.'); } });
    ci.events().onMessage((type, ...args) => {
      const message = String(args.join(' '));
      // DOSBox writes ordinary LOG_EXEC diagnostics to stderr, which the
      // protocol labels "error". Only a native panic/fatal stops this player.
      if (current === generation && type === 'error' && /^\[(?:panic|fatal)\]/i.test(message)) { running = false; releaseInputs(); sound?.pause(); post('error', message.slice(0, 250) || 'This DOS game could not run.'); }
    });
    canvas.focus({preventScroll: true});
    if (document.hidden || pauseIntent) pause(); else post('playing', 'Playing. Click the screen to use the keyboard and mouse.');
  } catch (error) {
    if (current !== generation) return;
    closed = true; generation++; stopWorkers(current); ci = null; running = false; releaseInputs(); sound?.close(); sound = null;
    post('error', error?.name === 'TimeoutError' ? 'The game did not load in time. Press Restart to try again.' : error?.message || 'This DOS game could not run.');
  } finally { clearTimeout(timer); clearTimeout(startupTimer); }
}

function keyboardCode(event) {
  const special = {Escape:256, Enter:257, Backspace:259, Insert:260, Delete:261, ArrowRight:262, ArrowLeft:263, ArrowDown:264, ArrowUp:265, PageUp:266, PageDown:267, Home:268, End:269, CapsLock:280, ScrollLock:281, NumLock:282, PrintScreen:283, Pause:284, ShiftLeft:340, ControlLeft:341, AltLeft:342, ShiftRight:344, ControlRight:345, AltRight:346, Space:32};
  if (special[event.code] !== undefined) return special[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  if (/^F(?:[1-9]|1[0-2])$/.test(event.code)) return 289 + Number(event.code.slice(1));
  return {Minus:45, Equal:61, BracketLeft:91, BracketRight:93, Backslash:92, Semicolon:59, Quote:39, Comma:44, Period:46, Slash:47, Backquote:96}[event.code];
}
document.addEventListener('keydown', event => {
  if (!running || event.target !== canvas || event.metaKey || event.code === 'Tab') return;
  const code = keyboardCode(event); if (code === undefined) return;
  event.preventDefault(); key('keyboard:' + event.code, code, true);
});
document.addEventListener('keyup', event => { const code = keyboardCode(event); if (code !== undefined) { key('keyboard:' + event.code, code, false); if (event.target === canvas) event.preventDefault(); } });
function mousePosition(event) {
  const rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * scale, height = canvas.height * scale;
  return {x: Math.max(0, Math.min(1, (event.clientX - rect.left - (rect.width - width) / 2) / width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top - (rect.height - height) / 2) / height))};
}
function pressMouse(pointerId, button) {
  let pulse = mousePulses.get(button);
  const anotherHeld = [...heldMouse.values()].includes(button);
  if (pulse) { clearTimeout(pulse.timer); if (!anotherHeld) { clearTimeout(pulse.downTimer); if (pulse.down) { ci.sendMouseButton(button, false); ci.sendMouseSync(); } pulse.down = false; } }
  else { pulse = {interface: ci, generation, timer: null, downTimer: null, startedAt: 0, down: false, released: false}; mousePulses.set(button, pulse); }
  pulse.timer = null; pulse.released = false; heldMouse.set(pointerId, button);
  if (anotherHeld) return;
  const down = () => {
    pulse.downTimer = null;
    if (mousePulses.get(button) !== pulse || pulse.interface !== ci || pulse.generation !== generation || !running) return;
    pulse.down = true; pulse.startedAt = performance.now(); ci.sendMouseButton(button, true); ci.sendMouseSync();
    if (pulse.released && ![...heldMouse.values()].includes(button)) scheduleMouseRelease(button, pulse);
  };
  if (selected?.id === 'master-mind') {
    // Master Mind can discard a press arriving during its hover repaint. Let
    // that neutral movement settle before emitting a separate down edge.
    ci.sendMouseButton(button, false); ci.sendMouseSync(); pulse.downTimer = setTimeout(down, 150);
  } else down();
}
function scheduleMouseRelease(button, pulse, immediate = false) {
  clearTimeout(pulse.timer);
  const delay = !immediate && selected?.id === 'master-mind' ? Math.max(0, 350 - (performance.now() - pulse.startedAt)) : 0;
  const release = () => {
    if (mousePulses.get(button) !== pulse) return;
    mousePulses.delete(button);
    if (pulse.interface === ci && pulse.generation === generation && ![...heldMouse.values()].includes(button)) { ci.sendMouseButton(button, false); ci.sendMouseSync(); }
  };
  if (delay) pulse.timer = setTimeout(release, delay); else release();
}
function finishMouse(event) {
  if (!heldMouse.has(event.pointerId)) return;
  const button = heldMouse.get(event.pointerId); heldMouse.delete(event.pointerId);
  if ([...heldMouse.values()].includes(button)) return;
  const pulse = mousePulses.get(button);
  if (!pulse) return;
  pulse.released = true;
  if (event.type !== 'pointerup') { clearTimeout(pulse.downTimer); pulse.downTimer = null; scheduleMouseRelease(button, pulse, true); }
  // A completed short tap still gets its delayed down/up pair. The normal
  // lostpointercapture event after pointerup sees no held pointer and is ignored.
  else if (pulse.down) scheduleMouseRelease(button, pulse);
}
canvas.addEventListener('pointerdown', event => {
  if (!running || !ci) return;
  const button = {0:0, 2:1, 1:2}[event.button]; if (button === undefined) return;
  event.preventDefault(); canvas.focus({preventScroll: true}); canvas.setPointerCapture(event.pointerId);
  const position = mousePosition(event); ci.sendMouseMotion(position.x, position.y); pressMouse(event.pointerId, button); sound?.resume();
});
canvas.addEventListener('pointermove', event => { if (running && ci) { const position = mousePosition(event); ci.sendMouseMotion(position.x, position.y); ci.sendMouseSync(); } });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, finishMouse);
canvas.addEventListener('contextmenu', event => event.preventDefault());
$('dos-pause').addEventListener('click', () => running ? pause() : resume());
function restart() { void close(); location.reload(); }
$('dos-restart').addEventListener('click', restart);
function mute(value) { muted = value; $('dos-mute').setAttribute('aria-pressed', String(muted)); $('dos-mute').textContent = muted ? 'Unmute' : 'Mute'; if (muted) sound?.pause(); else if (running) sound?.resume(); }
$('dos-mute').addEventListener('click', () => mute(!muted));
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== origin || event.data?.type !== 'torbox-extra-command') return;
  const data = event.data;
  if (data.command === 'pause') pause();
  else if (data.command === 'resume') resume();
  else if (data.command === 'restart') restart();
  else if (data.command === 'close') void close();
  else if (data.command === 'key') key('parent:' + data.key, data.key, data.pressed);
  else if (data.command === 'mute' && typeof data.muted === 'boolean') mute(data.muted);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('blur', () => { if (running) pause(); });
window.addEventListener('pagehide', () => { void close(); });
window.addEventListener('storage', event => { if (['tw-viewer', 'torbox-parental-controls-v1'].includes(event.key) && !allowed()) void close('Switch to an adult viewer to play DOS games.'); });
void start();

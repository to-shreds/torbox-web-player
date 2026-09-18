import { createDiscoveryUI } from './discover.js';
import { diagnosePlaybackFailure, matchesFormat } from './playback-errors.js';
const $ = id => document.getElementById(id);
let csrf = '', files = [], nextOffset = null, loadGeneration = 0, playGeneration = 0, active = null, retryFile = null, libraryAbort = null, searchTimer;
let discoveryUI;
let viewer = 'viewer-1';
try { const saved = sessionStorage.getItem('tw-viewer'); if (['viewer-1', 'viewer-2'].includes(saved)) viewer = saved; } catch {}
$('viewer').value = viewer;
const formatLabel = document.createElement('label');
formatLabel.htmlFor = 'format'; formatLabel.textContent = 'File format';
const format = document.createElement('select'); format.id = 'format';
for (const [value, label] of [['all', 'All formats'], ['mp4', 'MP4 files']]) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; format.append(option);
}
formatLabel.append(format); $('refresh').before(formatLabel);
const formatNote = document.createElement('p'); formatNote.className = 'muted'; formatNote.hidden = true;
$('files').before(formatNote);
const showMp4 = document.createElement('button'); showMp4.textContent = 'Show MP4 files'; showMp4.hidden = true;
$('renew').after(showMp4);
format.addEventListener('change', renderFiles);
showMp4.addEventListener('click', () => { format.value = 'mp4'; renderFiles(); $('player').close(); discoveryUI.openLibrary(); $('search').focus(); });

function text(id, value, error = false) { $(id).textContent = value; $(id).classList.toggle('error', error); }
function show(section) { if (section !== 'workspace') discoveryUI?.suspend(); for (const id of ['loading', 'setup-needed', 'login', 'workspace']) $(id).hidden = id !== section; }
async function api(path, { method = 'GET', data, signal, keepalive = false } = {}) {
  const headers = {}; if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let response;
  try { response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), credentials: 'same-origin', cache: 'no-store', signal: signal || AbortSignal.timeout(22000), keepalive }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('The connection was interrupted or timed out. Please try again.'); }
  let result; try { result = await response.json(); } catch { throw new Error('The service is starting or could not answer. Reload the page and try again.'); }
  if (!response.ok) {
    if (result.error === 'LOGIN_REQUIRED') { stopPlayback(); if ($('player').open) $('player').close(); files = []; $('files').replaceChildren(); show('login'); }
    const error = new Error(result.message || 'The request failed.'); error.code = result.error; throw error;
  }
  return result;
}
async function bootstrap() {
  try {
    const session = await api('/api/session');
    if (session.setupRequired) return show('setup-needed');
    if (!session.authenticated) return show('login');
    csrf = session.csrf; show('workspace'); await discoveryUI.activate();
  } catch (error) { show('loading'); $('loading').querySelector('p').textContent = error.message; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; text('login-message', 'Signing in…');
  const password = $('password').value; $('password').value = '';
  try { const result = await api('/api/login', { method: 'POST', data: { password } }); csrf = result.csrf; text('login-message', ''); await bootstrap(); }
  catch (error) { text('login-message', error.message, true); }
  finally { button.disabled = false; }
});
$('logout').addEventListener('click', async () => {
  await stopPlayback();
  try { await api('/api/logout', { method: 'POST', data: {} }); csrf = ''; files = []; $('files').replaceChildren(); $('diagnostics').textContent = ''; $('owner-password').value = ''; try { sessionStorage.removeItem('tw-viewer'); } catch {} show('login'); }
  catch (error) { text('library-message', error.message, true); }
});
function renderFiles() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const list = files.filter(file => matchesFormat(file, format.value) && `${file.title} ${file.collection}`.toLocaleLowerCase().includes(query));
  formatNote.hidden = format.value !== 'mp4';
  formatNote.textContent = `${list.length} matching MP4 files in the loaded library. MP4 files still need video and audio that your browser supports.`;
  const fragment = document.createDocumentFragment();
  for (const file of list) {
    const card = document.createElement('article'); card.className = 'file';
    const copy = document.createElement('div'); copy.className = 'file-copy';
    const title = document.createElement('h2'); title.textContent = file.title;
    const collection = document.createElement('p'); collection.textContent = file.collection;
    const state = document.createElement('span'); state.className = 'state'; state.textContent = file.state;
    const meta = document.createElement('p'); meta.textContent = `${file.size === null ? 'Size unknown' : `${(file.size / 1024 ** 3).toFixed(2)} GB`} · ${file.mime || 'Codec not verified'}`;
    copy.append(title, collection, state, meta); card.append(copy);
    if (file.state === 'Ready to watch') { const button = document.createElement('button'); button.className = 'primary'; button.textContent = 'Play'; button.setAttribute('aria-label', `Play ${file.title}`); button.addEventListener('click', () => startPlayback(file)); card.append(button); }
    fragment.append(card);
  }
  if (!list.length) { const empty = document.createElement('p'); empty.className = 'panel'; empty.textContent = format.value === 'mp4' ? 'No matching MP4 files among the loaded files. Clear the search, choose All formats, or load another page.' : query ? 'No matching videos in the files loaded so far. Clear the search or load another page.' : 'No video files in this page of this library section. Other sections or pages may contain videos.'; fragment.append(empty); }
  $('files').replaceChildren(fragment); $('more').hidden = nextOffset === null;
}
async function loadLibrary({ more = false, refresh = false } = {}) {
  const generation = ++loadGeneration;
  libraryAbort?.abort(); libraryAbort = new AbortController();
  const timer = setTimeout(() => libraryAbort?.abort(), 22000);
  const offset = more ? nextOffset : 0; if (more && offset === null) { clearTimeout(timer); return; }
  $('refresh').disabled = true; $('more').disabled = true; text('library-message', 'Loading TorBox files…');
  try {
    const data = await api(`/api/library?kind=${encodeURIComponent($('kind').value)}&offset=${offset}&refresh=${refresh ? 1 : 0}`, { signal: libraryAbort.signal });
    if (generation !== loadGeneration) return;
    files = more ? [...new Map([...files, ...data.files].map(file => [file.id, file])).values()] : data.files;
    files.sort((a, b) => a.collection.localeCompare(b.collection, undefined, { numeric: true }) || a.title.localeCompare(b.title, undefined, { numeric: true }));
    nextOffset = data.nextOffset; renderFiles();
    text('library-message', data.stale ? `Showing the earlier library snapshot. ${data.warning}` : `${files.length} video files loaded.${nextOffset !== null ? ' More pages are available below.' : ''} Browser compatibility still needs a playback test.`, data.stale);
  } catch (error) { if (generation === loadGeneration) text('library-message', error.name === 'AbortError' ? 'The library request timed out. Please retry.' : error.message, true); }
  finally { clearTimeout(timer); if (generation === loadGeneration) { $('refresh').disabled = false; $('more').disabled = false; } }
}
$('kind').addEventListener('change', () => { files = []; nextOffset = null; $('files').replaceChildren(); $('more').hidden = true; loadLibrary(); });
$('refresh').addEventListener('click', () => loadLibrary({ refresh: true }));
$('more').addEventListener('click', () => loadLibrary({ more: true }));
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderFiles, 150); });
$('viewer').addEventListener('change', () => { stopPlayback(); if ($('player').open) $('player').close(); viewer = $('viewer').value; try { sessionStorage.setItem('tw-viewer', viewer); } catch {} });
async function saveProgress(context = active, keepalive = false) {
  if (!context || !context.ready || !context.started || !Number.isFinite(context.video.duration) || !context.video.duration) return;
  const seq = ++context.seq;
  try {
    const result = await api('/api/progress', { method: 'PUT', keepalive, data: { viewer: context.viewer, videoId: context.file.id, leaseId: context.leaseId, seq, position: context.video.currentTime, duration: context.video.duration } });
    if (!result.saved && active === context) text('player-message', 'Progress was not saved. Another playback may have replaced this session; reopen this file to continue saving.', true);
  } catch { if (active === context) text('player-message', 'Playback may continue, but the latest progress could not be saved. Check your connection.', true); }
}
async function detachPlayback() {
  const old = active; active = null;
  if (old) { clearInterval(old.timer); const saving = saveProgress(old, true); old.video.pause(); old.video.removeAttribute('src'); old.video.load(); old.video.remove(); await saving; }
}
async function stopPlayback() { playGeneration++; retryFile = null; await detachPlayback(); }
async function startPlayback(file, startOver = false) {
  const generation = ++playGeneration, selectedViewer = viewer;
  retryFile = file;
  await detachPlayback();
  if (generation !== playGeneration) return;
  showMp4.hidden = true;
  $('playing-title').textContent = file.title; text('player-message', 'Opening a secure stream…'); $('video-slot').replaceChildren();
  if (!$('player').open) $('player').showModal();
  $('renew').disabled = true; $('start-over').disabled = true;
  try {
    const result = await api('/api/playback', { method: 'POST', data: { viewer: selectedViewer, videoId: file.id, startOver } });
    if (generation !== playGeneration || !$('player').open || selectedViewer !== viewer) return;
    const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.preload = 'metadata';
    const context = { file, viewer: selectedViewer, leaseId: result.leaseId, seq: 0, video, mediaUrl: result.mediaUrl, diagnosing: false, ready: false, started: false, timer: null };
    active = context; $('video-slot').replaceChildren(video);
    video.addEventListener('loadedmetadata', () => {
      if (active !== context) return;
      const position = result.progress.position || 0;
      if (Number.isFinite(video.duration) && position > 0) video.currentTime = Math.min(position, Math.max(0, video.duration - .25));
      context.ready = true;
      text('player-message', position > 0 ? `Resuming at ${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}.` : 'Ready. Press play if the browser does not start automatically.');
      video.play().catch(error => { if (active === context && !context.diagnosing && error.name === 'NotAllowedError') text('player-message', 'Press play to begin. Your browser requires a tap.'); });
    });
    video.addEventListener('playing', () => { if (active === context) { context.started = true; text('player-message', 'Playing through the private relay. Progress is temporary in this preview.'); } });
    video.addEventListener('pause', () => { if (active === context) saveProgress(context); });
    video.addEventListener('seeked', () => { if (active === context && context.ready && context.started) saveProgress(context); });
    video.addEventListener('ended', () => { if (active === context) { saveProgress(context); text('player-message', 'Finished. Close the player to choose another file. Automatic next is not connected yet.'); } });
    video.addEventListener('error', async () => {
      if (active !== context || context.diagnosing) return;
      context.diagnosing = true;
      text('player-message', 'Playback failed. Checking whether the stream is reachable…');
      const diagnosis = await diagnosePlaybackFailure(context.mediaUrl, video.error?.code);
      if (active !== context || generation !== playGeneration) return;
      text('player-message', diagnosis.message, true);
      $('renew').disabled = !diagnosis.retry;
      showMp4.hidden = diagnosis.kind !== 'codec';
    });
    context.timer = setInterval(() => { if (active === context && !video.paused) saveProgress(context); }, 10000);
    video.src = result.mediaUrl;
    $('renew').disabled = false; $('start-over').disabled = false;
  } catch (error) {
    if (generation === playGeneration) { text('player-message', error.message, true); $('renew').disabled = false; }
  }
}
$('renew').addEventListener('click', () => { if (retryFile) startPlayback(retryFile); });
$('start-over').addEventListener('click', () => { if (active) startPlayback(active.file, true); });
$('back-ten').addEventListener('click', () => { if (active?.ready) active.video.currentTime = Math.max(0, active.video.currentTime - 10); });
$('forward-ten').addEventListener('click', () => { if (active?.ready && Number.isFinite(active.video.duration)) active.video.currentTime = Math.min(active.video.duration, active.video.currentTime + 10); });
$('close-player').addEventListener('click', () => $('player').close());
$('player').addEventListener('close', () => stopPlayback());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(active, true); });
window.addEventListener('pagehide', () => { saveProgress(active, true); });
$('owner-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const password = $('owner-password').value; $('owner-password').value = ''; text('owner-message', 'Checking connection…'); $('diagnostics').textContent = '';
  try {
    await api('/api/owner/unlock', { method: 'POST', data: { password } }); $('revoke').hidden = false;
    const result = await api('/api/owner/diagnostics', { method: 'POST', data: {} });
    text('owner-message', 'TorBox accepted the key. The secure relay is enabled; actual browser compatibility still depends on the file codecs.');
    $('diagnostics').textContent = JSON.stringify(result, null, 2);
  } catch (error) { text('owner-message', error.message, true); }
  finally { button.disabled = false; }
});
$('revoke').addEventListener('click', async () => {
  if (!confirm('Sign out every household device, including this one?')) return;
  try { await api('/api/owner/revoke', { method: 'POST', data: {} }); location.reload(); }
  catch (error) { text('owner-message', error.message, true); }
});
discoveryUI = createDiscoveryUI({ api, play: startPlayback, loadLibrary });
bootstrap();

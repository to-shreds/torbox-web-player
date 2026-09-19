import { createDiscoveryUI } from './discover.js';
import { diagnosePlaybackFailure, matchesFormat } from './playback-errors.js';
import { apiUrl, mediaUrl, apiMode, getSessionToken, setSessionToken, clearSessionToken, credentialsMode } from './runtime.js';
import { rememberApiKey, loadRememberedApiKey, forgetApiKey } from './vault.js';
import { listRecent, recordRecent, clearRecent, recentForContext, resumePosition, formatResumeTime } from './history.js';
const $ = id => document.getElementById(id);
let csrf = '', sessionToken = getSessionToken(), files = [], nextOffset = null, loadGeneration = 0, playGeneration = 0, active = null, libraryAbort = null, searchTimer, recentRenderTimer;
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
function text(id, value, error = false) { $(id).textContent = value; $(id).classList.toggle('error', error); }
function recentLabel(item) {
  const episode = item.type === 'series' ? `S${item.season}E${item.episode}${item.episodeName ? ' · ' + item.episodeName : ''}` : 'Movie';
  const time = item.completed ? 'Finished' : item.position > 0 ? `Resume ${formatResumeTime(item.position)}` : 'Start';
  return `${episode} · ${time}`;
}
function renderRecent() {
  const rows = listRecent().slice(0, 6), section = $('recent-section'), list = $('recent-list');
  section.hidden = !rows.length || $('discover-panel').hidden;
  const fragment = document.createDocumentFragment();
  for (const item of rows) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'recent-card';
    if (item.poster) { const img = document.createElement('img'); img.className = 'recent-thumb'; img.src = item.poster; img.alt = ''; img.referrerPolicy = 'no-referrer'; card.append(img); }
    const copy = document.createElement('span'); copy.className = 'recent-copy';
    const title = document.createElement('strong'); title.className = 'recent-title'; title.textContent = item.title;
    const meta = document.createElement('span'); meta.className = 'recent-meta'; meta.textContent = recentLabel(item); copy.append(title, meta);
    if (item.duration > 0 && !item.completed) { const track=document.createElement('span');track.className='recent-progress';const fill=document.createElement('span');fill.style.width=`${Math.min(100,Math.max(0,item.position/item.duration*100))}%`;track.append(fill);copy.append(track); }
    card.append(copy); card.addEventListener('click', () => discoveryUI.resumeRecent(item)); fragment.append(card);
  }
  list.replaceChildren(fragment);
}
function scheduleRecentRender() { clearTimeout(recentRenderTimer); recentRenderTimer = setTimeout(renderRecent, 250); }
function show(section) { if (section !== 'workspace') discoveryUI?.suspend(); for (const id of ['loading', 'setup-needed', 'login', 'workspace']) $(id).hidden = id !== section; }
async function api(path, { method = 'GET', data, signal, keepalive = false } = {}) {
  const headers = {}; if (data !== undefined) headers['Content-Type'] = 'application/json';
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let response;
  try { response = await fetch(apiUrl(path), { method, mode: apiMode(), headers, body: data === undefined ? undefined : JSON.stringify(data), credentials: credentialsMode(), cache: 'no-store', signal: signal || AbortSignal.timeout(22000), keepalive }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('The connection was interrupted or timed out. Please try again.'); }
  let result; try { result = await response.json(); } catch { throw new Error('The service is starting or could not answer. Reload the page and try again.'); }
  if (!response.ok) {
    if (result.error === 'LOGIN_REQUIRED') { clearSessionToken(); sessionToken = ''; csrf = ''; stopPlayback(); if ($('player').open) $('player').close(); files = []; $('files').replaceChildren(); show('login'); }
    const error = new Error(result.message || 'The request failed.'); error.code = result.error; throw error;
  }
  return result;
}
let autoLoginTried = false;
async function connectWithKey(apiKey, remember = false) {
  const result = await api('/api/login', { method: 'POST', data: { apiKey } });
  sessionToken = result.sessionToken || '';
  if (!sessionToken || !setSessionToken(sessionToken)) throw new Error('The browser could not save the private session.');
  csrf = result.csrf;
  if (remember) await rememberApiKey(apiKey);
  return result;
}
async function bootstrap() {
  try {
    const session = await api('/api/session');
    if (session.setupRequired) return show('setup-needed');
    if (!session.authenticated) {
      clearSessionToken(); sessionToken = ''; csrf = '';
      if (!autoLoginTried) {
        autoLoginTried = true;
        const remembered = await loadRememberedApiKey();
        if (remembered) {
          try { await connectWithKey(remembered, false); return await bootstrap(); }
          catch { clearSessionToken(); sessionToken = ''; csrf = ''; }
        }
      }
      return show('login');
    }
    csrf = session.csrf; show('workspace'); renderRecent(); await discoveryUI.activate();
  } catch (error) { show('loading'); $('loading').querySelector('p').textContent = error.message; }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true; text('login-message', 'Checking TorBox…');
  const apiKey = $('api-key').value; $('api-key').value = '';
  try { await connectWithKey(apiKey, $('remember-key').checked); text('login-message', ''); await bootstrap(); }
  catch (error) { clearSessionToken(); sessionToken = ''; csrf = ''; text('login-message', error.message, true); }
  finally { button.disabled = false; }
});
$('forget-key').addEventListener('click', async () => {
  await forgetApiKey(); $('remember-key').checked = false; text('login-message', 'Saved key removed from this device.');
});
$('clear-recent').addEventListener('click', () => { clearRecent(); renderRecent(); });
$('logout').addEventListener('click', async () => {
  await stopPlayback();
  try { await api('/api/logout', { method: 'POST', data: {} }); clearSessionToken(); sessionToken = ''; csrf = ''; files = []; $('files').replaceChildren(); $('diagnostics').textContent = ''; $('owner-password').value = ''; try { sessionStorage.removeItem('tw-viewer'); } catch {} autoLoginTried = true; show('login'); }
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
  if (!context || !context.ready || !Number.isFinite(context.video.duration) || !context.video.duration) return;
  const position = Number.isFinite(context.video.currentTime) ? context.video.currentTime : 0, duration = context.video.duration;
  if (context.playbackContext) { recordRecent(context.playbackContext, position, duration); scheduleRecentRender(); }
  if (!context.started) return;
  const seq = ++context.seq;
  try {
    const result = await api('/api/progress', { method: 'PUT', keepalive, data: { viewer: context.viewer, videoId: context.file.id, leaseId: context.leaseId, seq, position, duration } });
    if (!result.saved && active === context) text('player-message', 'Local resume is saved, but the temporary server progress lease was replaced.', true);
  } catch { if (active === context) text('player-message', 'Playback continues. Resume is saved on this device.', false); }
}
async function detachPlayback() {
  const old = active; active = null;
  if (old) { clearInterval(old.timer); const saving = saveProgress(old, true); old.video.pause(); old.video.removeAttribute('src'); old.video.load(); old.video.remove(); await saving; }
}
async function stopPlayback() { playGeneration++; await detachPlayback(); }
async function startPlayback(file, playbackContext = null, retryCount = 0) {
  const generation = ++playGeneration, selectedViewer = viewer;
  await detachPlayback(); if (generation !== playGeneration) return false;
  $('playing-title').textContent = file.title; text('player-message', 'Opening…'); $('video-slot').replaceChildren();
  if (!$('player').open) $('player').showModal();
  try {
    const result = await api('/api/playback', { method: 'POST', data: { viewer: selectedViewer, videoId: file.id } });
    if (generation !== playGeneration || !$('player').open || selectedViewer !== viewer) return false;
    const video = document.createElement('video'); video.controls = true; video.playsInline = true; video.preload = 'metadata';
    const context = { file, viewer:selectedViewer, leaseId:result.leaseId, seq:0, video, mediaUrl:mediaUrl(result.mediaUrl), playbackContext, retryCount, diagnosing:false, recovering:false, ready:false, started:false, timer:null, bufferTimer:null, lastTime:0 };
    active = context; $('video-slot').replaceChildren(video);
    const clearBuffer = () => { clearTimeout(context.bufferTimer); context.bufferTimer = null; };
    const recover = async reason => {
      if (active !== context || context.recovering || !context.started || video.paused || video.ended) return;
      context.recovering = true; clearBuffer(); await saveProgress(context); video.pause();
      text('player-message', reason === 'buffer' ? 'Buffering · switching to a lower resolution…' : 'Stream failed · finding a lower-resolution source…');
      const moved = playbackContext ? await discoveryUI.recoverPlayback(playbackContext) : false;
      if (moved) return;
      if (active !== context) return;
      if (retryCount < 1) { text('player-message', 'Refreshing the TorBox link…'); await startPlayback(file, playbackContext, retryCount + 1); return; }
      context.recovering = false; text('player-message', 'Playback could not recover automatically. Close the player and choose another source.', true);
    };
    const armBuffer = () => {
      if (!context.started || video.paused || video.ended || context.recovering) return;
      clearBuffer(); context.bufferTimer = setTimeout(() => recover('buffer'), 12000);
    };
    video.addEventListener('loadedmetadata', () => {
      if (active !== context) return;
      const local = playbackContext ? recentForContext(playbackContext) : null;
      const position = Math.max(result.progress.position || 0, resumePosition(local));
      if (Number.isFinite(video.duration) && position > 0) video.currentTime = Math.min(position, Math.max(0, video.duration - .25));
      context.ready = true;
      if (playbackContext) { recordRecent(playbackContext, position, video.duration || 0); scheduleRecentRender(); }
      text('player-message', position > 0 ? `Resuming ${formatResumeTime(position)}` : '');
      video.play().catch(error => { if (active === context && error.name === 'NotAllowedError') text('player-message', 'Tap play'); });
    });
    video.addEventListener('playing', () => { if (active === context) { context.started = true; context.recovering = false; clearBuffer(); text('player-message', ''); } });
    video.addEventListener('canplay', clearBuffer);
    video.addEventListener('timeupdate', () => { if (active !== context && !context.ready) return; if (Math.abs(video.currentTime - context.lastTime) > .2) { context.lastTime = video.currentTime; clearBuffer(); } });
    video.addEventListener('waiting', armBuffer); video.addEventListener('stalled', armBuffer);
    video.addEventListener('pause', () => { if (active === context && !context.recovering) saveProgress(context); });
    video.addEventListener('seeked', () => { if (active === context && context.ready && context.started) saveProgress(context); });
    video.addEventListener('ended', async () => {
      if (active !== context) return; clearBuffer(); await saveProgress(context);
      if (playbackContext) { recordRecent(playbackContext, video.duration || video.currentTime, video.duration || 0, { completed:true }); scheduleRecentRender(); }
      if (playbackContext?.queue?.length) {
        const next=playbackContext.queue[0]; text('player-message', `Next · S${next.season}E${next.episode} ${next.name || ''}`);
        const moved=await discoveryUI.playNext(playbackContext); if(!moved&&active===context)text('player-message','Next episode could not be selected automatically.',true);
      } else text('player-message','Finished');
    });
    video.addEventListener('error', async () => {
      if (active !== context || context.diagnosing) return; context.diagnosing = true; clearBuffer();
      const diagnosis = await diagnosePlaybackFailure(context.mediaUrl, video.error?.code);
      if (active !== context || generation !== playGeneration) return;
      if (diagnosis.kind !== 'cancelled') { await recover('error'); return; }
      text('player-message', diagnosis.message, true);
    });
    context.timer=setInterval(()=>{if(active===context&&!video.paused)saveProgress(context);},10000);
    video.src=context.mediaUrl; return true;
  } catch (error) { if (generation===playGeneration) text('player-message',error.message,true); return false; }
}
$('close-player').addEventListener('click', () => $('player').close());
$('player').addEventListener('close', () => stopPlayback());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(active, true); });
window.addEventListener('pagehide', () => { saveProgress(active, true); });
$('owner-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const password = $('owner-password').value; $('owner-password').value = ''; text('owner-message', 'Checking connection…'); $('diagnostics').textContent = '';
  try {
    await api('/api/owner/unlock', { method: 'POST', data: { apiKey: password } }); $('revoke').hidden = false;
    const result = await api('/api/owner/diagnostics', { method: 'POST', data: {} });
    text('owner-message', 'TorBox accepted this key. Render is holding it only in this process session; video remains direct from TorBox.');
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

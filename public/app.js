import { createDiscoveryUI } from './discover.js';
import { diagnosePlaybackFailure } from './playback-errors.js';
import { apiUrl, mediaUrl, apiMode, getSessionToken, setSessionToken, clearSessionToken, credentialsMode } from './runtime.js';
import { rememberApiKey, loadRememberedApiKey, forgetApiKey } from './vault.js';
import { listRecent, recordRecent, clearRecent, recentForContext, resumePosition, formatResumeTime } from './history.js';
const $ = id => document.getElementById(id);
let csrf = '', sessionToken = getSessionToken(), playGeneration = 0, active = null, recentRenderTimer, guestMode = false, driveSelected = null, driveRunId = '', drivePollTimer = null, driveConfigured = false, driveOauthUrl = '';
let discoveryUI;
let viewer = 'viewer-1';
try { const saved = sessionStorage.getItem('tw-viewer'); if (['viewer-1', 'viewer-2'].includes(saved)) viewer = saved; } catch {}
$('viewer').value = viewer;
function text(id, value, error = false) { $(id).textContent = value; $(id).classList.toggle('error', error); }
function formatDriveSize(bytes) { return Number.isFinite(bytes) && bytes > 0 ? (bytes / 1024 ** 3).toFixed(2) + ' GB' : 'size unknown'; }
function formatDriveElapsed(ms) {
  const seconds = Math.max(0, Math.round((ms || 0) / 1000));
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}
async function openDriveTest(file, context = {}) {
  if (guestMode || !file?.id) return;
  driveSelected = { file, context };
  driveRunId = '';
  $('drive-selected').textContent = [context.title || file.title, context.episodeName || '', formatDriveSize(file.size)].filter(Boolean).join(' · ');
  $('drive-progress').hidden = true; $('drive-ready-actions').hidden = true; $('drive-status').textContent = ''; $('drive-timing').textContent = ''; $('drive-delete-note').textContent = '';
  if (!$('drive-dialog').open) $('drive-dialog').showModal();
  try {
    const config = await api('/api/drive/config');
    driveConfigured = config.configured === true;
    driveOauthUrl = config.oauthUrl || 'https://api.torbox.app/v1/api/integration/oauth/google';
    $('drive-connected-until').textContent = config.expiresAt ? 'Connected until ' + new Date(config.expiresAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + '.' : '';
  } catch { driveConfigured = false; driveOauthUrl = 'https://api.torbox.app/v1/api/integration/oauth/google'; $('drive-connected-until').textContent = ''; }
  $('drive-setup').hidden = driveConfigured;
  $('drive-test-controls').hidden = !driveConfigured;
}
function stopDrivePolling() { if (drivePollTimer) clearTimeout(drivePollTimer); drivePollTimer = null; }
function scheduleDrivePoll(delay = 1800) { stopDrivePolling(); drivePollTimer = setTimeout(pollDriveTest, delay); }
function updateDriveStatus(result) {
  const pct = Math.round((Number(result.progress) || 0) * 100);
  $('drive-progress-bar').value = Number(result.progress) || 0;
  const labels = {
    queued: 'Waiting for TorBox to queue the Google Drive transfer…',
    pending: 'TorBox queued the Google Drive transfer…',
    uploading: 'TorBox → Google Drive · ' + pct + '%',
    drive_locating: 'Upload finished · locating the file in Drive…',
    drive_processing: 'Upload finished · Google Drive is processing the video…',
    ready: 'Ready to watch from Google Drive.',
    failed: result.detail || 'Drive transfer failed.',
    deleted: 'The temporary Drive copy was deleted.'
  };
  text('drive-status', labels[result.status] || result.detail || result.status, result.status === 'failed');
  const timing = ['Elapsed ' + formatDriveElapsed(result.elapsedMs)];
  if (Number.isFinite(result.uploadMs)) timing.push('TorBox → Drive ' + formatDriveElapsed(result.uploadMs));
  if (Number.isFinite(result.playbackMs)) timing.push('Playable ' + formatDriveElapsed(result.playbackMs));
  $('drive-timing').textContent = timing.join(' · ');
  if (result.previewUrl) {
    $('drive-open').href = result.previewUrl; $('drive-ready-actions').hidden = false;
    $('drive-delete-note').textContent = (result.downloadRestricted ? 'Viewer download/copy is disabled. ' : '') + (result.deleteAt ? 'Deletion scheduled for ' + new Date(result.deleteAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + '. Keep this test open until it deletes; this easy OAuth test is not yet restart-proof.' : '');
  }
  if (result.deleteError) $('drive-delete-note').textContent += ' Cleanup warning: ' + result.deleteError;
}
async function pollDriveTest() {
  if (!driveRunId) return;
  try {
    const result = await api('/api/drive/test/status?id=' + encodeURIComponent(driveRunId));
    updateDriveStatus(result);
    if (['failed', 'deleted'].includes(result.status)) { stopDrivePolling(); return; }
    scheduleDrivePoll(result.status === 'drive_processing' || result.status === 'ready' ? 3000 : 1800);
  } catch (error) {
    text('drive-status', error.message, true);
    if (error.code !== 'DRIVE_AUTH_EXPIRED') scheduleDrivePoll(5000);
  }
}

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
    if (result.error === 'LOGIN_REQUIRED') { clearSessionToken(); sessionToken = ''; csrf = ''; stopPlayback(); if ($('player').open) $('player').close(); show('login'); }
    const error = new Error(result.message || 'The request failed.'); error.code = result.error; throw error;
  }
  return result;
}
function guestTokenFromHash() {
  try {
    const match = /^#guest=([A-Za-z0-9_-]{43})$/.exec(location.hash || '');
    return match ? match[1] : '';
  } catch { return ''; }
}
async function acceptGuestInvite(token) {
  if (sessionToken && !guestMode) {
    try { sessionStorage.setItem('torbox-owner-session-backup', sessionToken); } catch {}
  }
  const previous = sessionToken;
  sessionToken = ''; csrf = '';
  try {
    const result = await api('/api/guest/accept', { method: 'POST', data: { token } });
    sessionToken = result.sessionToken || '';
    if (!sessionToken || !setSessionToken(sessionToken)) throw new Error('This browser could not save the temporary session.');
    csrf = result.csrf; guestMode = true;
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    return result;
  } catch (error) {
    sessionToken = previous;
    if (previous) setSessionToken(previous);
    throw error;
  }
}
function enterGuestUi() {
  guestMode = true;
  document.body.classList.add('guest-mode');
  $('logout').textContent = 'Leave';
}
function leaveGuestUi() {
  guestMode = false;
  document.body.classList.remove('guest-mode');
  $('logout').textContent = 'Sign out';
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
    const invite = guestTokenFromHash();
    if (invite && !guestMode) { await acceptGuestInvite(invite); return await bootstrap(); }
    const session = await api('/api/session');
    if (session.setupRequired) return show('setup-needed');
    if (!session.authenticated) {
      clearSessionToken(); sessionToken = ''; csrf = ''; leaveGuestUi();
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
    csrf = session.csrf; show('workspace');
    if (session.guest) {
      enterGuestUi();
      $('recent-section').hidden = true;
      await discoveryUI.activateGuest(session.scope);
      return;
    }
    leaveGuestUi(); renderRecent(); await discoveryUI.activate();
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
  try {
    await api('/api/logout', { method: 'POST', data: {} });
    clearSessionToken(); sessionToken = ''; csrf = ''; $('diagnostics').textContent = ''; $('owner-password').value = '';
    if (guestMode) {
      let backup = ''; try { backup = sessionStorage.getItem('torbox-owner-session-backup') || ''; sessionStorage.removeItem('torbox-owner-session-backup'); } catch {}
      leaveGuestUi();
      if (/^[A-Za-z0-9_-]{43}$/.test(backup)) { sessionToken = backup; setSessionToken(backup); return await bootstrap(); }
      autoLoginTried = true; show('login'); text('login-message', 'Temporary access ended.');
      return;
    }
    try { sessionStorage.removeItem('tw-viewer'); } catch {}
    autoLoginTried = true; show('login');
  } catch (error) { text('login-message', error.message, true); }
});
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
      if (active !== context || context.recovering || video.ended || (reason === 'buffer' && (!context.started || video.paused))) return;
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
    video.addEventListener('timeupdate', () => { if (active !== context || !context.ready) return; if (Math.abs(video.currentTime - context.lastTime) > .2) { context.lastTime = video.currentTime; clearBuffer(); } });
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
$('open-drive-oauth').addEventListener('click', () => {
  const url = driveOauthUrl || 'https://api.torbox.app/v1/api/integration/oauth/google';
  window.open(url, '_blank', 'noopener,noreferrer');
  text('drive-connect-message', 'Authorize Google Drive in the new tab. When TorBox says it succeeded, copy that page address, come back here, and tap Finish connection. The site will read your clipboard when Chrome permits it; the box below is the fallback.');
});
$('finish-drive-connect').addEventListener('click', async () => {
  const button = $('finish-drive-connect'); button.disabled = true; text('drive-connect-message', 'Checking Google Drive…');
  let successUrl = $('drive-success-url').value.trim();
  if (!successUrl && navigator.clipboard?.readText) {
    try { successUrl = (await navigator.clipboard.readText()).trim(); } catch {}
  }
  $('drive-success-url').value = '';
  try {
    if (!successUrl) throw new Error('Copy the TorBox Google success-page address first, or paste it into the box.');
    const result = await api('/api/drive/connect', { method: 'POST', data: { successUrl } });
    driveConfigured = true; driveOauthUrl = result.oauthUrl || driveOauthUrl;
    $('drive-setup').hidden = true; $('drive-test-controls').hidden = false;
    $('drive-connected-until').textContent = result.expiresAt ? 'Connected until ' + new Date(result.expiresAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) + '.' : '';
    text('drive-connect-message', '');
  } catch (error) { text('drive-connect-message', error.message, true); }
  finally { button.disabled = false; }
});
$('reconnect-drive').addEventListener('click', () => {
  driveConfigured = false; $('drive-setup').hidden = false; $('drive-test-controls').hidden = true; $('drive-connected-until').textContent = '';
});
$('start-drive-test').addEventListener('click', async () => {
  if (!driveSelected?.file?.id) return;
  const button = $('start-drive-test'); button.disabled = true; $('drive-progress').hidden = false; $('drive-ready-actions').hidden = true;
  text('drive-status', 'Starting TorBox → Google Drive transfer…'); $('drive-progress-bar').value = 0; $('drive-timing').textContent = '';
  try {
    const result = await api('/api/drive/test/start', { method: 'POST', data: { videoId: driveSelected.file.id, deleteMinutes: Number($('drive-delete-after').value), blockDownload: $('drive-block-download').checked } });
    driveRunId = result.id; updateDriveStatus(result); scheduleDrivePoll(800);
  } catch (error) { text('drive-status', error.message, true); }
  finally { button.disabled = false; }
});
$('delete-drive-now').addEventListener('click', async () => {
  if (!driveRunId) return;
  const button = $('delete-drive-now'); button.disabled = true;
  try { const result = await api('/api/drive/test/delete', { method: 'POST', data: { id: driveRunId } }); updateDriveStatus(result); stopDrivePolling(); }
  catch (error) { text('drive-status', error.message, true); }
  finally { button.disabled = false; }
});
$('copy-drive-link').addEventListener('click', async () => {
  const url = $('drive-open').href;
  try { await navigator.clipboard.writeText(url); $('drive-delete-note').textContent = 'Drive link copied. ' + $('drive-delete-note').textContent; }
  catch { text('drive-status', 'Could not copy automatically. Open the Drive player and copy its URL.', true); }
});
$('close-drive').addEventListener('click', () => $('drive-dialog').close());
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
discoveryUI = createDiscoveryUI({ api, play: startPlayback, driveTest: openDriveTest });
bootstrap();

const BRIDGE_SECRET = 'REPLACE_WITH_A_LONG_RANDOM_SECRET_32_CHARS_OR_MORE';
const DELETE_PREFIX = 'torbox_share_delete:';

function doPost(e) {
  try {
    const input = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!input || input.secret !== BRIDGE_SECRET) return json_({ ok: false, error: 'Unauthorized.' });
    switch (input.action) {
      case 'ping': return ping_();
      case 'token': return json_({ ok: true, token: ScriptApp.getOAuthToken() });
      case 'find': return find_(String(input.name || ''), Number(input.afterMs || 0));
      case 'publish': return publish_(String(input.fileId || ''), Number(input.deleteAt || 0), input.blockDownload !== false);
      case 'inspect': return inspect_(String(input.fileId || ''));
      case 'delete': return delete_(String(input.fileId || ''));
      default: return json_({ ok: false, error: 'Unknown action.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err).slice(0, 500) });
  }
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function authHeaders_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Accept: 'application/json' };
}
function driveFetch_(url, options) {
  const opts = Object.assign({ muteHttpExceptions: true, headers: authHeaders_() }, options || {});
  if (opts.payload && typeof opts.payload !== 'string') {
    opts.payload = JSON.stringify(opts.payload);
    opts.contentType = 'application/json';
  }
  const response = UrlFetchApp.fetch(url, opts);
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (status < 200 || status >= 300) {
    let detail = text;
    try { detail = JSON.parse(text).error.message || text; } catch (_) {}
    throw new Error('Google Drive HTTP ' + status + ': ' + String(detail).slice(0, 300));
  }
  return text ? JSON.parse(text) : {};
}
function ping_() {
  driveFetch_('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)');
  return json_({ ok: true, bridge: 'TorBox Drive Share Bridge', driveScope: 'drive.file' });
}
function escapeDriveQuery_(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function find_(name, afterMs) {
  if (!name) throw new Error('Missing filename.');
  const after = new Date(Math.max(0, afterMs - 60000)).toISOString();
  const q = "name = '" + escapeDriveQuery_(name) + "' and trashed = false and createdTime >= '" + after + "'";
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&orderBy=createdTime%20desc&pageSize=10&fields=files(id,name,createdTime,webViewLink,videoMediaMetadata)';
  const data = driveFetch_(url);
  const file = (data.files || [])[0];
  return json_({ ok: true, fileId: file && file.id || '', name: file && file.name || '' });
}
function publish_(fileId, deleteAt, blockDownload) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new Error('Invalid Drive file ID.');
  driveFetch_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '/permissions?sendNotificationEmail=false&supportsAllDrives=true', {
    method: 'post',
    payload: { type: 'anyone', role: 'reader', allowFileDiscovery: false }
  });
  let downloadRestricted = false;
  if (blockDownload) {
    try {
      driveFetch_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,downloadRestrictions', {
        method: 'patch',
        payload: { downloadRestrictions: { itemDownloadRestriction: { restrictedForReaders: true, restrictedForWriters: false } } }
      });
      downloadRestricted = true;
    } catch (err) {
      driveFetch_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true&fields=id,copyRequiresWriterPermission', {
        method: 'patch',
        payload: { copyRequiresWriterPermission: true }
      });
      downloadRestricted = true;
    }
  }
  scheduleDelete_(fileId, deleteAt);
  return json_({
    ok: true,
    previewUrl: 'https://drive.google.com/file/d/' + fileId + '/preview',
    viewUrl: 'https://drive.google.com/file/d/' + fileId + '/view',
    downloadRestricted: downloadRestricted,
    deleteAt: new Date(deleteAt).toISOString()
  });
}
function inspect_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new Error('Invalid Drive file ID.');
  const data = driveFetch_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id,name,mimeType,size,videoMediaMetadata,capabilities(canDownload)&supportsAllDrives=true');
  const meta = data.videoMediaMetadata || {};
  return json_({ ok: true, name: data.name || '', videoReady: !!(meta.durationMillis || meta.width || meta.height), canDownload: data.capabilities && data.capabilities.canDownload });
}
function delete_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) throw new Error('Invalid Drive file ID.');
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true', {
    method: 'delete', muteHttpExceptions: true, headers: authHeaders_()
  });
  const code = response.getResponseCode();
  if (code !== 204 && code !== 404) throw new Error('Google Drive delete returned HTTP ' + code + '.');
  PropertiesService.getScriptProperties().deleteProperty(DELETE_PREFIX + fileId);
  scheduleNextCleanup_();
  return json_({ ok: true, deleted: true });
}
function scheduleDelete_(fileId, deleteAt) {
  if (!Number.isFinite(deleteAt) || deleteAt <= Date.now()) throw new Error('Invalid deletion time.');
  PropertiesService.getScriptProperties().setProperty(DELETE_PREFIX + fileId, String(Math.floor(deleteAt)));
  scheduleNextCleanup_();
}
function scheduleNextCleanup_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleanupExpiredShares').forEach(t => ScriptApp.deleteTrigger(t));
  const props = PropertiesService.getScriptProperties().getProperties();
  const times = Object.keys(props).filter(k => k.indexOf(DELETE_PREFIX) === 0).map(k => Number(props[k])).filter(Number.isFinite);
  if (!times.length) return;
  const when = Math.max(Date.now() + 60000, Math.min.apply(null, times));
  ScriptApp.newTrigger('cleanupExpiredShares').timeBased().at(new Date(when)).create();
}
function cleanupExpiredShares() {
  const propsService = PropertiesService.getScriptProperties();
  const props = propsService.getProperties();
  const now = Date.now();
  let retryNeeded = false;
  Object.keys(props).filter(k => k.indexOf(DELETE_PREFIX) === 0).forEach(k => {
    const due = Number(props[k]);
    if (!Number.isFinite(due) || due > now) return;
    const fileId = k.slice(DELETE_PREFIX.length);
    try {
      const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?supportsAllDrives=true', {
        method: 'delete', muteHttpExceptions: true, headers: authHeaders_()
      });
      const code = response.getResponseCode();
      if (code === 204 || code === 404) propsService.deleteProperty(k);
      else retryNeeded = true;
    } catch (_) { retryNeeded = true; }
  });
  if (retryNeeded) {
    ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'cleanupExpiredShares').forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('cleanupExpiredShares').timeBased().after(5 * 60 * 1000).create();
  } else {
    scheduleNextCleanup_();
  }
}

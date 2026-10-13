export const ENGINE_VERSION = '2.1.0';
export const MAX_ROM_BYTES = 16 * 1024 * 1024;
export const MAX_CATALOG_BYTES = 512 * 1024;
export const SUPPORTED_MAPPERS = Object.freeze([0, 1, 2, 3, 4, 5, 7, 9, 11, 34, 38, 66, 71, 79, 94, 118, 119, 140, 180, 240, 241]);
const mapperSet = new Set(SUPPORTED_MAPPERS);

export function catalogRomPath(value) {
  if (typeof value !== 'string' || value.length > 220) throw new Error('The game file path is invalid.');
  const path = value.replace(/^\.\//, '');
  if (!/^roms\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.nes$/i.test(path) || path.includes('..')) throw new Error('Games must use a .nes file in this website\'s roms folder.');
  return path;
}

export function cleanGamesCatalog(raw) {
  if (!raw || raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length > 2000) throw new Error('The game list is invalid.');
  const ids = new Set();
  const items = [];
  for (const row of raw.items) {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) || ids.has(row.id)) continue;
    if (typeof row.title !== 'string' || !row.title.trim() || row.title.length > 160) continue;
    try {
      const rom = catalogRomPath(row.rom);
      items.push({id: row.id, title: row.title.trim(), rom});
      ids.add(row.id);
    } catch { /* Ignore invalid catalog entries; never fetch their paths. */ }
  }
  return {version: 1, items: items.sort((a, b) => a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}) || a.id.localeCompare(b.id))};
}

export function validateRom(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_ROM_BYTES) throw new Error('This game is larger than the 16 MiB limit.');
  if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) throw new Error('Choose an uncompressed NES .nes game file. This file has no valid NES header.');
  const nes2 = (bytes[7] & 0x0c) === 8;
  if (bytes[7] & 3) throw new Error('This console variant is not supported. Choose a standard NES or Famicom game.');
  let mapper = (bytes[6] >> 4) | (bytes[7] & 0xf0);
  let prg = bytes[4], chr = bytes[5];
  if (nes2) {
    mapper |= (bytes[8] & 15) << 8;
    if (bytes[8] >> 4) throw new Error('This NES 2.0 submapper is not supported.');
    if ((bytes[9] & 15) === 15 || (bytes[9] >> 4) === 15) throw new Error('This NES 2.0 ROM size format is not supported.');
    prg |= (bytes[9] & 15) << 8;
    chr |= (bytes[9] >> 4) << 8;
    if ((bytes[12] & 3) === 1 || (bytes[12] & 3) === 3) throw new Error('This ROM requires PAL or Dendy timing. Choose an NTSC or multi-region game.');
  } else {
    // Ordinary iNES region bytes are safe to interpret only when the header
    // tail contains no historic text tags such as "DiskDude!".
    const recognizedTail = bytes[8] <= 16 && bytes[9] <= 1 && bytes[10] <= 3 && bytes.slice(11,16).every(value => value === 0);
    if (recognizedTail && ((bytes[9] & 1) || (bytes[10] & 3) === 2)) throw new Error('This ROM requires PAL timing. Choose an NTSC game.');
    if (bytes.slice(8, 16).some(value => value !== 0)) {
      // Match JSNES's handling of old iNES dumps with junk header tails.
      mapper &= 15;
    }
  }
  if (!mapperSet.has(mapper)) throw new Error(`This game uses mapper ${mapper}, which this NES engine does not support.`);
  if (!prg) throw new Error('This ROM has no game program.');
  const required = 16 + ((bytes[6] & 4) ? 512 : 0) + prg * 16384 + chr * 8192;
  if (required > MAX_ROM_BYTES) throw new Error('The NES header requests more than the 16 MiB limit.');
  if (bytes.length < required) throw new Error('This game file is incomplete. Its NES header describes more data than the file contains.');
  return {bytes, mapper, nes2, required};
}

export async function romHash(bytes, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Open the HTTPS website to enable game saves.');
  const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function saveIdentity(viewer, hash) {
  if (!['viewer-1', 'viewer-2'].includes(viewer) || !/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('The game save identity is invalid.');
  return `${viewer}:${hash}`;
}

export function makeSaveRecord(viewer, hash, state, now = Date.now()) {
  saveIdentity(viewer, hash);
  if (!validEmulatorState(state)) throw new Error('The emulator save is incomplete.');
  // JSNES toJSON retains some live arrays. Snapshot before any async storage.
  return {version: 1, engine: ENGINE_VERSION, viewer, hash, savedAt: now, state: structuredClone(state)};
}

function validEmulatorState(state) {
  return !!state && typeof state === 'object' && ['cpu', 'mmap', 'ppu', 'papu'].every(key => state[key] && typeof state[key] === 'object') && Array.isArray(state.cpu.mem) && state.cpu.mem.length === 65536;
}

export function validSaveRecord(record, viewer, hash) {
  return !!record && record.version === 1 && record.engine === ENGINE_VERSION && record.viewer === viewer && record.hash === hash && Number.isFinite(record.savedAt) && validEmulatorState(record.state);
}

export async function fetchBytes(url, {maxBytes = MAX_ROM_BYTES, timeoutMs = 12000, signal, fetchFn = fetch} = {}) {
  const response = await fetchFn(url, {credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)});
  if (!response.ok) throw new Error(response.status === 404 ? 'This game file is missing from the website.' : 'The game file could not load. Try again.');
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) { void response.body?.cancel().catch(() => {}); throw new Error('This file exceeds the size limit.'); }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('This file exceeds the size limit.');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('This file exceeds the size limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function createStateStore(indexedDBApi = globalThis.indexedDB) {
  let opening = null;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDBApi) { reject(new Error('This browser cannot store game saves.')); return; }
      const request = indexedDBApi.open('torbox-games-v1', 1);
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Game storage did not respond.')); }, 4000);
      request.onupgradeneeded = () => { if (settled) { request.transaction?.abort(); return; } if (!request.result.objectStoreNames.contains('states')) request.result.createObjectStore('states'); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true; clearTimeout(timer);
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('This browser blocked game saves.')); };
      request.onblocked = () => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error('Close other copies of this site to unlock game saves.')); };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function operation(key, mode, record) {
    if (!/^(viewer-[12]):[a-f0-9]{64}:(auto|manual)$/.test(key)) throw new Error('The game save key is invalid.');
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('states', mode);
      const store = transaction.objectStore('states');
      const request = mode === 'readonly' ? store.get(key) : store.put(record, key);
      const timer = setTimeout(() => { try { transaction.abort(); } catch {} reject(new Error('Game storage did not respond.')); }, 4000);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(mode === 'readonly' ? request.result ?? null : true); };
      transaction.onerror = transaction.onabort = () => { clearTimeout(timer); reject(new Error('The browser could not save this game. Check available storage.')); };
    });
  }
  return {
    get: (identity, slot = 'auto') => operation(`${identity}:${slot}`, 'readonly'),
    put: (identity, record, slot = 'auto') => operation(`${identity}:${slot}`, 'readwrite', record),
  };
}

export const MAX_CHEATS = 128;
const MAX_CODE_LENGTH = 64;
const MAX_FILE_BYTES = 64 * 1024;
const GENIE_CODE = /^[APZLGITYEOXUKSVN]{6}(?:[APZLGITYEOXUKSVN]{2})?$/;
const ROM_PATCH = /^([89A-F][0-9A-F]{3}):([0-9A-F]{2})(?:\?([0-9A-F]{2}))?$/;
const guardedGenies = new WeakSet();
const guardedDmc = new WeakSet();

export function emptyCheats() { return {version: 1, enabled: true, codes: []}; }

export function normalizeCheatCode(input) {
  if (typeof input !== 'string' || input.length > MAX_CODE_LENGTH) throw new Error('A cheat code must contain no more than 64 characters.');
  const candidate = input.trim().toUpperCase();
  if (ROM_PATCH.test(candidate)) return candidate;
  const letters = candidate.replace(/[\s-]/g, '');
  if (GENIE_CODE.test(letters)) return letters;
  throw new Error('Use a 6 or 8 letter NES Game Genie code, or a ROM patch such as 8000:FF or 8000:FF?00.');
}

function objectWithKeys(value, allowed) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
}
function normalizeName(name) {
  if (typeof name !== 'string' || name.trim().length > 80) throw new Error('A cheat name must contain no more than 80 characters.');
  return name.trim();
}

export function normalizeCheatSet(raw) {
  if (!objectWithKeys(raw, ['version', 'enabled', 'codes']) || raw.version !== 1 || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.codes) || raw.codes.length > MAX_CHEATS) {
    throw new Error('The cheat list must be a version 1 list with at most 128 codes and a true or false enabled setting.');
  }
  const unique = new Set();
  const codes = raw.codes.map(row => {
    if (!objectWithKeys(row, ['code', 'name', 'enabled']) || typeof row.enabled !== 'boolean') throw new Error('Each cheat must include a code, name, and true or false enabled setting.');
    const code = normalizeCheatCode(row.code), name = normalizeName(row.name);
    if (unique.has(code)) throw new Error('The cheat list contains the same code more than once: ' + code);
    unique.add(code);
    return {code, name, enabled: row.enabled};
  });
  return {version: 1, enabled: raw.enabled, codes};
}

function boundedText(text) {
  if (typeof text !== 'string' || text.length > MAX_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error('The cheat file must be text no larger than 64 KiB.');
  return text;
}

export function parseCheatLines(text, name = '') {
  const title = normalizeName(name);
  const lines = boundedText(text).split(/\r\n?|\n/).filter(line => line.trim());
  if (lines.length > MAX_CHEATS) throw new Error('A cheat list can contain at most 128 codes.');
  return normalizeCheatSet({version: 1, enabled: true, codes: lines.map(line => ({code: line, name: title, enabled: true}))}).codes;
}

export function applyCheats(nes, model) {
  const normalized = normalizeCheatSet(model);
  const genie = nes?.gameGenie;
  if (!genie || !Array.isArray(genie.patches) || ['removeAllCodes', 'addCode', 'addPatch', 'setEnabled', 'applyCodes'].some(method => typeof genie[method] !== 'function')) throw new Error('This NES engine does not support Game Genie cheats.');
  if (!guardedGenies.has(genie)) {
    const nativeApply = genie.applyCodes.bind(genie);
    // A real Game Genie intercepts cartridge ROM reads only. The pinned engine
    // otherwise aliases masked ROM addresses with mapper RAM and I/O reads.
    genie.applyCodes = (address, value) => Number.isInteger(address) && address >= 0x8000 && address <= 0xffff ? nativeApply(address, value) : value;
    guardedGenies.add(genie);
  }
  const dmc = nes.papu?.dmc;
  if (typeof dmc?.nextSample === 'function' && !guardedDmc.has(dmc)) {
    const nativeNextSample = dmc.nextSample;
    // Native DMC fetches bypass the CPU read interceptor. Patch the one fetched
    // byte after its synchronous DMA work, preserving native counters and timing.
    dmc.nextSample = function (...args) {
      const address = this.playAddress;
      const result = nativeNextSample.apply(this, args);
      this.data = genie.applyCodes(address, this.data);
      this.lastFetchedByte = this.data;
      return result;
    };
    guardedDmc.add(dmc);
  }
  const previous = {patches: genie.patches.map(patch => ({...patch})), enabled: genie.enabled};
  try {
    genie.removeAllCodes();
    for (const row of normalized.codes) {
      if (!row.enabled) continue;
      const patch = ROM_PATCH.exec(row.code);
      if (patch) genie.addPatch(parseInt(patch[1], 16) & 0x7fff, parseInt(patch[2], 16), patch[3] === undefined ? undefined : parseInt(patch[3], 16));
      else genie.addCode(row.code);
    }
    // setEnabled invokes the engine's onChange callback, including after reset
    // or fromJSON replaced its CPU and removed the previous read interceptor.
    genie.setEnabled(normalized.enabled);
  } catch (error) {
    genie.patches = previous.patches; genie.enabled = previous.enabled;
    try { genie.onChange?.(); } catch { /* Restore the native CPU directly below. */ }
    try { nes.cpu?._updateCartridgeLoader?.(); } catch { /* Best effort for an unsupported callback override. */ }
    throw new Error('These cheats could not be applied. Previous cheats remain active.', {cause: error});
  }
  return normalized;
}

export function cheatStorageKey(identity) {
  if (typeof identity !== 'string' || !/^viewer-[12]:[a-f0-9]{64}$/.test(identity)) throw new Error('The cheat storage identity is invalid.');
  return 'torbox-games-cheats-v1:' + identity;
}
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

export function readCheats(identity, storage = browserStorage()) {
  const key = cheatStorageKey(identity);
  try {
    const text = storage?.getItem(key);
    return text == null ? emptyCheats() : importCheats(text);
  } catch { return emptyCheats(); }
}
export function writeCheats(identity, model, storage = browserStorage()) {
  const key = cheatStorageKey(identity), normalized = normalizeCheatSet(model);
  try {
    if (!storage || typeof storage.setItem !== 'function') throw new Error('Storage is unavailable.');
    storage.setItem(key, exportCheats(normalized));
  } catch { throw new Error('The browser could not store these cheats. They remain available for this session.'); }
  return normalized;
}

export function importCheats(text) {
  let raw;
  try { raw = JSON.parse(boundedText(text)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new Error('This file is not valid cheat-list JSON.');
    throw error;
  }
  return normalizeCheatSet(raw);
}
export function exportCheats(model) { return JSON.stringify(normalizeCheatSet(model), null, 2); }

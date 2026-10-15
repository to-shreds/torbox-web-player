import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MAX_CHEATS, emptyCheats, normalizeCheatCode, normalizeCheatSet, parseCheatLines, applyCheats, cheatStorageKey, readCheats, writeCheats, importCheats, exportCheats} from '../public/games-cheats.js';
import {SUPPORTED_MAPPERS} from '../public/games-core.js';

const vendor = await readFile(new URL('../public/vendor/jsnes-2.1.0-torbox.1.min.js', import.meta.url), 'utf8');
function originalROM(mapper = 0) {
  // Original NROM program: read a ROM constant, store it in zero-page RAM,
  // and repeat. It lets the actual CPU, rather than a stub, prove interception.
  const rom = new Uint8Array(16 + 16384 + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1, (mapper & 15) << 4, mapper & 0xf0]);
  rom.fill(0xea, 16, 16 + 16384);
  rom.set([0xad, 0x00, 0x81, 0x85, 0x00, 0x4c, 0x80, 0x80], 16 + 0x80);
  rom[16 + 0x100] = 0x31;
  rom[16 + 0x110] = 0x42;
  rom[16 + 0x2000] = 0x44;
  rom[16 + 0x2002] = 0x55;
  for (const offset of [0x3ffa, 0x3ffc, 0x3ffe]) rom.set([0x80, 0x80], 16 + offset);
  return rom;
}
function engine(mapper = 0) {
  const sandbox = {};
  vm.runInNewContext(vendor, sandbox);
  const nes = new sandbox.jsnes.NES({emulateSound: false});
  nes.loadROM(originalROM(mapper));
  return nes;
}
function cheats(codes = [], enabled = true) {
  return {version: 1, enabled, codes: codes.map(code => typeof code === 'string' ? {code, name: '', enabled: true} : code)};
}
function memoryStorage() {
  const items = new Map();
  return {items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value)};
}
const firstIdentity = 'viewer-1:' + 'a'.repeat(64);

test('Game Genie normalization accepts exactly 6 or 8 alphabet letters and canonicalizes separators', () => {
  assert.equal(normalizeCheatCode(' sx-iO po '), 'SXIOPO');
  assert.equal(normalizeCheatCode('gzux-ngei'), 'GZUXNGEI');
  assert.equal(normalizeCheatCode('A P Z L G I'), 'APZLGI');
  for (const value of ['', 'AAAAA', 'AAAAAAA', 'AAAAAAAAA', 'AAAAAB', 'ABCDEF', 'SXIOPO!', 'SXIOPO;alert(1)', 'SXI0PO', null, 42, ' '.repeat(65) + 'SXIOPO']) assert.throws(() => normalizeCheatCode(value));
});

test('raw ROM codes require exact CPU cartridge addresses and one-byte value/optional compare', () => {
  for (const code of ['8000:00', 'FFFF:FF', 'A002:19?00', 'E000:34?44']) assert.equal(normalizeCheatCode(code), code);
  assert.equal(normalizeCheatCode('  abcd:ef?ab  '), 'ABCD:EF?AB');
  for (const code of ['0000:AA', '7FFF:AA', '10000:AA', '800:AA', '08000:AA', '8000:A', '8000:AAA', '8000:AA?', '8000:AA?A', '8000:AA?AAA', 'prefix8000:AA', '8000:AAjunk', '8000: AA', '80-00:AA', '8000:AA\n8001:BB', '0x8000:FF']) assert.throws(() => normalizeCheatCode(code));
  const nes = engine();
  assert.ok(nes.gameGenie.decode('prefix8000:AAjunk'), 'the pinned decoder permits unanchored hex input');
  assert.ok(nes.gameGenie.decode('AAAAAB'), 'the pinned decoder permits letters outside the Game Genie alphabet');
});

test('cheat models preserve order, names and disabled states, with strict booleans and bounded unique codes', () => {
  const model = normalizeCheatSet(cheats([{code: 'sx-iopo', name: ' Infinite lives ', enabled: false}, {code: '8100:AA', name: '', enabled: true}], false));
  assert.deepEqual(model, {version: 1, enabled: false, codes: [{code: 'SXIOPO', name: 'Infinite lives', enabled: false}, {code: '8100:AA', name: '', enabled: true}]});
  const many = cheats(Array.from({length: MAX_CHEATS}, (_, n) => (0x8000 + n).toString(16) + ':AA'));
  assert.equal(normalizeCheatSet(many).codes.length, 128);
  assert.throws(() => normalizeCheatSet(cheats([...many.codes, {code: '9000:AA', name: '', enabled: true}])), /128/);
  assert.throws(() => normalizeCheatSet(cheats(['SXIOPO', 'sx-iopo'])), /same code/);
  assert.throws(() => normalizeCheatSet(cheats(['ABCD:EF', 'abcd:ef'])), /same code/);
  for (const bad of [null, [], {}, {...many, version: 2}, {...many, enabled: 1}, {...many, codes: {}}, {...many, credentials: 'extra'}, cheats([{code: 'SXIOPO', name: '', enabled: 'true'}]), cheats([{code: 'SXIOPO', enabled: true}]), cheats([{code: 'SXIOPO', name: 'a'.repeat(81), enabled: true}]), cheats([{code: 'SXIOPO', name: '', enabled: true, hash: 'extra'}])]) assert.throws(() => normalizeCheatSet(bad));
  model.codes[0].name = 'changed';
  assert.deepEqual(emptyCheats(), {version: 1, enabled: true, codes: []});
});

test('multi-line additions validate the entire bounded batch before returning any codes', () => {
  assert.deepEqual(parseCheatLines('\n sx-iopo\r\n\r\n8100:AA?31\r', ' Lives '), [{code: 'SXIOPO', name: 'Lives', enabled: true}, {code: '8100:AA?31', name: 'Lives', enabled: true}]);
  assert.deepEqual(parseCheatLines(' \n\t'), []);
  assert.throws(() => parseCheatLines('SXIOPO\nBAD'), /Game Genie/);
  assert.throws(() => parseCheatLines('SXIOPO\nsx-iopo'), /same code/);
  assert.throws(() => parseCheatLines(Array.from({length: 129}, (_, n) => (0x8000 + n).toString(16) + ':AA').join('\n')), /128/);
  assert.throws(() => parseCheatLines('SXIOPO', 'n'.repeat(81)), /80/);
  assert.throws(() => parseCheatLines(' '.repeat(65537)), /64 KiB/);
});

test('real CPU execution uses raw ROM patches while the stored ROM bytes remain intact', () => {
  const nes = engine();
  nes.frame();
  assert.equal(nes.cpu.mem[0], 0x31);
  applyCheats(nes, cheats(['8100:AA']));
  nes.frame();
  assert.equal(nes.cpu.mem[0], 0xaa);
  assert.equal(nes.mmap.load(0x8100), 0x31);
  applyCheats(nes, cheats(['8100:AA'], false));
  nes.frame();
  assert.equal(nes.cpu.mem[0], 0x31);
});

test('native 6-letter and 8-letter codes retain compare semantics and first matching priority', () => {
  const nes = engine(), gg = nes.gameGenie;
  const six = gg.encode(0x100, 0xaa);
  const eight = gg.encode(0x100, 0xbb, 0x31);
  assert.equal(six.length, 6); assert.equal(eight.length, 8);
  applyCheats(nes, cheats([eight]));
  assert.equal(nes.cpu.load(0x8100), 0xbb);
  nes.cpu.mem[0x8100] = 0x32;
  assert.equal(nes.cpu.load(0x8100), 0x32, '8-letter comparison must match the underlying ROM value');
  nes.cpu.mem[0x8100] = 0x31;
  applyCheats(nes, cheats(['8100:DD?99', eight, six]));
  assert.equal(nes.cpu.load(0x8100), 0xbb, 'first matching conditional code wins');
  applyCheats(nes, cheats([six, eight]));
  assert.equal(nes.cpu.load(0x8100), 0xaa, 'first unconditional code has priority');
  applyCheats(nes, cheats([{code: six, name: 'off', enabled: false}, {code: eight, name: 'on', enabled: true}]));
  assert.equal(nes.cpu.load(0x8100), 0xbb);
  applyCheats(nes, cheats([eight], false));
  assert.equal(nes.cpu.load(0x8100), 0x31);
  applyCheats(nes, emptyCheats());
  assert.equal(gg.patches.length, 0);
  assert.equal(nes.cpu.load(0x8100), 0x31);
});

test('strict validation is atomic and cannot replace working patches with a partly invalid list', () => {
  const nes = engine();
  applyCheats(nes, cheats(['8100:AA']));
  assert.throws(() => applyCheats(nes, cheats(['8100:BB', 'BAD'])));
  assert.equal(nes.cpu.load(0x8100), 0xaa);
  assert.throws(() => applyCheats({}, emptyCheats()), /engine/);
});

test('unexpected native callbacks or addCode failures roll back patches and CPU interception together', () => {
  for (const kind of ['callback', 'addCode']) {
    const nes = engine();
    applyCheats(nes, cheats(['8100:AA']));
    if (kind === 'callback') nes.gameGenie.onChange = () => { throw new Error('unexpected callback failure'); };
    else {
      const nativeAdd = nes.gameGenie.addCode;
      nes.gameGenie.addCode = function (code) { nativeAdd.call(this, code); throw new Error('unexpected add failure'); };
    }
    assert.throws(() => applyCheats(nes, cheats(['8100:BB', 'SXIOPO'], false)), /Previous cheats remain active/);
    assert.equal(nes.gameGenie.enabled, true);
    assert.equal(nes.gameGenie.patches.length, 1);
    assert.equal(nes.cpu.load(0x8100), 0xaa);
    const dmc = nes.papu.dmc; dmc.playAddress = 0x8100; dmc.playLengthCounter = 1;
    dmc.nextSample(); assert.equal(dmc.data, 0xaa);
  }
});

test('known Game Genie codes intercept native CPU cartridge reads across every supported mapper', () => {
  for (const mapper of SUPPORTED_MAPPERS) {
    const nes = engine(mapper), gg = nes.gameGenie;
    if (mapper === 5) {
      // MMC5 permits RAM in upper CPU banks. Explicitly map ROM, as the tested
      // game would, so this probe measures cartridge ROM interception.
      nes.mmap.write(0x5100, 3);
      for (const [address, bank] of [[0x5114, 0x80], [0x5115, 0x81], [0x5116, 0x80], [0x5117, 0x81]]) nes.mmap.write(address, bank);
    }
    const six = gg.decode('SXIOPO'), eight = gg.decode('GZUXNGEI');
    const sixAddress = six.addr | 0x8000, eightAddress = eight.addr | 0x8000;
    nes.cpu.mem[sixAddress] = 0x31;
    nes.cpu.mem[eightAddress] = eight.key;
    // MMC5 reads mapped ROM banks directly instead of the copied CPU buffer.
    nes.rom.rom[0][sixAddress & 0x3fff] = 0x31;
    nes.rom.rom[0][eightAddress & 0x3fff] = eight.key;
    applyCheats(nes, cheats(['SXIOPO', 'GZUXNGEI']));
    assert.equal(nes.cpu.load(sixAddress), six.value, `mapper ${mapper} six-letter code`);
    assert.equal(nes.cpu.load(eightAddress), eight.value, `mapper ${mapper} eight-letter compare`);
    nes.cpu.mem[eightAddress] = eight.key ^ 1;
    nes.rom.rom[0][eightAddress & 0x3fff] = eight.key ^ 1;
    assert.equal(nes.cpu.load(eightAddress), eight.key ^ 1, `mapper ${mapper} mismatched compare`);
    applyCheats(nes, cheats(['SXIOPO', 'GZUXNGEI'], false));
    assert.equal(nes.cpu.load(sixAddress), 0x31, `mapper ${mapper} global disabled`);
  }
});

test('reset and saved-state restore reattach native CPU interception without accumulating wrappers', () => {
  const nes = engine(), model = cheats(['8100:AA']);
  applyCheats(nes, model);
  const wrapped = nes.gameGenie.applyCodes;
  nes.frame();
  const saved = structuredClone(nes.toJSON());
  nes.reloadROM();
  assert.equal(nes.cpu.load(0x8100), 0x31, 'reset replaces the CPU read interceptor');
  applyCheats(nes, model);
  assert.equal(nes.cpu.load(0x8100), 0xaa);
  nes.fromJSON(saved);
  assert.equal(nes.cpu.load(0x8100), 0x31, 'fromJSON also replaces the CPU read interceptor');
  applyCheats(nes, model);
  assert.equal(nes.cpu.load(0x8100), 0xaa);
  assert.equal(nes.gameGenie.applyCodes, wrapped, 'the ROM-only guard is installed once');
  assert.equal(nes.gameGenie.patches.length, 1);
  nes.frame();
  assert.equal(nes.cpu.mem[0], 0xaa);
});

test('ROM masking cannot alias cheats into mapper RAM, PPU registers or APU registers', () => {
  const nes = engine();
  const original = nes.mmap.load.bind(nes.mmap), reads = [];
  // Deterministic original values still pass through the actual CPU's native
  // interceptor. PPU status reads would otherwise alter state while comparing.
  nes.mmap.load = address => { reads.push(address); return address < 0x8000 ? 0x44 : original(address); };
  applyCheats(nes, cheats(['E000:BB?44', 'A002:CC?44', 'C015:DD?44']));
  for (const address of [0x6000, 0x2002, 0x4015]) assert.equal(nes.cpu.load(address), 0x44);
  assert.equal(nes.cpu.load(0xe000), 0xbb);
  assert.deepEqual(reads, [0x6000, 0x2002, 0x4015, 0xe000]);
  assert.equal(nes.gameGenie.applyCodes(0x10000, 0x44), 0x44);
});

test('actual mapper RAM, PPU status and APU status reads match an unpatched native engine', () => {
  const patched = engine(), baseline = engine();
  for (const nes of [patched, baseline]) {
    nes.cpu.mem[0x6000] = 0x44;
    nes.cpu.mem[0x2002] = 0x40;
    nes.ppu.openBusLatch = 0x1f;
    nes.papu.square1.lengthCounter = 8;
    nes.papu.noise.lengthCounter = 8;
    nes.papu.dmc.playLengthCounter = 1;
    nes.papu.frameIrqEnabled = true;
    nes.papu.frameIrqActive = true;
  }
  applyCheats(patched, cheats(['E000:BB', 'A002:CC', 'C015:DD']));
  for (const address of [0x6000, 0x2002, 0x4015]) assert.equal(patched.cpu.load(address), baseline.cpu.load(address), `native register ${address.toString(16)} must be unchanged`);
  assert.equal(patched.cpu.mem[0x6000], baseline.cpu.mem[0x6000]);
  assert.equal(patched.ppu.openBusLatch, baseline.ppu.openBusLatch);
  assert.equal(patched.papu.frameIrqActive, baseline.papu.frameIrqActive);
  assert.equal(patched.cpu.load(0xe000), 0xbb);
});

test('DMC sample fetches receive one compared patch while preserving native DMA timing and address wrap', () => {
  const nes = engine(), model = cheats(['8100:AA?31', '8100:BB?AA']);
  applyCheats(nes, model);
  const dmc = nes.papu.dmc, wrapped = dmc.nextSample;
  const fetch = (address, length = 3) => {
    dmc.playAddress = address; dmc.playLengthCounter = length; nes.cpu.cyclesToHalt = 0; dmc.hasSample = false;
    dmc.nextSample();
    assert.equal(nes.cpu.cyclesToHalt, 4);
    assert.equal(dmc.playLengthCounter, length - 1);
    assert.equal(dmc.hasSample, true);
  };
  fetch(0x8100);
  assert.equal(dmc.data, 0xaa, 'compare patch must be applied once, rather than chaining AA into BB');
  assert.equal(dmc.lastFetchedByte, 0xaa); assert.equal(dmc.playAddress, 0x8101);
  applyCheats(nes, cheats(['8100:FF?99'])); fetch(0x8100);
  assert.equal(dmc.data, 0x31);
  applyCheats(nes, cheats(['8100:AA'], false)); fetch(0x8100);
  assert.equal(dmc.data, 0x31);
  applyCheats(nes, cheats(['FFFF:66'])); fetch(0xffff, 1);
  assert.equal(dmc.data, 0x66); assert.equal(dmc.lastFetchedByte, 0x66); assert.equal(dmc.playAddress, 0x8000);
  applyCheats(nes, model);
  assert.equal(dmc.nextSample, wrapped, 'one DMC wrapper per native channel');
});

test('new DMC channels created by reload and fromJSON receive current patches after resynchronization', () => {
  const nes = engine(), model = cheats(['8100:AA?31']);
  applyCheats(nes, model); nes.frame();
  const saved = structuredClone(nes.toJSON()), first = nes.papu.dmc;
  for (const reset of [() => nes.reloadROM(), () => nes.fromJSON(saved)]) {
    reset();
    const dmc = nes.papu.dmc;
    assert.notEqual(dmc, first);
    applyCheats(nes, model);
    dmc.playAddress = 0x8100; dmc.playLengthCounter = 2; nes.cpu.cyclesToHalt = 0;
    dmc.nextSample();
    assert.equal(dmc.data, 0xaa); assert.equal(dmc.lastFetchedByte, 0xaa); assert.equal(nes.cpu.cyclesToHalt, 4);
  }
});

test('persistent lists are separated by viewer and ROM hash and preserve disabled names/states', () => {
  const storage = memoryStorage(), secondViewer = 'viewer-2:' + 'a'.repeat(64), otherROM = 'viewer-1:' + 'b'.repeat(64);
  const model = cheats([{code: 'sx-iopo', name: ' Lives ', enabled: false}], false);
  const result = writeCheats(firstIdentity, model, storage);
  assert.deepEqual(result, {version: 1, enabled: false, codes: [{code: 'SXIOPO', name: 'Lives', enabled: false}]});
  assert.deepEqual(readCheats(firstIdentity, storage), result);
  assert.deepEqual(readCheats(secondViewer, storage), emptyCheats());
  assert.deepEqual(readCheats(otherROM, storage), emptyCheats());
  assert.equal(storage.items.size, 1);
  assert.ok(cheatStorageKey(firstIdentity).startsWith('torbox-games-cheats-v1:viewer-1:'));
  for (const identity of ['viewer-3:' + 'a'.repeat(64), 'viewer-1:' + 'A'.repeat(64), firstIdentity + ':extra', '../../api', '']) assert.throws(() => cheatStorageKey(identity), /identity/);
  assert.throws(() => readCheats('bad', storage), /identity/);
});

test('storage denial and malformed records have finite behavior without destroying a valid existing list', () => {
  assert.deepEqual(readCheats(firstIdentity, {getItem: () => { throw new Error('denied'); }}), emptyCheats());
  assert.deepEqual(readCheats(firstIdentity, null), emptyCheats());
  for (const raw of ['{', '{}', 'null', exportCheats(emptyCheats()).replace('true', '"true"'), ' '.repeat(65537)]) assert.deepEqual(readCheats(firstIdentity, {getItem: () => raw}), emptyCheats());
  assert.throws(() => writeCheats(firstIdentity, emptyCheats(), null), /could not store/);
  assert.throws(() => writeCheats(firstIdentity, emptyCheats(), {setItem: () => { throw new Error('quota'); }}), /could not store/);
  const storage = memoryStorage(); writeCheats(firstIdentity, cheats(['8100:AA']), storage);
  assert.throws(() => writeCheats(firstIdentity, cheats(['BAD']), storage));
  assert.equal(readCheats(firstIdentity, storage).codes[0].code, '8100:AA');
});

test('portable JSON contains only normalized cheat settings and strictly rejects corrupt or oversized imports', () => {
  const model = cheats([{code: 'sx-iopo', name: ' Lives ', enabled: false}, {code: '8100:AA?31', name: 'Constant', enabled: true}], false);
  const exported = exportCheats(model), imported = importCheats(exported);
  assert.deepEqual(imported, normalizeCheatSet(model));
  assert.deepEqual(Object.keys(JSON.parse(exported)), ['version', 'enabled', 'codes']);
  assert.equal(exported.includes('viewer'), false); assert.equal(exported.includes('hash'), false);
  for (const input of ['{', 'null', '{"version":2,"enabled":true,"codes":[]}', '{"version":1,"enabled":"true","codes":[]}', '{"version":1,"enabled":true,"codes":[],"__proto__":{}}', exportCheats(cheats(['SXIOPO'])).replace('SXIOPO', 'INVALID')]) assert.throws(() => importCheats(input));
  assert.throws(() => importCheats(' '.repeat(65537)), /64 KiB/);
  assert.throws(() => importCheats('é'.repeat(40000)), /64 KiB/, 'the file cap is measured in bytes');
  assert.throws(() => importCheats(JSON.stringify(cheats(['SXIOPO', 'sx-iopo']))), /same code/);
});

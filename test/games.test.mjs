import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {MAX_ROM_BYTES, SUPPORTED_MAPPERS, ENGINE_VERSION, catalogRomPath, cleanGamesCatalog, validateRom, romHash, saveIdentity, makeSaveRecord, validSaveRecord, fetchBytes, createStateStore} from '../public/games-core.js';

function rom({mapper = 0, trainer = false, nes2 = false} = {}) {
  // Original minimal NROM test program, generated here. No third-party ROM.
  const bytes = new Uint8Array(16 + (trainer ? 512 : 0) + 16384 + 8192);
  bytes.set([0x4e,0x45,0x53,0x1a,1,1,(mapper & 15) << 4 | (trainer ? 4 : 0),mapper & 0xf0 | (nes2 ? 8 : 0)]);
  const at = 16 + (trainer ? 512 : 0);
  bytes.set([0x4c,0x00,0x80],at); // JMP $8000.
  bytes.set([0,128,0,128,0,128],at+16384-6);
  return bytes;
}

test('catalog allows only flat same-site NES paths and alphabetic unique game identities',() => {
  for (const path of ['roms/my-game.nes','./roms/Game_1.NES']) assert.ok(catalogRomPath(path).startsWith('roms/'));
  for (const path of ['https://evil.test/game.nes','//evil.test/game.nes','roms/../game.nes','roms/a/other.nes','roms/game.nes?x=1','roms/game%2enes','roms/a b.nes','roms/.hidden.nes','roms/a.zip','roms/\\game.nes']) assert.throws(() => catalogRomPath(path));
  const clean = cleanGamesCatalog({version:1,items:[
    {id:'z',title:'Zelda-ish original',rom:'roms/z.nes',description:'private field'},
    {id:'a',title:'alpha',rom:'roms/a.nes'},
    {id:'a',title:'duplicate',rom:'roms/dup.nes'},
    {id:'evil',title:'remote',rom:'https://evil.test/remote.nes'},
    {id:'empty',title:' ',rom:'roms/empty.nes'},
  ]});
  assert.deepEqual(clean.items.map(item => item.id),['a','z']);
  assert.equal(JSON.stringify(clean).includes('private field'),false);
  assert.throws(() => cleanGamesCatalog({items:[]}),/invalid/);
  assert.throws(() => cleanGamesCatalog({version:1,items:new Array(2001)}),/invalid/);
});

test('ROM validation checks true magic, complete banks, trainers, mapper and bounds',() => {
  const valid = rom(); assert.equal(validateRom(valid).mapper,0); assert.equal(validateRom(rom({trainer:true})).required,16+512+16384+8192);
  assert.equal(validateRom(rom({mapper:4})).mapper,4);
  assert.throws(() => validateRom(valid.slice(0,-1)),/incomplete/);
  assert.throws(() => validateRom(new Uint8Array(8)),/header/);
  const badMagic = valid.slice(); badMagic[3] = 0; assert.throws(() => validateRom(badMagic),/header/);
  const noProgram = valid.slice(); noProgram[4] = 0; assert.throws(() => validateRom(noProgram),/no game program/);
  assert.throws(() => validateRom(rom({mapper:33})),/mapper 33/);
  assert.throws(() => validateRom(new Uint8Array(MAX_ROM_BYTES+1)),/16 MiB/);
});

test('ordinary NES2 files load; exotic size, unsupported console/submapper and PAL fail clearly',() => {
  assert.equal(validateRom(rom({nes2:true})).nes2,true);
  const sized = rom({nes2:true}); sized[9] = 0x0f; assert.throws(() => validateRom(sized),/size format/);
  const sub = rom({nes2:true}); sub[8] = 0x10; assert.throws(() => validateRom(sub),/submapper/);
  const consoleRom = rom(); consoleRom[7] |= 1; assert.throws(() => validateRom(consoleRom),/console variant/);
  const pal = rom({nes2:true}); pal[12] = 1; assert.throws(() => validateRom(pal),/PAL/);
  const palOld = rom(); palOld[9] = 1; assert.throws(() => validateRom(palOld),/PAL/);
  const corrupt = rom(); corrupt.set(new TextEncoder().encode('DiskDude'),8); assert.equal(validateRom(corrupt).mapper,0);
});

test('ROM content hash stays stable across filenames and isolates changed bytes and viewers',async () => {
  const one = rom(), two = one.slice(); two[100] ^= 1;
  const firstHash = await romHash(one), sameHash = await romHash(one.slice()), otherHash = await romHash(two);
  assert.equal(firstHash,sameHash); assert.notEqual(firstHash,otherHash);
  assert.notEqual(saveIdentity('viewer-1',firstHash),saveIdentity('viewer-2',firstHash));
  assert.throws(() => saveIdentity('child',firstHash),/identity/);
  assert.throws(() => saveIdentity('viewer-1','bad'),/identity/);
});

test('pinned self-hosted engine actually executes original ROM and save snapshot does not mutate',async () => {
  const source = await readFile(new URL('../public/vendor/jsnes-2.1.0.min.js',import.meta.url),'utf8');
  const sandbox = {}; vm.runInNewContext(source,sandbox);
  let frames = 0;
  const nes = new sandbox.jsnes.NES({onFrame:() => frames++,emulateSound:false});
  nes.loadROM(rom()); nes.frame(); nes.frame();
  assert.ok(frames >= 2);
  const hash = await romHash(rom());
  const record = makeSaveRecord('viewer-1',hash,nes.toJSON(),1234);
  nes.buttonDown(1,0);
  assert.equal(record.state.controllers[1].state[0],0x40);
  nes.fromJSON(record.state); assert.equal(nes.controllers[1].state[0],0x40);
  nes.frame(); assert.ok(frames >= 3, 'restored state must continue executing');
  assert.ok(validSaveRecord(record,'viewer-1',hash));
  assert.equal(validSaveRecord(record,'viewer-2',hash),false);
  assert.equal(validSaveRecord({...record,engine:'bad'},'viewer-1',hash),false);
  assert.equal(validSaveRecord({...record,state:{cpu:{mem:[]}}},'viewer-1',hash),false);
  assert.equal(ENGINE_VERSION,'2.1.0');
  assert.equal(createHash('sha256').update(source).digest('hex'),'84946f0dae4bcf3b2dfebe84ad3bfeb1dbcb413bd9b1a69e1f45910a95fd7b41');
  for (const mapper of SUPPORTED_MAPPERS) { const candidate = new sandbox.jsnes.NES({emulateSound:false}); candidate.loadROM(rom({mapper})); assert.equal(candidate.rom.mapperType,mapper); }
});

test('ROM fetching uses no credentials, blocks redirects, applies deadline and bounds streamed body',async () => {
  const bytes = await fetchBytes('./roms/original.nes',{fetchFn:async (url,options) => {
    assert.equal(url,'./roms/original.nes'); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error'); assert.ok(options.signal);
    return new Response(rom());
  }});
  assert.equal(bytes.length,rom().length);
  await assert.rejects(fetchBytes('/large',{maxBytes:100,fetchFn:async () => new Response(new Uint8Array(101))}),/size limit/);
  await assert.rejects(fetchBytes('/declared-large',{maxBytes:100,fetchFn:async () => new Response(new Uint8Array(20),{headers:{'content-length':'101'}})}),/size limit/);
  await assert.rejects(fetchBytes('/missing',{fetchFn:async () => new Response('',{status:404})}),/missing/);
  await assert.rejects(fetchBytes('/slow',{timeoutMs:10,fetchFn:(_,options) => new Promise((_,reject) => options.signal.addEventListener('abort',() => reject(options.signal.reason)))}),error => error.name === 'TimeoutError');
});

test('unavailable IndexedDB is a finite error and invalid save keys never open storage',async () => {
  const unavailable = createStateStore(null);
  await assert.rejects(unavailable.get('viewer-1:'+('a'.repeat(64))),/cannot store/);
  let opened = false;
  const guarded = createStateStore({open:() => { opened = true; }});
  await assert.rejects(guarded.get('../invalid'),/key is invalid/);
  assert.equal(opened,false);
});

test('game catalog starts empty and emulation has no TorBox or external dependency',async () => {
  const raw = JSON.parse(await readFile(new URL('../public/games-catalog.json',import.meta.url),'utf8'));
  assert.deepEqual(cleanGamesCatalog(raw),{version:1,items:[]});
  const source = await readFile(new URL('../public/games.js',import.meta.url),'utf8');
  assert.ok(source.includes('games-tab-open')); assert.ok(source.includes('games-tab-close'));
  assert.ok(source.includes('games-playback-start')); assert.ok(source.includes('cinema-playback-start'));
  assert.ok(source.includes('sports-playback-start')); assert.ok(source.includes('getKidProfile'));
  assert.ok(!source.includes('/api/')); assert.ok(!source.includes('onrender.com')); assert.ok(!source.includes('https://'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const vendor = await readFile(new URL('../public/vendor/jsnes-2.1.0-torbox.1.min.js', import.meta.url), 'utf8');
const WIDTH = 256, HEIGHT = 240, CLEAR = 0x123456;

function fixture() {
  // Original NROM fixture. Distinct neighboring tiles and pattern tables make
  // a one-tile offset visible without using any commercial game's artwork.
  const rom = new Uint8Array(16 + 16384 + 8192);
  rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 1]);
  rom.set([0x4c, 0x00, 0x80], 16);
  for (const at of [0x3ffa, 0x3ffc, 0x3ffe]) rom.set([0x00, 0x80], 16 + at);
  const chr = rom.subarray(16 + 16384);
  for (let tile = 0; tile < 512; tile++) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const value = (tile * 7 + y * 3 + x) % 7 === 0 ? 0 : 1 + (tile + y + x) % 3;
        chr[tile * 16 + y] |= (value & 1) << (7 - x);
        chr[tile * 16 + y + 8] |= ((value >> 1) & 1) << (7 - x);
      }
    }
  }
  return {rom, chr};
}

function engine(rom) {
  const sandbox = {};
  vm.runInNewContext(vendor, sandbox);
  const nes = new sandbox.jsnes.NES({emulateSound: false});
  nes.loadROM(rom);
  return nes;
}

function expectedPixel(chr, tile, row, column) {
  const at = tile * 16 + row;
  const shift = 7 - column;
  return ((chr[at] >> shift) & 1) | (((chr[at + 8] >> shift) & 1) << 1);
}

function renderAndCheck(nes, chr, {size, tile, table = 0, horizontal = false, vertical = false}) {
  const ppu = nes.ppu, left = 40, top = 40;
  const palette = [0, 0x102030, 0x405060, 0x708090, 0, 0xabcdef, 0x29bc7a, 0xe24381];
  const height = size === 1 ? 16 : 8;
  ppu.f_spVisibility = 1;
  ppu.f_spriteSize = size;
  ppu.f_spPatternTable = table;
  ppu.sprPalette.set(palette);
  ppu.buffer.fill(CLEAR);
  ppu.pixrendered.fill(0xff);
  ppu.scanlineSpriteCount.fill(0);
  const attributes = 1 | (horizontal ? 0x40 : 0) | (vertical ? 0x80 : 0);
  for (let scan = top; scan < top + height; scan++) {
    ppu.scanlineSpriteCount[scan] = 1;
    ppu.scanlineSecondaryOAM.set([top - 1, tile, attributes, left], scan * 32);
  }
  // Exercise the actual renderer, with the same deferred scanline data used by
  // live games. Decode expected colors independently from original CHR bytes.
  ppu.renderSpritesPartially(top - 2, height + 4, 0);
  let differences = 0, first = '';
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let expected = CLEAR;
      if (x >= left && x < left + 8 && y >= top && y < top + height) {
        const sourceY = vertical ? height - 1 - (y - top) : y - top;
        const sourceX = horizontal ? 7 - (x - left) : x - left;
        const patternTile = size === 1
          ? (tile & 1) * 256 + (tile & 0xfe) + (sourceY >> 3)
          : table * 256 + tile;
        const value = expectedPixel(chr, patternTile, sourceY & 7, sourceX);
        if (value) expected = palette[4 + value];
      }
      const actual = ppu.buffer[y * WIDTH + x];
      if (actual !== expected) {
        differences++;
        if (!first) first = ` at (${x},${y}): ${actual.toString(16)} instead of ${expected.toString(16)}`;
      }
    }
  }
  assert.equal(differences, 0, `${JSON.stringify({size, tile, table, horizontal, vertical})}${first}`);
}

test('8x16 sprites select the correct paired CHR tiles in both pattern tables, including edge indices and flips', () => {
  const {rom, chr} = fixture(), nes = engine(rom);
  // Tile bit 0 selects the table; the remaining bits select an even tile pair.
  // In particular, odd values must not subtract one after clearing bit 0.
  for (const tile of [0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]) {
    for (const horizontal of [false, true]) {
      for (const vertical of [false, true]) renderAndCheck(nes, chr, {size: 1, tile, horizontal, vertical});
    }
  }
});

test('8x8 sprites retain explicit pattern-table selection, adjacent tiles, transparency and flips', () => {
  const {rom, chr} = fixture(), nes = engine(rom);
  for (const table of [0, 1]) {
    for (const tile of [0x00, 0x01, 0xfe, 0xff]) {
      for (const horizontal of [false, true]) {
        for (const vertical of [false, true]) renderAndCheck(nes, chr, {size: 0, tile, table, horizontal, vertical});
      }
    }
  }
});

// Reproduce the narrowly scoped TorBox sprite fix from the pinned upstream asset.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const upstream = new URL('../public/vendor/jsnes-2.1.0.min.js', import.meta.url);
const output = new URL('../public/vendor/jsnes-2.1.0-torbox.1.min.js', import.meta.url);
const source = await readFile(upstream, 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'), '84946f0dae4bcf3b2dfebe84ad3bfeb1dbcb413bd9b1a69e1f45910a95fd7b41');
const before = 'R=254&c,C=1&c?R-1+256:R';
const after = 'R=254&c,C=1&c?R+256:R';
assert.equal(source.split(before).length, 2, 'Expected exactly one upstream 8x16 tile calculation');
const notice = '/*! JSNES 2.1.0, Apache-2.0. Modified by TorBox 2026-10-15: correct 8x16 sprite pattern-table indexing. See jsnes-2.1.0-torbox.1.patch and jsnes-2.1.0.LICENSE.txt. */\n';
const patched = notice + source.replace(before, after);
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), patched, 'Published engine must match the reproducible patch');
} else {
  await writeFile(output, patched);
}
console.log('JSNES sprite patch verified:', createHash('sha256').update(patched).digest('hex'));

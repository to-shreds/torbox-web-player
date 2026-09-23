import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('permanent recovery page always jumps to a uniquely cache-busted root navigation',async()=>{
  const html=await readFile(new URL('../public/recover/index.html',import.meta.url),'utf8');
  assert.ok(html.includes("new URL('../?recover=' + Date.now(), location.href)"));
  assert.ok(html.includes("location.replace(target())"));
  assert.ok(!html.includes('./app.js'));
  assert.ok(!html.includes('./boot.js'));
});

test('Render static mirror serves the permanent recovery page',async()=>{
  const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.ok(server.includes("['/recover', ['recover/index.html'"));
  assert.ok(server.includes("['/recover/', ['recover/index.html'"));
});
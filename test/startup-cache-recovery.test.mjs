import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BUILD='restored11';

test('published page boots through a versioned recovery loader instead of directly importing app.js',async()=>{
  const [html,boot]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/boot.js',import.meta.url),'utf8')
  ]);
  assert.ok(html.includes(`src="./boot.js?v=${BUILD}"`));
  assert.ok(!html.includes('src="./app.js"'));
  assert.ok(boot.includes(`import(`+'`./app.js?v=${BUILD}`'+`)`));
  assert.ok(boot.includes("updateViaCache:'none'"));
  assert.ok(boot.includes('showStartupFailure()'));
});

test('startup module graph is cache-busted consistently',async()=>{
  for(const file of ['app.js','discover.js','history.js','playback-errors.js','source-client.js']){
    const js=await readFile(new URL(`../public/${file}`,import.meta.url),'utf8');
    for(const match of js.matchAll(/from '(\.\/[^']+\.js)(\?[^']*)?';/g))assert.equal(match[2],`?v=${BUILD}`,`${file}: ${match[1]}`);
  }
});

test('service worker bypasses HTTP cache for shell refresh and contains the recovery loader',async()=>{
  const [sw,server]=await Promise.all([
    readFile(new URL('../public/sw.js',import.meta.url),'utf8'),
    readFile(new URL('../server.mjs',import.meta.url),'utf8')
  ]);
  assert.ok(sw.includes(`torbox-player-v1.1-${BUILD}`));
  assert.ok(sw.includes("cache:'no-store'"));
  assert.ok(sw.includes('boot.js?v=${BUILD}'));
  assert.ok(server.includes("['/boot.js'"));
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BUILD='release-1.2.0';

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
  assert.ok(boot.includes('void refreshServiceWorker();'));
  assert.ok(!boot.includes('await refreshServiceWorker();'));
  assert.ok(boot.includes('warmBackend();'));
});

test('opening screen reports live startup stages and elapsed time',async()=>{
  const [html,boot,app,style]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/boot.js',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8')
  ]);
  for(const id of ['startup-stage','startup-detail','startup-elapsed'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.includes('class="startup-track"'));
  assert.ok(boot.includes('globalThis.__torboxStartup'));
  assert.ok(boot.includes('setInterval(tickStartup,1000)'));
  assert.ok(app.includes("'Waking the player service…'"));
  assert.ok(app.includes("'The backend sleeps when idle and can take around a minute to restart.'"));
  assert.ok(style.includes('@keyframes startup-sweep'));
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
  assert.ok(sw.includes("'torbox-player:'+self.registration.scope"));assert.ok(sw.includes(`'${BUILD}'`));
  assert.ok(sw.includes("cache:'no-store'"));
  assert.ok(sw.includes('boot.js?v=${BUILD}'));
  assert.ok(server.includes("['/boot.js'"));
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('2.0.3 entrypoint and local module graph are release-versioned',async()=>{
  const [html,app,discover,runtime,portableUi,portable]=await Promise.all([
    read('../public/index.html'),
    read('../public/app.js'),
    read('../public/discover.js'),
    read('../public/direct-runtime.js'),
    read('../public/portable-setup-ui.js'),
    read('../public/portable-setup.js')
  ]);
  assert.match(html,/src="\.\/app\.js\?v=2\.0\.3"/);
  for(const code of [app,discover,runtime,portableUi,portable]){
    for(const match of code.matchAll(/from '(\.\/[^']+\.js)([^']*)'/g)){
      assert.equal(match[2],'?v=2.0.3',match[0]);
    }
  }
});

test('service worker bypasses HTTP cache and registration bypasses update cache',async()=>{
  const [app,sw]=await Promise.all([read('../public/app.js'),read('../public/sw.js')]);
  assert.match(app,/register\('\.\/sw\.js\?v='\+APP_VERSION,\{updateViaCache:'none'\}\)/);
  assert.match(app,/await registration\.update\(\)/);
  assert.match(sw,/fetch\(event\.request,\{cache:'no-store'\}\)/);
  assert.match(sw,/new Request\(path,\{cache:'reload'\}\)/);
  assert.match(sw,/torbox-main-v2\.0\.3/);
});

test('stale app detects a newer published version and routes through repair',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/const APP_VERSION='2\.0\.3'/);
  assert.match(app,/version\.json\?check=/);
  assert.match(app,/version!==APP_VERSION/);
  assert.match(app,/location\.replace\('\.\/repair\/\?published='/);
});

test('repair page removes only TorBox main worker caches then cache-busts canonical root',async()=>{
  const repair=await read('../public/repair/index.html');
  assert.match(repair,/scope\.includes\('\/torbox-web-player\/'\)/);
  assert.match(repair,/k\.startsWith\('torbox-main-v'\)/);
  assert.match(repair,/version\.json\?repair=/);
  assert.match(repair,/location\.replace\('\.\.\/\?release='/);
  assert.doesNotMatch(repair,/caches\.keys\(\)[\s\S]*map\(k=>caches\.delete\(k\)\)(?![\s\S]*torbox-main-v)/);
});

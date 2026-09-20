import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('package version controls every browser release marker and local ESM import',async()=>{
  const version=JSON.parse(await read('../package.json')).version;
  const [html,app,runtime,sw]=await Promise.all([
    read('../public/index.html'),read('../public/app.js'),read('../public/direct-runtime.js'),read('../public/sw.js')
  ]);
  assert.ok(html.includes('src="./app.js?v='+version+'"'));
  assert.ok(html.includes('<span class="tag">'+version+'</span>'));
  assert.ok(app.includes("const APP_VERSION='"+version+"'"));
  assert.ok(runtime.includes("DIRECT_BUILD = 'browser-local-"+version+"'"));
  assert.ok(sw.includes("CACHE='torbox-main-v"+version+"'"));
  const publicUrl=new URL('../public/',import.meta.url);
  const files=(await readdir(publicUrl)).filter(name=>name.endsWith('.js'));
  for(const name of files){
    const code=await read('../public/'+name);
    for(const match of code.matchAll(/from ['"](\.\/[^'"]+\.js)(?:\?v=([^'"]+))?['"]/g)){
      assert.equal(match[2],version,name+' imports '+match[1]+' without the current release version');
    }
  }
});

test('service worker bypasses HTTP cache and registration bypasses update cache',async()=>{
  const [app,sw]=await Promise.all([read('../public/app.js'),read('../public/sw.js')]);
  assert.match(app,/register\('\.\/sw\.js\?v='\+APP_VERSION,\{updateViaCache:'none'\}\)/);
  assert.match(app,/await registration\.update\(\)/);
  assert.match(sw,/fetch\(event\.request,\{cache:'no-store'\}\)/);
  assert.match(sw,/new Request\(path,\{cache:'reload'\}\)/);
});

test('stale app detects a newer published version and routes through repair',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/version\.json\?check=/);
  assert.match(app,/version!==APP_VERSION/);
  assert.match(app,/location\.replace\('\.\/repair\/\?published=/);
});

test('repair page removes only TorBox main worker caches then cache-busts canonical root',async()=>{
  const repair=await read('../public/repair/index.html');
  assert.match(repair,/scope\.includes\('\/torbox-web-player\/'\)/);
  assert.match(repair,/k\.startsWith\('torbox-main-v'\)/);
  assert.match(repair,/version\.json\?repair=/);
  assert.match(repair,/location\.replace\('\.\.\/\?release=/);
  assert.match(repair,/keys\.filter\(k=>k\.startsWith\('torbox-main-v'\)\)\.map\(k=>caches\.delete\(k\)\)/);
});

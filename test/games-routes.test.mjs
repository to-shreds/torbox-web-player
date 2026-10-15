import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createApp} from '../server.mjs';

test('Games assets and repo ROM bytes are available without a TorBox session',async t=>{
  const {server}=createApp({env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const [path,type] of [
    ['/games-nav.js','javascript'],['/games.js','javascript'],['/games-core.js','javascript'],['/games-pointer.js','javascript'],['/games-cheats.js','javascript'],
    ['/games.css','text/css'],['/games-catalog.json','application/json'],
    ['/vendor/jsnes-2.1.0.min.js','javascript'],['/vendor/nes-audio-worklet.js','javascript'],
  ]){
    const response=await fetch(origin+path);
    assert.equal(response.status,200,path);
    assert.ok(response.headers.get('content-type').includes(type),path);
    assert.equal(response.headers.get('set-cookie'),null);
    assert.ok((await response.arrayBuffer()).byteLength>0);
  }
  const filename='route-test-'+process.pid+'.nes';
  const file=new URL('../public/roms/'+filename,import.meta.url);
  const bytes=Buffer.from([0x4e,0x45,0x53,0x1a,1,0,0,0]);
  await writeFile(file,bytes);t.after(()=>unlink(file));
  const response=await fetch(origin+'/roms/'+filename);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'application/octet-stream');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  assert.equal((await fetch(origin+'/roms/nonexistent-game.nes')).status,404);
});

test('every versioned service-worker shell asset exists on disk',async()=>{
  const worker=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
  const paths=[...worker.matchAll(/['"`]\.\/([^'"`]+)['"`]/g)]
    .map(match=>match[1].split('?')[0]).filter(path=>path&&path!=='api/');
  for(const path of new Set(paths))assert.ok((await readFile(new URL('../public/'+path,import.meta.url))).length>0,path);
});

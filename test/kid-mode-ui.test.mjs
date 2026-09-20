import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('Kid Mode UI exposes per-viewer limits and Parent PIN controls',async()=>{
  const html=await read('../public/index.html');
  for(const id of [
    'setting-kid-mode','setting-kid-time','setting-kid-time-unit','setting-kid-episodes','setting-kid-movies',
    'setting-kid-reset','parent-pin-change','kid-reset-allowance','parent-pin-dialog','parent-pin-change-dialog',
    'kid-limit-dialog','kid-add-15','kid-add-30','kid-add-episode','kid-add-movie','kid-reset-limit','kid-turn-off'
  ])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/pattern="\[0-9\]\{4,8\}"/);
  assert.match(html,/5 actual watched minutes or 20%/);
  assert.match(html,/movie counts after 10 actual watched minutes/);
});

test('Kid Mode persists viewer choice and gates protected actions',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/localStorage\.getItem\('tw-viewer'\)/);
  assert.match(app,/localStorage\.setItem\('tw-viewer',viewer\)/);
  assert.match(app,/Enter the Parent PIN to open Settings/);
  assert.match(app,/Enter the Parent PIN to change viewers/);
  assert.match(app,/Enter the Parent PIN to sign out/);
  assert.match(app,/kidEnabled\(\).*hasParentPin\(\)/s);
});

test('playback is checked before starting and actual advancing playback is consumed',async()=>{
  const app=await read('../public/app.js');
  const gate=app.indexOf('const block=canStartKidPlayback(viewer,playbackContext)');
  const api=app.indexOf("api('/api/playback'");
  assert.ok(gate>=0&&api>=0&&gate<api);
  assert.match(app,/consumeKidPlayback\(context\.viewer,context\.playbackContext,seconds/);
  assert.match(app,/media>Math\.max\(15,wall\*rate\*3\+5\)/);
  assert.match(app,/context\.kidTimer=setInterval\(\(\)=>tickKidUsage\(context\),5000\)/);
  assert.match(app,/tickKidUsage\(active,true\);saveProgress\(active, true\)/);
});

test('limit screen cannot be dismissed with Escape and parent extensions are PIN gated',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/kid-limit-dialog.*cancel.*preventDefault/s);
  assert.match(app,/verifyParentPin\(\$\('kid-limit-pin'\)\.value\)/);
  assert.match(app,/grantKidExtension\(viewer,\{minutes:15\}\)/);
  assert.match(app,/grantKidExtension\(viewer,\{minutes:30\}\)/);
  assert.match(app,/grantKidExtension\(viewer,\{episodes:1\}\)/);
  assert.match(app,/grantKidExtension\(viewer,\{movies:1\}\)/);
  assert.match(app,/updateKidProfile\(viewer,\{enabled:false\}\)/);
});

test('Kid Mode module is served and included in the static PWA shell',async()=>{
  const [server,sw,pkg]=await Promise.all([read('../server.mjs'),read('../public/sw.js'),read('../package.json')]);
  assert.match(server,/\/parental-controls\.js/);
  assert.match(sw,/\.\/parental-controls\.js/);
  assert.match(pkg,/2\.0\.4/);
  assert.match(pkg,/node --check public\/parental-controls\.js/);
});

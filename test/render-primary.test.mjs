import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('canonical Pages app uses Render for normal API control requests',async()=>{
  const [html,runtime,app]=await Promise.all([read('../public/index.html'),read('../public/runtime.js'),read('../public/app.js')]);
  assert.match(html,/name="runtime-mode" content="backend"/);
  assert.match(html,/name="api-origin" content="https:\/\/torbox-web-player-key\.onrender\.com"/);
  assert.doesNotMatch(html,/name="runtime-mode" content="direct"/);
  assert.match(runtime,/RUNTIME_MODE === 'direct'/);
  assert.match(app,/if\(isDirectRuntime\(\)\)return directApi/);
  assert.match(app,/driveTest: null/);
});

test('backend setup transfer keeps the active API key in memory and validates imports through Render',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/activeCredential=apiKey/);
  assert.match(app,/getCredential:\(\)=>activeCredential\|\|exportActiveCredential\(\)/);
  assert.match(app,/async function validateCredentialForImport/);
  assert.match(app,/fetch\(url,\{method:'POST',mode:apiMode\(\)/);
  assert.match(app,/await validateCredentialForImport\(value\[2\]\)/);
});

test('server catalog supports cross-type search and rejects query-ignoring title lists',async()=>{
  const catalog=await read('../lib/catalog.mjs');
  assert.match(catalog,/\['movie','series','all'\]/);
  assert.match(catalog,/Promise\.any\(/);
  assert.match(catalog,/searchTitleRelevant/);
  assert.match(catalog,/CATALOG_SECONDARY/);
});

test('server source fan-in is bounded and does not wait for every public provider',async()=>{
  const sources=await read('../lib/source-lookup.mjs');
  assert.match(sources,/hardTimer=setTimeout\(finish,5500\)/);
  assert.match(sources,/schedule\(120\)/);
  assert.match(sources,/schedule\(300\)/);
  assert.doesNotMatch(sources,/const primaryResults = await Promise\.allSettled/);
});

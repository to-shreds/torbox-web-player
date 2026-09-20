import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('source discovery is bounded and returns after useful providers instead of waiting for every index',async()=>{
  const runtime=await read('../public/direct-runtime.js');
  assert.match(runtime,/const SOURCE_CACHE_MS = 90000/);
  assert.match(runtime,/scheduleGrace\(450\)/);
  assert.match(runtime,/scheduleGrace\(900\)/);
  assert.doesNotMatch(runtime,/scheduleGrace\(2200\)/);
  assert.match(runtime,/hardTimer = setTimeout\(finish, 6500\)/);
  assert.match(runtime,/safeCount=\(\)=>/);
  assert.match(runtime,/sourceCache\.set\(key/);
  assert.match(runtime,/return directSources\(target, signal\)/);
  assert.doesNotMatch(runtime,/Promise\.allSettled\(jobs\.map/);
});

test('Play status probe is advisory and cannot reject playback before the real TorBox request',async()=>{
  const app=await read('../public/app.js');
  assert.match(app,/Never block Play on a separate probe/);
  assert.match(app,/void checkTorBoxStatus\(false\)/);
  assert.doesNotMatch(app,/const ok=await checkTorBoxStatus\(false\);[\s\S]{0,160}if \(!ok\) throw/);
  assert.match(app,/leaveGuestUi\(\); void checkTorBoxStatus\(true\); renderRecent\(\)/);
});

test('duplicate Play taps coalesce and stale intents cannot replace a newer playback request',async()=>{
  const discover=await read('../public/discover.js');
  assert.match(discover,/playIntentGeneration=0,playIntentKey='',playIntentPromise=null/);
  assert.match(discover,/if\(playIntentPromise&&playIntentKey===key\)/);
  assert.match(discover,/return await playIntentPromise/);
  assert.match(discover,/const generation=\+\+playIntentGeneration/);
  const staleChecks=(discover.match(/if\(generation!==playIntentGeneration\)return false/g)||[]).length;
  assert.ok(staleChecks>=3,'expected stale-intent checks after async phases');
  assert.match(discover,/if\(playIntentPromise===run\)\{playIntentPromise=null;playIntentKey='';\}/);
  assert.match(discover,/suspend\(\)\{active=false;guestMode=false;\+\+playIntentGeneration;playIntentPromise=null;playIntentKey=''/);
});

test('interactive source lookup has an 8 second UI deadline while provider fan-in has a 6.5 second hard ceiling',async()=>{
  const discover=await read('../public/discover.js');
  assert.match(discover,/registeredSources\(target,AbortSignal\.timeout\(8000\)\)/);
});

test('Cinemeta uses its prefixed browse route, retries v3 metadata, and diagnostics check both paths',async()=>{
  const runtime=await read('../public/direct-runtime.js');
  assert.ok(runtime.includes("const CATALOG_PRIMARY = 'https://v3-cinemeta.strem.io'"));
  assert.ok(runtime.includes("const CATALOG_SECONDARY = 'https://cinemeta-catalogs.strem.io'"));
  assert.ok(runtime.includes("new URL('/' + catalogMatch[1] + path, CATALOG_SECONDARY).href"));
  assert.ok(runtime.includes("label:'cinemeta_meta_live'"));
  assert.ok(runtime.includes("label:'cinemeta_meta_retry'"));
  assert.ok(runtime.includes("catalogBridgeRequest"));
  assert.ok(runtime.includes("catalogMetaFlexible"));
  assert.ok(runtime.includes("probe('cinemeta', 'Cinemeta catalog', 'https://cinemeta-catalogs.strem.io/top/catalog/movie/top.json')"));
  assert.ok(runtime.includes("probe('cinemeta_meta', 'Cinemeta metadata', 'https://v3-cinemeta.strem.io/meta/movie/tt0111161.json')"));
  assert.ok(runtime.includes("catalogAvailable=architecture.catalogDirect||architecture.catalogBridge"));
  assert.match(runtime,/network, DNS, TLS, CORS, or another browser policy/);
  assert.doesNotMatch(runtime,/This is commonly caused by CORS/);
});

test('source fan-in ranks browser-friendly variants before the forty-source cap',async()=>{
  const runtime=await read('../public/direct-runtime.js');
  assert.match(runtime,/sourceFanInKey/);
  assert.match(runtime,/sourceFanInRank/);
  assert.match(runtime,/sort\(\(a,b\)=>sourceFanInRank\(b\)-sourceFanInRank\(a\)\)\.slice\(0, 40\)/);
});

test('canonical user path does not run browser-direct provider or bridge timeouts',async()=>{
  const [html,app]=await Promise.all([read('../public/index.html'),read('../public/app.js')]);
  assert.match(html,/name="runtime-mode" content="backend"/);
  assert.match(html,/name="api-origin" content="https:\/\/torbox-web-player-key\.onrender\.com"/);
  assert.match(app,/if\(isDirectRuntime\(\)\)return directApi/);
});

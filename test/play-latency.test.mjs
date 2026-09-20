import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('source discovery is bounded and returns after useful providers instead of waiting for every index',async()=>{
  const runtime=await read('../public/direct-runtime.js');
  assert.match(runtime,/const SOURCE_CACHE_MS = 90000/);
  assert.match(runtime,/scheduleGrace\(450\)/);
  assert.match(runtime,/scheduleGrace\(900\)/);
  assert.match(runtime,/scheduleGrace\(2200\)/);
  assert.match(runtime,/hardTimer = setTimeout\(finish, 5000\)/);
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

test('interactive source lookup has an 8 second UI deadline while provider fan-in has a 5 second hard ceiling',async()=>{
  const discover=await read('../public/discover.js');
  assert.match(discover,/registeredSources\(target,AbortSignal\.timeout\(8000\)\)/);
});

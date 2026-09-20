import test from 'node:test';
import assert from 'node:assert/strict';
import { SNAPSHOT_KEYS, MAX_SNAPSHOTS, captureStateSnapshot, listStateSnapshots, restoreStateSnapshot, snapshotForVersion, stateSnapshotStorageKeys } from '../public/state-snapshots.js';

function memoryStore(values={}){
  const map=new Map(Object.entries(values));
  return{
    getItem:key=>map.has(key)?map.get(key):null,
    setItem:(key,value)=>map.set(key,String(value)),
    removeItem:key=>map.delete(key),
    dump:()=>Object.fromEntries(map)
  };
}
test('state snapshots cover local app state but never credential storage',()=>{
  assert.deepEqual(SNAPSHOT_KEYS,[
    'torbox-settings-v1','torbox-recent-v1','torbox-watchlist-v1','torbox-search-history-v1','torbox-source-memory-v1','torbox-parental-controls-v1','tw-viewer'
  ]);
  assert.equal(SNAPSHOT_KEYS.some(key=>/key|token|credential|vault/i.test(key)),false);
});
test('first launch of a new version snapshots existing state once',()=>{
  const store=memoryStore({'torbox-settings-v1':'{"resolution":"720p"}','torbox-recent-v1':'[]'});
  const first=snapshotForVersion('2.2.0',store,1000);
  assert.ok(first);assert.equal(listStateSnapshots(store).length,1);
  assert.equal(first.state['torbox-settings-v1'],'{"resolution":"720p"}');
  assert.equal(snapshotForVersion('2.2.0',store,2000),null);
  assert.equal(listStateSnapshots(store).length,1);
  assert.equal(store.getItem(stateSnapshotStorageKeys().version),'2.2.0');
});
test('snapshots are bounded to the newest three',()=>{
  const store=memoryStore({'torbox-settings-v1':'{}'});
  for(let i=0;i<6;i++){store.setItem('tw-viewer',i%2?'viewer-2':'viewer-1');captureStateSnapshot('backup '+i,'2.2.0',store,1000+i);}
  const rows=listStateSnapshots(store);assert.equal(rows.length,MAX_SNAPSHOTS);assert.deepEqual(rows.map(row=>row.createdAt),[1005,1004,1003]);
});
test('restore replaces exact local state and preserves a pre-restore backup',()=>{
  const store=memoryStore({'torbox-settings-v1':'old','torbox-recent-v1':'old-history','tw-viewer':'viewer-1'});
  const saved=captureStateSnapshot('known good','2.1.0',store,1000);
  store.setItem('torbox-settings-v1','new');store.removeItem('torbox-recent-v1');store.setItem('tw-viewer','viewer-2');
  restoreStateSnapshot(saved.id,{store,version:'2.2.0',now:2000});
  assert.equal(store.getItem('torbox-settings-v1'),'old');assert.equal(store.getItem('torbox-recent-v1'),'old-history');assert.equal(store.getItem('tw-viewer'),'viewer-1');
  assert.ok(listStateSnapshots(store).some(row=>row.reason==='Before restoring a previous backup'));
});
test('failed restore rolls local state back instead of leaving a partial restore',()=>{
  const store=memoryStore({'torbox-settings-v1':'old','torbox-recent-v1':'old-history'});
  const saved=captureStateSnapshot('known good','2.1.0',store,1000);
  store.setItem('torbox-settings-v1','current');store.setItem('torbox-recent-v1','current-history');
  const originalSet=store.setItem;let fail=true;
  store.setItem=(key,value)=>{if(fail&&key==='torbox-recent-v1'){fail=false;throw new Error('quota');}originalSet(key,value);};
  assert.throws(()=>restoreStateSnapshot(saved.id,{store,version:'2.2.0',captureCurrent:false,now:2000}),/quota/);
  assert.equal(store.getItem('torbox-settings-v1'),'current');assert.equal(store.getItem('torbox-recent-v1'),'current-history');
});

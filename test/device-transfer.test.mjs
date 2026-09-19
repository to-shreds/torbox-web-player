import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createEncryptedTransfer, decryptEncryptedTransfer, applyTransferredState, transferLookup, transferCodeFromHash, buildTransferLink } from '../public/device-transfer.js';

function memoryStore(initial={}){const map=new Map(Object.entries(initial));return{getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),dump:()=>Object.fromEntries(map)};}

test('setup transfer encrypts credential and portable state but leaves device source learning behind',async()=>{
  const source=memoryStore({
    'torbox-settings-v1':JSON.stringify({interfaceMode:'simple'}),
    'torbox-recent-v1':JSON.stringify([{key:'movie:tt1234567',title:'Bluey',position:25}]),
    'torbox-watchlist-v1':JSON.stringify({'viewer-1':[]}),
    'torbox-search-history-v1':JSON.stringify({'viewer-1':[{query:'Bluey'}]}),
    'torbox-parental-controls-v1':JSON.stringify({version:1,pin:null,viewers:{}}),
    'torbox-source-memory-v1':JSON.stringify({titles:{secretDeviceLearning:true}}),
    'tw-viewer':'viewer-2'
  });
  const apiKey='fixture-api-key-123456';
  const created=await createEncryptedTransfer(apiKey,{store:source,cryptoObj:webcrypto,now:()=>1234});
  assert.match(created.lookup,/^[a-f0-9]{64}$/);assert.match(created.code,/^(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/);
  const serialized=JSON.stringify(created.envelope);assert.ok(!serialized.includes(apiKey));assert.ok(!serialized.includes('Bluey'));
  const payload=await decryptEncryptedTransfer(created.code,created.envelope,{cryptoObj:webcrypto});
  assert.equal(payload.apiKey,apiKey);assert.equal(payload.createdAt,1234);assert.equal(payload.state['tw-viewer'],'viewer-2');
  assert.equal(payload.state['torbox-source-memory-v1'],undefined);
  const target=memoryStore({'torbox-watchlist-v1':JSON.stringify({'viewer-1':[{id:'stale'}]}),'torbox-source-memory-v1':JSON.stringify({titles:{keepDeviceLearning:true}})});
  assert.ok(applyTransferredState(payload.state,target)>0);
  assert.equal(target.getItem('tw-viewer'),'viewer-2');assert.equal(target.getItem('torbox-source-memory-v1'),JSON.stringify({titles:{keepDeviceLearning:true}}));
  const sparse=memoryStore({'torbox-watchlist-v1':'{}','torbox-recent-v1':'[]'});
  applyTransferredState({'tw-viewer':'viewer-1'},sparse);
  assert.equal(sparse.getItem('torbox-watchlist-v1'),null);assert.equal(sparse.getItem('torbox-recent-v1'),null);
});

test('wrong transfer code cannot decrypt a package',async()=>{
  const created=await createEncryptedTransfer('fixture-api-key-123456',{store:memoryStore(),cryptoObj:webcrypto});
  const wrong='AAAA-BBBB-CCCC-DDDD-EEEE';
  await assert.rejects(()=>decryptEncryptedTransfer(wrong,created.envelope,{cryptoObj:webcrypto}),/did not unlock/);
});

test('transfer links keep the secret in the URL fragment and hashes round-trip',async()=>{
  const code='ABCD-EFGH-JKLM-NPQR-STUV';
  const link=buildTransferLink(code,'https://to-shreds.github.io/torbox-web-player/key/?x=1');
  const url=new URL(link);assert.equal(url.search,'?x=1');assert.equal(url.hash,'#setup-transfer=ABCD-EFGH-JKLM-NPQR-STUV');
  assert.equal(transferCodeFromHash(url.hash),code);assert.equal(await transferLookup(code,webcrypto),(await transferLookup(code.replaceAll('-',''),webcrypto)));
});

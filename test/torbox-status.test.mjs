import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialTorBoxStatus, TorBoxStatusChecker } from '../lib/torbox-status.mjs';
test('TorBox official status parser recognizes operational and issue states',()=>{
  assert.equal(parseOfficialTorBoxStatus('<h1>All services are online</h1>'),'operational');
  assert.equal(parseOfficialTorBoxStatus('<main><h1>Partial outage</h1><p>Investigating API</p></main>'),'issue');
  assert.equal(parseOfficialTorBoxStatus('<html>unknown</html>'),'unknown');
});
test('availability check requires the account API to work even if status page says online',async()=>{
  const checker=new TorBoxStatusChecker({fetchFn:async()=>new Response('<h1>All services are online</h1>',{status:200}),now:()=>1000});
  const ok=await checker.check({account:async()=>({valid:true})});assert.equal(ok.ok,true);assert.equal(ok.official,'operational');
  const bad=await checker.check({account:async()=>{throw Object.assign(new Error('down'),{code:'TORBOX_TIMEOUT'})}});assert.equal(bad.ok,false);assert.equal(bad.code,'TORBOX_TIMEOUT');
});
test('official issue is a warning when authenticated TorBox API is still reachable',async()=>{
  const checker=new TorBoxStatusChecker({fetchFn:async()=>new Response('<h1>Partial outage</h1><p>Investigating</p>',{status:200}),now:()=>1000});
  const result=await checker.check({account:async()=>({valid:true})});
  assert.equal(result.ok,true);assert.equal(result.official,'issue');assert.match(result.message,/service issue/i);
});

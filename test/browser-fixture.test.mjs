import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {startFixture} from './browser/fixture.mjs';

test('an occupied browser fixture port rejects promptly instead of hanging the release gate',async t=>{
  const occupied=createServer();
  await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  let timeout;
  try {
    await assert.rejects(Promise.race([
      startFixture(occupied.address().port),
      new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Fixture startup hung.')),1000);}),
    ]),error=>error.code==='EADDRINUSE');
  } finally {clearTimeout(timeout);}
});

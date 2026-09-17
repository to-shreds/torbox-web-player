import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
test('playback diagnosis module is served as same-origin JavaScript', async t => {
  const { server } = createApp({ env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/playback-errors.js`);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type').startsWith('text/javascript'));
  assert.ok((await response.text()).includes('export async function diagnosePlaybackFailure'));
});

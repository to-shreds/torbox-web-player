import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
test('browser support modules are served as same-origin JavaScript', async t => {
  const { server } = createApp({ env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const [path, marker] of [['/playback-errors.js','diagnosePlaybackFailure'], ['/runtime.js','API_ORIGIN'], ['/history.js','recordRecent'], ['/settings.js','DEFAULT_SETTINGS'], ['/watchlist.js','toggleWatchlist'], ['/search-history.js','recordSearch'], ['/source-memory.js','rememberSourceSuccess'], ['/device-transfer.js','createEncryptedTransfer']]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith('text/javascript'));
    assert.ok((await response.text()).includes(marker));
  }
});
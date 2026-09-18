import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { loadPublicSources } from '../public/source-client.js';
// Read-only live test of the actual frontend function and application routes.
// Never call prepare, create a torrent, fetch media, or alter real viewing progress.
test('opt-in real source lookup and TorBox availability pipeline', { skip: process.env.SOURCE_ACCESS_CHECK !== 'pipeline', timeout: 150000 }, async () => {
  const report = { event: 'source_lookup_pipeline', results: [], ok: false, torrentAdditions: 0 };
  let app;
  try {
    app = createApp(); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const created = app.sessions.create();
    const headers = { Cookie: `tw_session=${created.id}`, Origin: process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL, 'X-CSRF-Token': created.row.csrf, 'Content-Type': 'application/json' };
    for (const [label, target] of [['movie', { type: 'movie', id: 'tt1160419' }], ['episode', { type: 'series', id: 'tt0903747', season: 1, episode: 1 }]]) {
      const result = { label }; report.results.push(result);
      const sources = await loadPublicSources(target, { fetchFn: (url, opts) => {
        assert.ok(url.startsWith('/api/discover/lookup?'));
        return fetch(base + url, { ...opts, headers });
      } });
      result.sources = sources.length;
      assert.ok(sources.length > 0, 'The tested title must return real sources');
      assert.ok(sources.every(s => /^[a-f0-9]{40}$/.test(s.hash)), 'Only valid hashes may be returned');
      result.masterKeyAbsent = !process.env.TORBOX_API_KEY || !JSON.stringify(sources).includes(process.env.TORBOX_API_KEY);
      assert.equal(result.masterKeyAbsent, true);
      const response = await fetch(base + '/api/discover/sources', { method: 'POST', headers, body: JSON.stringify({ target, sources }), signal: AbortSignal.timeout(35000) });
      result.registrationHttp = response.status;
      assert.equal(response.status, 200, 'Source registration must succeed');
      const registered = await response.json();
      result.registered = registered.sources?.length || 0;
      result.cached = registered.sources?.filter(s => s.cached === true).length || 0;
      result.unknown = registered.sources?.filter(s => s.cached === null).length || 0;
      assert.ok(result.registered > 0); assert.equal(result.unknown, 0, 'Cache checking must be verified, not merely source retrieval');
      assert.equal(app.discovery.operations.size, 0, 'Search must not prepare content');
    }
    report.ok = true;
  } catch (e) {
    report.error = /^[A-Z_]{1,80}$/.test(e?.code || '') ? e.code : 'LIVE_CHECK_FAILED';
    throw new Error('Read-only source pipeline verification failed; see the sanitized report.');
  } finally {
    if (app) { app.sessions.revokeAll(); app.server.closeAllConnections(); app.server.close(); }
    console.log(JSON.stringify(report));
  }
});

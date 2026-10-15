// Run from the repository: node docs/evidence/catalog-search/live-check.mjs
// Public catalog reads only. No account credentials or TorBox API calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Catalog } from '../../../lib/catalog.mjs';

const required = {
  original: 'tt0773262',
  newBlood: 'tt14164730',
  resurrection: 'tt33043892',
  originalSin: 'tt32252772'
};
const source = await readFile(new URL('../../../lib/catalog.mjs', import.meta.url));
const report = {
  timestamp: new Date().toISOString(),
  command: 'node docs/evidence/catalog-search/live-check.mjs',
  catalogSourceSha256: createHash('sha256').update(source).digest('hex'),
  scope: 'Live public catalog search through the actual Catalog class; no authenticated account, media playback or physical-device check.',
  required,
  queries: []
};
report.queries = await Promise.all(['Dexte', 'Dexter'].map(async query => {
  const requests = [];
  const catalog = new Catalog({ fetchFn: async (url, options) => {
    const target = new URL(url);
    assert.ok(['v3-cinemeta.strem.io', 'cinemeta-catalogs.strem.io', 'cinemeta-live.strem.io', 'v3.sg.media-imdb.com'].includes(target.hostname));
    const started = performance.now();
    try {
      const response = await fetch(url, options);
      requests.push({ url: String(url), status: response.status, elapsedMs: Math.round(performance.now() - started) });
      return response;
    } catch (error) {
      requests.push({ url: String(url), elapsedMs: Math.round(performance.now() - started), error: error.name });
      throw error;
    }
  } });
  const started = performance.now();
  try {
    const result = await catalog.search({ type: 'all', q: query });
    const ids = new Set(result.metas.map(meta => meta.id));
    const retained = Object.fromEntries(Object.entries(required).map(([name, id]) => [name, ids.has(id)]));
    const secondarySearchRequests = requests.filter(request => {
      const url = new URL(request.url);
      return url.hostname === 'cinemeta-catalogs.strem.io' && url.href.includes('search=');
    }).length;
    const row = {
      query,
      elapsedMs: Math.round(performance.now() - started),
      count: result.metas.length,
      retained,
      secondarySearchRequests,
      requests,
      results: result.metas.map(({ id, name, type, year }) => ({ id, name, type, year }))
    };
    try {
      for (const [name, present] of Object.entries(retained)) assert.equal(present, true, `${query}: missing ${name}`);
      assert.equal(secondarySearchRequests, 0, `${query}: secondary received a text search`);
      return { ...row, passed: true };
    } catch (error) { return { ...row, passed: false, error: error.message }; }
  } catch (error) {
    return { query, elapsedMs: Math.round(performance.now() - started), requests, passed: false, error: error.message };
  }
}));
report.passed = report.queries.every(row => row.passed);
await writeFile(new URL('./live-current.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, queries: report.queries.map(({ query, elapsedMs, count, retained, secondarySearchRequests, passed, error }) => ({ query, elapsedMs, count, retained, secondarySearchRequests, passed, error })) }, null, 2));
if (!report.passed) process.exitCode = 1;

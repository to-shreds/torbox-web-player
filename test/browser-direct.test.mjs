import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('browser-direct fallback remains available and exposes sanitized diagnostics without being canonical mode', async () => {
  const [html, app, direct, discover, sw, pkg] = await Promise.all([
    read('../public/index.html'),
    read('../public/app.js'),
    read('../public/direct-runtime.js'),
    read('../public/discover.js'),
    read('../public/sw.js'),
    read('../package.json')
  ]);
  assert.match(html, /name="runtime-mode" content="backend"/);
  assert.match(html, /name="api-origin" content="https:\/\/torbox-web-player-key\.onrender\.com"/);
  assert.match(html, /id="run-login-diagnostics"/);
  assert.match(html, /id="settings-run-diagnostics"/);
  assert.match(html, /id="diagnostics-dialog"/);
  assert.match(app, /directApi/);
  assert.match(app, /runDirectDiagnostics/);
  assert.match(app, /diagnosticText/);
  assert.match(direct, /CORS_BLOCKED_OR_UNREADABLE/);
  assert.match(direct, /TorBox user\/me/);
  assert.match(direct, /TorBox Relay status \(no auth\)/);
  assert.match(direct, /TorBox Relay status \(Bearer auth\)/);
  assert.match(direct, /Cinemeta catalog/);
  assert.doesNotMatch(direct, /recentTrace:[^\n]*credential/);
  assert.match(discover, /\/api\/discover\/lookup/);
  assert.match(sw, /\.\/direct-runtime\.js/);
  assert.match(pkg, /node --check public\/direct-runtime\.js/);
});

test('browser-direct CSP permits direct sources plus redundant Render and Cloudflare bridges', async () => {
  const html = await read('../public/index.html');
  for (const host of [
    'api.torbox.app',
    'relay.torbox.app',
    'v3-cinemeta.strem.io',
    'cinemeta-catalogs.strem.io',
    'cinemeta-live.strem.io',
    'zileanfortheweebs.midnightignite.me',
    'stremthru.13377001.xyz',
    'stremthru.elfhosted.com',
    'mediafusion.elfhosted.com'
  ]) assert.ok(html.includes(host), host);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
  assert.ok(csp.includes('https://torbox-web-player-key.onrender.com'));
  assert.ok(csp.includes('https://torbox-web-player-relay.jonathanjablon.workers.dev'));
  assert.ok(csp.includes('https://api.torbox.app'));
});

test('legacy Drive surface stays hidden while backendless transfer remains in canonical UI', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /id="portable-settings-group"/);
  assert.match(html, /id="drive-settings-group"[^>]*hidden/);
  assert.match(html, /GitHub Pages hosts the interface/);
});

test('redundant relay client and Cloudflare Worker share the allowlisted bridge contract', async () => {
  const [direct, config, worker] = await Promise.all([
    read('../public/direct-runtime.js'),
    read('../public/relay-config.json'),
    read('../relay/cloudflare/worker.js')
  ]);
  assert.match(direct,/DEFAULT_RELAY_PRIMARY/);
  assert.match(direct,/bridgeRetryable/);
  assert.match(direct,/primaryCooldownUntil/);
  assert.match(direct,/bridge_cloudflare_health/);
  assert.match(direct,/bridge_cloudflare_cinemeta/);
  assert.match(direct,/catalogBridge/);
  assert.match(worker,/CINEMETA_ROUTE='\/relay\/cinemeta'/);
  assert.match(worker,/CINEMETA_LIVE/);
  assert.match(direct,/timeoutMs=2000/);
  assert.match(direct,/torbox-browser-direct-diagnostics-v2/);
  assert.match(direct,/expectedDirectLimitations/);
  assert.match(direct,/optionalFailures/);
  assert.match(direct,/redundantTorboxReady/);
  assert.deepEqual(JSON.parse(config),{primary:'https://torbox-web-player-key.onrender.com',secondary:'https://torbox-web-player-relay.jonathanjablon.workers.dev'});
  for(const route of ['user/me','torrents/checkcached','torrents/mylist','torrents/createtorrent','torrents/requestdl'])assert.ok(worker.includes(route),route);
  assert.match(worker,/X-TorBox-Bridge/);
});

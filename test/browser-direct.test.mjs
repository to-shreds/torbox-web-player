import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('browser-direct experiment uses a local runtime and exposes a sanitized diagnostics lab', async () => {
  const [html, app, direct, discover, sw, pkg] = await Promise.all([
    read('../public/index.html'),
    read('../public/app.js'),
    read('../public/direct-runtime.js'),
    read('../public/discover.js'),
    read('../public/sw.js'),
    read('../package.json')
  ]);
  assert.match(html, /name="runtime-mode" content="direct"/);
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
    'zileanfortheweebs.midnightignite.me',
    'stremthru.13377001.xyz',
    'stremthru.elfhosted.com',
    'mediafusion.elfhosted.com'
  ]) assert.ok(html.includes(host), host);
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
  assert.ok(csp.includes('https://torbox-web-player-key.onrender.com'));
  assert.ok(csp.includes('https://*.workers.dev'));
  assert.ok(csp.includes('https://api.torbox.app'));
});

test('Render-only optional surfaces are hidden in browser-direct experiment', async () => {
  const html = await read('../public/index.html');
  assert.match(html, /id="sync-settings-group"[^>]*hidden/);
  assert.match(html, /id="drive-settings-group"[^>]*hidden/);
  assert.match(html, /Browser-direct experiment/);
});

test('redundant relay client and Cloudflare Worker share the allowlisted bridge contract', async () => {
  const [direct, config, worker, workflow] = await Promise.all([
    read('../public/direct-runtime.js'),
    read('../public/relay-config.json'),
    read('../relay/cloudflare/worker.js'),
    read('../.github/workflows/deploy-cloudflare-relay.yml')
  ]);
  assert.match(direct,/DEFAULT_RELAY_PRIMARY/);
  assert.match(direct,/bridgeRetryable/);
  assert.match(direct,/primaryCooldownUntil/);
  assert.match(direct,/bridge_cloudflare_health/);
  assert.deepEqual(JSON.parse(config),{primary:'https://torbox-web-player-key.onrender.com',secondary:''});
  for(const route of ['user/me','torrents/checkcached','torrents/mylist','torrents/createtorrent','torrents/requestdl'])assert.ok(worker.includes(route),route);
  assert.match(worker,/X-TorBox-Bridge/);
  assert.match(workflow,/cloudflare\/wrangler-action@v4/);
  assert.match(workflow,/CLOUDFLARE_API_TOKEN/);
  assert.match(workflow,/deployment-url/);
});

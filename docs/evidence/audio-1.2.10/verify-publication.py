"""Verify published audio reliability release assets and public API boundaries without an account."""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
BASELINE = '52303d8b33ef30fc37bc8f748cd322865f8ce982'
BUILD = 'release-1.2.10-audio.1'
ORIGIN = 'https://to-shreds.github.io'
API = 'https://torbox-web-player-key.onrender.com'


def request(url, method='GET', body=None, origin=ORIGIN):
    headers = {'Cache-Control': 'no-cache', 'Origin': origin}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=50) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def asset_check(job):
    prefix, path = job
    relative = path.removeprefix('public/')
    url = ORIGIN + '/torbox-web-player/' + prefix + relative + '?verify=' + BUILD
    status, data = request(url)
    expected = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
    actual = hashlib.sha256(data).hexdigest()
    return {'path': prefix + relative, 'status': status, 'sha256': actual,
            'expected': expected, 'ok': status == 200 and actual == expected}


paths = ['public/'+name for name in ['index.html','boot.js','app.js','discover.js','sw.js','trakt.js','trakt-vault.js','trakt.css','watch-party.js','source-client.js','playback-lifecycle.js','history.js','settings.js','sports-player.html','sports-catalog.json','games-catalog.json']]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    assets = list(pool.map(asset_check, [(prefix, path) for prefix in ['', 'key/'] for path in paths]))
checks = []
for path, expected in [('/healthz', 200), ('/api/session', 200), ('/api/library', 401)]:
    status, data = request(API + path)
    payload = json.loads(data)
    ok = status == expected
    if path == '/healthz':
        ok = ok and payload.get('version') == '1.2.10'
    if path == '/api/session':
        ok = ok and payload.get('authenticated') is False and payload.get('authMode') == 'api-key'
    checks.append({'path': path, 'status': status, 'result': payload, 'ok': ok})
for path, origin, expected in [('/api/watch-party/create', ORIGIN, 401),
                                ('/api/watch-party/join', ORIGIN, 404),
                                ('/api/watch-party/join', 'https://untrusted.invalid', 403)]:
    status, data = request(API + path, 'POST', {'token': 'invalid'}, origin)
    checks.append({'path': path, 'origin': origin, 'status': status, 'ok': status == expected})
for path in ['watch-party.js', 'app.js','discover.js','playback-lifecycle.js','boot.js','sw.js','trakt.js','trakt-vault.js','trakt.css']:
    status, data = request(API + '/' + path + '?verify=' + BUILD)
    checks.append({'path': '/' + path, 'status': status,
                   'ok': status == 200 and data == (ROOT / 'public' / path).read_bytes()})
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'build': BUILD,
          'assets': assets, 'apiChecks': checks,
          'success': bool(assets) and all(row['ok'] for row in assets + checks),
          'scope': 'Public root/key asset identity and backend version/origin/authentication boundaries. No real account, key, media or physical-device outcome was used.'}
pathlib.Path(__file__).with_name('publication.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'assets': len(assets), 'apiChecks': len(checks), 'success': report['success']}))
assert report['success']

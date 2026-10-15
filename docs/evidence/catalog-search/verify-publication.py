"""Verify public release bytes and unauthenticated API boundaries. No account key."""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import subprocess
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
BASELINE = '2cf363274ab2589cf7b314eb691ad62ddca021d9'
BUILD = 'release-1.2.5-search.1'
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


paths = subprocess.check_output(['git', 'diff', '--name-only', BASELINE, '--', 'public'], cwd=ROOT, text=True).splitlines()
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    assets = list(pool.map(asset_check, [(prefix, path) for prefix in ['', 'key/'] for path in paths]))
checks = []
for path, expected in [('/healthz', 200), ('/api/session', 200), ('/api/discover/lookup?type=movie&id=tt1234567&refresh=1', 401)]:
    status, data = request(API + path)
    payload = json.loads(data)
    ok = status == expected
    if path == '/healthz':
        ok = ok and payload.get('version') == '1.2.5'
    if path == '/api/session':
        ok = ok and payload.get('authenticated') is False and payload.get('authMode') == 'api-key'
    checks.append({'path': path, 'status': status, 'result': payload, 'ok': ok})
for path, origin, expected in [('/api/discover/prepare', ORIGIN, 401), ('/api/discover/sources', ORIGIN, 401), ('/api/watch-party/create', ORIGIN, 401), ('/api/discover/prepare', 'https://untrusted.invalid', 403)]:
    status, data = request(API + path, 'POST', {}, origin)
    checks.append({'path': path, 'origin': origin, 'status': status, 'ok': status == expected})
status, data = request(API + '/discover.js?verify=' + BUILD)
checks.append({'path': '/discover.js', 'status': status, 'ok': status == 200 and data == (ROOT / 'public/discover.js').read_bytes()})
report = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'build': BUILD,
          'assets': assets, 'apiChecks': checks,
          'success': bool(assets) and all(row['ok'] for row in assets + checks),
          'scope': 'Published bytes and public API boundaries. No authenticated TorBox session or real episode was used.'}
pathlib.Path(__file__).with_name('publication.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'assets': len(assets), 'apiChecks': len(checks), 'success': report['success']}))
assert report['success']

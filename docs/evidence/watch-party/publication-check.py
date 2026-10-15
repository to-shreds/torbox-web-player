import datetime,json,pathlib,urllib.error,urllib.request

base='https://torbox-web-player-key.onrender.com'
origin='https://to-shreds.github.io'
checks=[]

def request(path,method='GET',body=None,headers=None):
    h={'Cache-Control':'no-cache',**(headers or {})}
    if body is not None:h['Content-Type']='application/json'
    req=urllib.request.Request(base+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers=h)
    try:
        with urllib.request.urlopen(req,timeout=70) as response:return response.status,dict(response.headers),response.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()

status,headers,payload=request('/healthz',headers={'Origin':origin})
health=json.loads(payload)
checks.append({'name':'health','status':status,'version':health.get('version'),'ok':status==200 and health.get('version')=='1.2.3'})
status,headers,payload=request('/api/session',headers={'Origin':origin})
session=json.loads(payload)
checks.append({'name':'api-key session boundary','status':status,'authenticated':session.get('authenticated'),'authMode':session.get('authMode'),'ok':status==200 and session.get('authenticated') is False and session.get('authMode')=='api-key'})
for path in ['create','join','prepare','sync','leave']:
    status,headers,payload=request('/api/watch-party/'+path,'POST',{}, {'Origin':origin})
    data=json.loads(payload)
    checks.append({'name':'unauthenticated '+path,'status':status,'error':data.get('error'),'ok':status==401 and data.get('error')=='LOGIN_REQUIRED'})
status,headers,payload=request('/api/watch-party/join','POST',{}, {'Origin':'https://untrusted.invalid'})
data=json.loads(payload)
checks.append({'name':'foreign origin rejected','status':status,'error':data.get('error'),'ok':status==403 and data.get('error')=='BAD_ORIGIN'})
status,headers,payload=request('/api/watch-party/sync','OPTIONS',headers={'Origin':origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type,x-csrf-token'})
allow_origin=next((v for k,v in headers.items() if k.lower()=='access-control-allow-origin'),None)
checks.append({'name':'trusted CORS preflight','status':status,'allowOrigin':allow_origin,'ok':status in [200,204] and allow_origin==origin})
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtimeCommit':'345da16124644da1deb509662af07f4ee64079c6','backendMirror':'a23ddbb200816074c0cfeaf3d7e87dfc16ecf4a2','deployment':'dep-db83a7689jmc73c1n3vg','checks':checks,'success':all(c['ok'] for c in checks),'scope':'Public health, auth and CORS boundaries only; no real TorBox account or media was used.'}
pathlib.Path(__file__).with_name('render-publication.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'success':report['success']}))
assert report['success']

import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('extra player policies allow only same-origin embedding and scope WASM permission to DOS',async t=>{
  const {server}=createApp({env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/dos-player.html','/games-web/skifree/index.html']){
    const response=await fetch(origin+path),csp=response.headers.get('content-security-policy');
    assert.equal(response.status,200);assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
    assert.ok(csp.includes("frame-ancestors 'self'"));assert.ok(csp.includes("script-src 'self'"));
    assert.equal(csp.includes("'unsafe-eval'"),false);
    assert.equal(csp.includes("'wasm-unsafe-eval'"),path==='/dos-player.html');
    assert.equal(response.headers.get('set-cookie'),null);
  }
  const app=await fetch(origin+'/');assert.equal(app.headers.get('content-security-policy').includes("'wasm-unsafe-eval'"),false);
  assert.equal(app.headers.get('x-frame-options'),'DENY');
});

test('curated DOS bundles and exact GPL sources are available anonymously with recorded hashes',async t=>{
  const {server}=createApp({env:{}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const rights=JSON.parse(await readFile(new URL('../docs/evidence/extra-games/licenses.json',import.meta.url),'utf8'));
  const provenance=JSON.parse(await readFile(new URL('../public/vendor/dos/SOURCE-PROVENANCE.json',import.meta.url),'utf8'));
  const cases=[...rights.games.map(row=>({path:'/games-data/'+row.id+'.jsdos',hash:row.bundleSha256,type:'application/octet-stream'})),
    ...provenance.runtimeFiles.map(row=>({path:'/vendor/dos/'+row.file,hash:row.sha256,type:row.file.endsWith('.wasm')?'application/wasm':'javascript'})),
    {path:'/vendor/dos/'+provenance.sourceDelivery.archive,hash:provenance.sourceDelivery.archiveDetails.sha256,type:'application/gzip'}];
  for(const item of cases){
    const response=await fetch(origin+item.path);
    assert.equal(response.status,200,item.path);assert.ok(response.headers.get('content-type').includes(item.type));
    assert.equal(response.headers.get('set-cookie'),null);
    const data=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(data).digest('hex'),item.hash,item.path);
  }
  for(const path of ['/vendor/dos/LICENSE','/vendor/dos/SOURCES.md','/vendor/dos/THIRD-PARTY-NOTICES.txt','/games-data/licenses/dosdefender-UNLICENSE.txt','/games-data/licenses/master-mind-CC0-readme.txt','/games-data/licenses/zmiy-BSD-2-Clause-readme.txt','/games-web/skifree/LICENSE','/games-web/skifree/UPSTREAM.md']){
    const response=await fetch(origin+path);assert.equal(response.status,200,path);assert.ok((await response.text()).length>30);
  }
});

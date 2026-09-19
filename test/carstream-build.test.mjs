import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildCarStream,CARSTREAM_CSP } from '../tools/build-carstream.mjs';
async function fixture(t){
  const repo=await mkdtemp(join(tmpdir(),'carstream-build-'));t.after(()=>rm(repo,{recursive:true,force:true}));
  await cp(new URL('../public/',import.meta.url),join(repo,'public'),{recursive:true});
  const git=args=>execFileSync('git',['-C',repo,...args],{stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).toString().trim();
  git(['init','-q']);git(['add','public']);git(['commit','-qm','Fixture only']);return {repo,revision:git(['rev-parse','HEAD']),git};
}
test('canonical local build contains all source modules, exact revision and self-only CSP',async t=>{
  const {repo,revision}=await fixture(t),output=join(repo,'output'),manifest=await buildCarStream({repo,revision,output});
  assert.equal((await readFile(join(output,'TORBOX_WEB_REVISION'),'utf8')).trim(),revision);assert.equal(manifest.csp,CARSTREAM_CSP);
  const html=await readFile(join(output,'index.html'),'utf8');assert.match(html,/name="player-runtime" content="carstream"/);assert.match(html,/connect-src 'self'; media-src 'self'; img-src 'self'/);assert.ok(!html.includes('name="api-origin"'));assert.ok(!html.includes('rel="manifest"'));
  for(const name of await readdir(join(repo,'public'))){assert.ok(manifest.assets[name],name);const data=await readFile(join(output,name));assert.equal(createHash('sha256').update(data).digest('hex'),manifest.assets[name].sha256);if(name!=='index.html')assert.deepEqual(data,await readFile(join(repo,'public',name)));}
  assert.deepEqual(manifest.requiredHostModules,['/carstream/host.js']);assert.equal(manifest.requiresPhoneServices,true);
});
test('building the same commit twice is deterministic and ignores dirty source files',async t=>{
  const {repo,revision}=await fixture(t);const a=await buildCarStream({repo,revision,output:join(repo,'a')});
  await writeFile(join(repo,'public/app.js'),'THIS UNCOMMITTED COPY MUST NOT SHIP');
  const b=await buildCarStream({repo,revision,output:join(repo,'b')});assert.deepEqual(a,b);assert.deepEqual(await readFile(join(repo,'a/app.js')),await readFile(join(repo,'b/app.js')));
});
test('build rejects abbreviated refs and refuses to overwrite output trees',async t=>{
  const {repo,revision}=await fixture(t);await assert.rejects(()=>buildCarStream({repo,revision:'main',output:join(repo,'x')}),/full canonical commit/);
  await assert.rejects(()=>buildCarStream({repo,revision,output:join(repo,'public')}),/must not already exist/);
});
test('entry imports the host transport before initializing the unchanged application',async t=>{
  const {repo,revision}=await fixture(t),output=join(repo,'x');await buildCarStream({repo,revision,output});const entry=await readFile(join(output,'carstream-entry.js'),'utf8');
  assert.ok(entry.indexOf('await connectRuntime()')<entry.indexOf("await import('./app.js')"));assert.match(entry,/catch\(error\)/);assert.ok(!/https?:/.test(entry));
});

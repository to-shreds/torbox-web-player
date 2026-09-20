import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('production deploy requires the exact verified release-approved commit',async()=>{
  const pages=await read('../.github/workflows/pages.yml');
  assert.match(pages,/fetch origin release-approved/);
  assert.match(pages,/test "\$APPROVED_SHA" = "\$RELEASE_SHA"/);
  assert.match(pages,/Refusing to deploy unapproved main commit/);
});

test('verified production publishes immutable version and movable current pointers',async()=>{
  const pages=await read('../.github/workflows/pages.yml');
  assert.match(pages,/TAG="production-v\$VERSION"/);
  assert.match(pages,/refs\/tags\/production-current/);
  assert.match(pages,/refs\/heads\/production-current/);
});

test('rollback workflow defaults to rollback-stable and verifies before deploy',async()=>{
  const rollback=await read('../.github/workflows/rollback.yml');
  assert.match(rollback,/default: 'rollback-stable'/);
  const verify=rollback.indexOf('npm test'),deploy=rollback.indexOf('uses: actions\/deploy-pages@v4'.replace('\\/','/'));
  assert.ok(verify>=0&&deploy>verify);
  assert.match(rollback,/rollback:true/);
  assert.match(rollback,/ROLLBACK_LIVE/);
});

test('release candidate workflow approves only after syntax and full tests pass',async()=>{
  const workflow=await read('../.github/workflows/release-candidate.yml');
  const check=workflow.indexOf('npm run check'),tests=workflow.indexOf('npm test'),approve=workflow.indexOf('refs/heads/release-approved');
  assert.ok(check>=0&&tests>check&&approve>tests);
  assert.match(workflow,/branches: \[release-candidate\]/);
});

test('local recovery module is in the checked and cached browser graph',async()=>{
  const [pkg,sw,app,html]=await Promise.all([read('../package.json'),read('../public/sw.js'),read('../public/app.js'),read('../public/index.html')]);
  assert.match(pkg,/node --check public\/state-snapshots\.js/);
  assert.match(sw,/\.\/state-snapshots\.js/);
  assert.match(app,/snapshotForVersion\(APP_VERSION\)/);
  for(const id of ['state-snapshot-now','state-restore-open','state-restore-dialog','state-snapshot-list'])assert.ok(html.includes('id="'+id+'"'),id);
});

test('stale candidate runs cannot rewind release-approved',async()=>{
  const workflow=await read('../.github/workflows/release-candidate.yml');
  assert.match(workflow,/git fetch origin release-candidate --depth=1/);
  assert.match(workflow,/CURRENT_SHA="\$\(git rev-parse FETCH_HEAD\)"/);
  assert.match(workflow,/if \[ "\$CURRENT_SHA" != "\$CANDIDATE_SHA" \]/);
  assert.match(workflow,/refusing stale approval/);
});

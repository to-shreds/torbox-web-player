import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('mobile source chooser is paginated and non-scrolling',async()=>{
  const [js,css]=await Promise.all([
    readFile(new URL('../public/discover.js',import.meta.url),'utf8'),
    readFile(new URL('../public/discover.css',import.meta.url),'utf8')
  ]);
  assert.ok(js.includes("mobile?3:6"));
  assert.ok(js.includes("visible.filter(source=>source.id!==best?.id)"));
  assert.ok(css.includes("#source-dialog{overflow:hidden"));
  assert.ok(css.includes(".source-table-wrap{overflow:hidden"));
});

test('owner Share buttons route to Drive while guests do not get them',async()=>{
  const [js,html]=await Promise.all([
    readFile(new URL('../public/discover.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(js.includes('quickDriveShare'));
  assert.ok(js.includes("button('Share',()=>quickDriveShare"));
  assert.ok(js.includes('shareButton.hidden=guestMode'));
  assert.ok(html.includes('id="drive-dialog"'));
  assert.ok(html.includes('Start Drive transfer'));
});

test('Drive test uses TorBox Google OAuth with one success-URL paste and no Apps Script setup',async()=>{
  const [app,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(app.includes('open-drive-oauth'));
  assert.ok(app.includes('/api/drive/connect'));
  assert.ok(app.includes('navigator.clipboard?.readText'));
  assert.ok(html.includes('No Apps Script or Google Cloud setup'));
  assert.ok(html.includes('id="drive-success-url"'));
  assert.ok(html.includes('disable Drive download/copy for viewers'));
  assert.ok(html.includes('Delete now'));
  assert.ok(!html.includes('script.new'));
  assert.ok(!html.includes('drive-bridge'));
});

test('browser-key clone is discovery-only and does not display TorBox library',async()=>{
  const [js,html]=await Promise.all([
    readFile(new URL('../public/discover.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  for(const value of ['My files','library-panel','library-tab'])assert.ok(!html.includes(value));
  assert.ok(!js.includes('openLibrary'));
  assert.ok(!js.includes('loadLibrary'));
});

test('Continue Watching is removable with confirmation and no clear-all control',async()=>{
  const [app,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(app.includes("className='recent-remove'"));
  assert.ok(app.includes('Remove "'));
  assert.ok(app.includes('removeRecentTitle(item)'));
  assert.ok(!html.includes('id="clear-recent"'));
});
test('settings and TorBox outage preflight are visible while old connection checker is gone',async()=>{
  const [app,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(html.includes('id="settings-dialog"'));
  assert.ok(html.includes('id="torbox-status-banner"'));
  assert.ok(app.includes('/api/torbox-status'));
  assert.ok(app.includes('ensureTorBoxReady'));
  assert.ok(!html.includes('id="owner-form"'));
  assert.ok(!html.includes('>Connection<'));
});
test('Recently Played resume carries configurable rewind and player has a pause overlay',async()=>{
  const [app,discover,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/discover.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(discover.includes('rewindOnResumeSeconds=startOver?0:getSettings().resumeRewindSeconds'));
  assert.ok(app.includes('position = Math.max(0, position - rewind)'));
  assert.ok(html.includes('id="pause-card"'));
  assert.ok(app.includes('updatePauseCard'));
});

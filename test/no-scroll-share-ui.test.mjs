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

test('owner Share buttons route to the Drive transfer test while guests do not get them',async()=>{
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

test('Drive test exposes timing, watch-only control, and permanent-delete controls',async()=>{
  const [app,html,bridge]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../drive-bridge/Code.gs',import.meta.url),'utf8')
  ]);
  assert.ok(app.includes('TorBox → Drive'));
  assert.ok(app.includes('playbackMs'));
  assert.ok(html.includes('disable Drive download/copy for viewers'));
  assert.ok(html.includes('Delete now'));
  assert.ok(bridge.includes("method: 'delete'"));
  assert.ok(bridge.includes("itemDownloadRestriction"));
  assert.ok(bridge.includes("cleanupExpiredShares"));
  assert.ok(bridge.includes("cleanupBridgeOrphans"));
});

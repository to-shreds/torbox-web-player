import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('title UI exposes immediate play/more-options architecture without old custom player buttons',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('id="source-dialog"'));assert.ok(html.includes('id="recent-section"'));
  for(const id of ['back-ten','forward-ten','start-over','renew'])assert.ok(!html.includes(`id="${id}"`));
});

test('native video controls are retained while custom pause information is layered around them',async()=>{
  const [app,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(app.includes('video.controls = true'));
  assert.ok(html.includes('id="pause-title"'));
  assert.ok(html.includes('id="pause-time"'));
});

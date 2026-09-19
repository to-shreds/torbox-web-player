import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('title UI exposes immediate play/more-options architecture without old custom player buttons',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('id="source-dialog"'));assert.ok(html.includes('id="recent-section"'));
  for(const id of ['back-ten','forward-ten','start-over','renew'])assert.ok(!html.includes(`id="${id}"`));
});

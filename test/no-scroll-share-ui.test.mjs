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

test('sharing UI uses a fragment token and labels links as temporary',async()=>{
  const [js,html]=await Promise.all([
    readFile(new URL('../public/discover.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  assert.ok(js.includes("#guest="));
  assert.ok(html.includes('id="share-dialog"'));
  assert.ok(html.includes('Temporary access'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('search field advertises a mobile Search action and has a focused results heading',async()=>{
  const html=await read('../public/index.html');
  assert.match(html,/id="search"[^>]*type="search"[^>]*enterkeyhint="search"[^>]*inputmode="search"/);
  assert.match(html,/id="search-results-heading"[^>]*hidden>Search results<\/h2>/);
});

test('active search hides home-only rows and browse filters',async()=>{
  const [css,discover]=await Promise.all([read('../public/discover.css'),read('../public/discover.js')]);
  for(const selector of ['#search-history-section','#next-up-section','#recent-section','#watchlist-section','.catalog-filters','.preview-note']){
    assert.ok(css.includes('.search-mode '+selector),selector+' should be hidden while searching');
  }
  assert.match(discover,/document\.body\.classList\.toggle\('search-mode',searching\)/);
  assert.match(discover,/Search results for “\$\{query\}”/);
});

test('Android Search or Enter submits immediately and dismisses the keyboard',async()=>{
  const discover=await read('../public/discover.js');
  assert.match(discover,/\$\('search'\)\.addEventListener\('keydown',event=>/);
  assert.match(discover,/if\(event\.key!=='Enter'\)return/);
  assert.match(discover,/event\.preventDefault\(\)/);
  assert.match(discover,/\$\('search'\)\.blur\(\)/);
  assert.match(discover,/catalogAbort\?\.abort\(\);browse\(\)/);
});

test('clearing search restores Home and refreshes browse immediately',async()=>{
  const discover=await read('../public/discover.js');
  assert.match(discover,/if\(!\$\('search'\)\.value\.trim\(\)\)\{browse\(\);return;\}/);
  assert.match(discover,/document\.body\.classList\.remove\('search-mode'\)/);
});

test('text search spans movies and shows instead of inheriting hidden browse filters',async()=>{
  const discover=await read('../public/discover.js');
  assert.ok(discover.includes("type:query?'all':$('catalog-type').value"));
  assert.ok(discover.includes("genre:query?'':$('catalog-genre').value"));
  assert.ok(discover.includes("feed:query?'popular':$('catalog-feed').value"));
});

test('stable release metadata is 1.1.0',async()=>{
  const [pkg,entry,server,sw,readme]=await Promise.all([
    read('../package.json'),read('../entry.mjs'),read('../server.mjs'),read('../public/sw.js'),read('../README.md')
  ]);
  assert.equal(JSON.parse(pkg).version,'1.1.0');
  assert.match(entry,/version: '1\.1\.0'/);
  assert.match(server,/version: '1\.1\.0'/);
  assert.match(sw,/torbox-player-v1\.1/);
  assert.match(readme,/Current version: \*\*1\.1\.0\*\*/);
});

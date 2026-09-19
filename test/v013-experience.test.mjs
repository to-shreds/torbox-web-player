import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('Simple mode is default and Full mode is available in Settings',async()=>{
  const [html,settings,css]=await Promise.all([readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/settings.js',import.meta.url),'utf8'),readFile(new URL('../public/discover.css',import.meta.url),'utf8')]);
  assert.ok(html.includes('<body class="mode-simple">'));assert.ok(html.includes('id="setting-interface-mode"'));assert.ok(settings.includes("interfaceMode:'simple'"));assert.ok(css.includes('.mode-simple .advanced-only'));
});
test('home experience includes My list, Next Up, Continue Watching, and removable search history',async()=>{
  const [html,discover,app]=await Promise.all([readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/discover.js',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8')]);
  for(const id of ['watchlist-section','next-up-section','recent-section','search-history-section'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(discover.includes('renderNextUp'));assert.ok(discover.includes('recordSearch'));assert.ok(discover.includes('openQuickActions'));assert.ok(app.includes("className='recent-start-over'"));
});
test('Full mode exposes per-title quality, source feedback, and playback health without adding requested exclusions 12 or 13',async()=>{
  const [html,discover,app]=await Promise.all([readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/discover.js',import.meta.url),'utf8'),readFile(new URL('../public/app.js',import.meta.url),'utf8')]);
  for(const id of ['playback-health','health-sound-good','health-sound-bad','health-source-bad'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(discover.includes('This title quality'));assert.ok(app.includes('rememberSourceSuccess'));assert.ok(!html.includes('Replay last 30'));assert.ok(!html.includes('Recommended because:'));
});
test('PWA shell is installable and refuses to cache API or video traffic',async()=>{
  const [html,sw,manifest,server]=await Promise.all([readFile(new URL('../public/index.html',import.meta.url),'utf8'),readFile(new URL('../public/sw.js',import.meta.url),'utf8'),readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'),readFile(new URL('../server.mjs',import.meta.url),'utf8')]);
  assert.ok(html.includes('rel="manifest"'));assert.ok(html.includes("worker-src 'self'"));assert.ok(sw.includes("url.pathname.startsWith('/api/')"));assert.ok(sw.includes("url.origin!==self.location.origin"));assert.equal(JSON.parse(manifest).display,'standalone');
  for(const route of ['/watchlist.js','/search-history.js','/source-memory.js','/sw.js','/manifest.webmanifest','/icon.svg'])assert.ok(server.includes(`['${route}'`),route);
});

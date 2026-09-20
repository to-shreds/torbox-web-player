import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('settings are split into Basic and named advanced tabs',async()=>{
 const html=await read('../public/index.html');
 assert.match(html,/id="settings-tab-basic"[^>]*aria-selected="true"/);
 for(const name of ['playback','home','discover','kids','devices'])assert.ok(html.includes('data-settings-tab="'+name+'"'),name);
 assert.ok(html.includes('settings-tabs-label')&&html.includes('>Advanced<'));
});

test('every Basic setting has a plain-English tooltip and user names are optional',async()=>{
 const html=await read('../public/index.html'),basic=html.slice(html.indexOf('id="settings-panel-basic"'),html.indexOf('id="settings-panel-playback"'));
 const settings=(basic.match(/class="basic-setting(?: |")/g)||[]).length,tips=(basic.match(/class="setting-tip"/g)||[]).length;
 assert.equal(settings,8);assert.equal(tips,settings);
 assert.match(basic,/id="setting-viewer-1-name"[^>]*placeholder="User 1"/);assert.match(basic,/id="setting-viewer-2-name"[^>]*placeholder="User 2"/);
 assert.ok(!basic.includes('required'));
});

test('viewer names and remember-viewer behavior are wired into the persistent user selector',async()=>{
 const app=await read('../public/app.js');
 assert.ok(app.includes('viewerDisplayName'));assert.ok(app.includes('applyViewerNames'));assert.ok(app.includes('syncViewerPersistence'));
 assert.ok(app.includes("settings.rememberViewer?(localStorage.getItem('tw-viewer')"));
 assert.ok(app.includes("viewer1Name:$('setting-viewer-1-name').value"));assert.ok(app.includes("viewer2Name:$('setting-viewer-2-name').value"));
});

test('advanced Discover exposes starting browse, search responsiveness, and cached-source preference',async()=>{
 const [html,discover]=await Promise.all([read('../public/index.html'),read('../public/discover.js')]);
 for(const id of ['setting-catalog-type','setting-catalog-feed','setting-catalog-genre','setting-search-delay','setting-prefer-cached'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.ok(discover.includes('getSettings().searchDelayMs'));assert.ok(discover.includes('preferences.preferCachedSources'));
});

test('Settings opens on Basic and supports keyboard tab navigation',async()=>{
 const app=await read('../public/app.js');
 assert.ok(app.includes("activateSettingsTab('basic')"));
 for(const key of ['ArrowLeft','ArrowRight','Home','End'])assert.ok(app.includes("'"+key+"'"),key);
});

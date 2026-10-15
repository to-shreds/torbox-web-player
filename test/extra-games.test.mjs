import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cleanExtraGamesCatalog, extraPlayerUrl, extraKeyCommand, readExtraStatus, MINDMAZE_URL} from '../public/extra-games-core.js';

const dos = {id:'original-dos',title:'Original DOS Game',platform:'dos',bundle:'games-data/original-dos.jsdos',controls:'Use arrow keys.',keys:[{label:'Up',code:265}],license:'MIT',source:'https://example.org/source'};
const web = {id:'original-web',title:'Alpha browser game',platform:'web',page:'games-web/original-web/index.html',controls:'Use arrow keys.',keys:[{label:'Left',code:37}],license:'MIT',source:'https://example.org/source'};
const hosted = {id:'mindmaze-encarta',title:'MindMaze (Encarta browser recreation)',platform:'web',hosted:MINDMAZE_URL,controls:'Use the game controls.',keys:[],license:'Author-hosted recreation',source:MINDMAZE_URL};

test('extra game catalog supports DOS and browser data while preserving trusted fields and order',() => {
  const clean = cleanExtraGamesCatalog({version:1,items:[{...dos,extra:'ignored'},web,dos]});
  assert.deepEqual(clean.items.map(row => row.id),['original-web','original-dos']);
  assert.deepEqual(clean.items[1],dos);
  assert.throws(() => cleanExtraGamesCatalog({items:[]}),/invalid/);
  assert.throws(() => cleanExtraGamesCatalog({version:1,items:new Array(2001)}),/invalid/);
});
test('extra catalog excludes external, encoded, traversing and wrong-extension launch paths',() => {
  for (const bundle of ['https://example.org/game.jsdos','//example.org/game.jsdos','games-data/../other.jsdos','games-data/a%2fother.jsdos','games-data/a/b.jsdos','games-data/game.exe','games-data/game.jsdos?secret=1']) assert.equal(cleanExtraGamesCatalog({version:1,items:[{...dos,bundle}]}).items.length,0);
  for (const page of ['https://example.org/index.html','games-web/../index.html','games-web/a/other.html','games-web/a/b/index.html','games-web/a%2fb/index.html','games-web/a/index.html#x']) assert.equal(cleanExtraGamesCatalog({version:1,items:[{...web,page}]}).items.length,0);
  for (const source of ['javascript:alert(1)','http://example.org/source','https://user:secret@example.org/source','https://example.org:444/source']) assert.equal(cleanExtraGamesCatalog({version:1,items:[{...web,source}]}).items.length,0);
});
test('extra metadata and touch keys are bounded and invalid rows do not break others',() => {
  const invalid = [{...dos,title:'x'.repeat(161)},{...dos,controls:'x'.repeat(701)},{...dos,license:'x'.repeat(201)},{...dos,keys:[{label:'Bad',code:31}]},{...dos,keys:[{label:'Bad',code:349}]},{...dos,keys:[{label:'Bad',code:37.5}]},{...dos,keys:[{label:'Up',code:265},{label:'Duplicate',code:265}]},{...dos,keys:Array.from({length:17},(_,index) => ({label:'Key',code:32+index}))}];
  for (const row of invalid) assert.deepEqual(cleanExtraGamesCatalog({version:1,items:[row,web]}).items,[web]);
});
test('launch URLs stay relative and identify only the selected self-hosted game',() => {
  assert.equal(extraPlayerUrl(dos),'./dos-player.html?game=original-dos&v=release-1.2.3-party.1');
  assert.equal(extraPlayerUrl(web),'./games-web/original-web/index.html?v=release-1.2.3-party.1');
  assert.throws(() => extraPlayerUrl({...web,page:'api/session'}));
  assert.throws(() => extraPlayerUrl(dos,'../../../secret'));
});
test('only the pinned author-hosted MindMaze entry permits an external launch',() => {
  assert.deepEqual(cleanExtraGamesCatalog({version:1,items:[hosted]}).items,[hosted]);
  assert.equal(extraPlayerUrl(hosted),MINDMAZE_URL);
  const invalid = [
    {...hosted,id:'other-external-game'}, {...hosted,platform:'dos'}, {...hosted,source:'https://example.org/'},
    {...hosted,page:'games-web/mindmaze/index.html'}, {...hosted,bundle:'games-data/mindmaze.jsdos'}, {...hosted,keys:[{label:'Left',code:37}]}
  ];
  for (const url of ['http://gorjan.rocks/projects/mindmaze/','https://gorjan.rocks.evil.example/projects/mindmaze/','https://gorjan.rocks/projects/mindmaze/?x=1','https://gorjan.rocks/projects/mindmaze/#x','https://gorjan.rocks/projects/mindmaze','https://user:pass@gorjan.rocks/projects/mindmaze/','https://gorjan.rocks:443/projects/mindmaze/','//gorjan.rocks/projects/mindmaze/']) invalid.push({...hosted,hosted:url});
  for (const row of invalid) {
    assert.equal(cleanExtraGamesCatalog({version:1,items:[row]}).items.length,0);
    assert.throws(()=>extraPlayerUrl(row));
  }
});
test('numeric key commands preserve native DOM or DOS GLFW values and release explicitly',() => {
  assert.deepEqual(extraKeyCommand(265,true),{type:'torbox-extra-command',command:'key',key:265,pressed:true});
  assert.deepEqual(extraKeyCommand(37,false),{type:'torbox-extra-command',command:'key',key:37,pressed:false});
  for (const code of [-1,31,349,Infinity,37.5,'265']) assert.throws(() => extraKeyCommand(code,true));
  assert.throws(() => extraKeyCommand(37,1));
});
test('child statuses require the active WindowProxy and exact origin with bounded finite data',() => {
  const source = {}, other = {}, origin = 'https://player.example';
  const event = {source,origin,data:{type:'torbox-extra-status',state:'playing',message:'Playing.',frames:60}};
  assert.deepEqual(readExtraStatus(event,source,origin),{state:'playing',message:'Playing.',frames:60});
  assert.equal(readExtraStatus(event,other,origin),null);
  assert.equal(readExtraStatus({...event,origin:'https://evil.example'},source,origin),null);
  for (const data of [{...event.data,state:'closed'},{...event.data,message:'x'.repeat(701)},{...event.data,frames:NaN},{...event.data,frames:-1},{...event.data,type:'other'}]) assert.equal(readExtraStatus({...event,data},source,origin),null);
});
test('catalog runtime paths are valid and extra games do not depend on TorBox APIs',async () => {
  const raw = JSON.parse(await readFile(new URL('../public/extra-games-catalog.json',import.meta.url),'utf8'));
  const clean = cleanExtraGamesCatalog(raw); assert.equal(clean.items.length,raw.items.length);
  for (const item of clean.items) { assert.ok(extraPlayerUrl(item).startsWith('./') || (item.id === hosted.id && extraPlayerUrl(item) === MINDMAZE_URL)); assert.ok(item.license && item.source); }
  const source = await readFile(new URL('../public/extra-games.js',import.meta.url),'utf8');
  assert.ok(!source.includes('/api/')); assert.ok(!source.includes('onrender.com'));
  assert.ok(source.includes('games-playback-start')); assert.ok(source.includes('document.hasFocus()'));
});

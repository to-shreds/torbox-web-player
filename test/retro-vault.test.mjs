import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {cleanExtraGamesCatalog,extraPlayerUrl} from '../public/extra-games-core.js';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const ids=['snake','breakout','pong','invaders','asteroids','flappy','frog','tron','dodge','highway','ski','catch','missiles','jetpack','blocks','merge','sokoban','lights','connect','reversi','peg','slider','flood','match','sudoku','pipes'];
test('all 26 original games and a vault shortcut have individually launchable, internally hosted catalog entries',async()=>{
  const json=JSON.parse(await read('../public/extra-games-catalog.json'));
  const sanitized=cleanExtraGamesCatalog(json);
  assert.equal(sanitized.items.length,json.items.length,'no entries silently discarded');
  assert.equal(json.items.filter(x=>x.id.startsWith('retro-')).length,ids.length+1);
  for(const id of ids){
    const item=sanitized.items.find(x=>x.id===`retro-${id}`);
    assert(item,`missing ${id}`);
    assert.equal(item.page,'games-web/retro-vault/index.html');
    assert.equal(item.mode,id);
    assert.equal(item.platform,'web');
    assert.deepEqual(item.keys,[],'the game has built-in touch buttons');
    assert.match(extraPlayerUrl(item),new RegExp(`^\\./games-web/retro-vault/index\\.html\\?game=${id}&v=`));
  }
  const hub=sanitized.items.find(x=>x.id==='retro-vault');
  assert(hub);assert.equal(hub.mode,undefined);
  assert.match(extraPlayerUrl(hub),/^\.\/games-web\/retro-vault\/index\.html\?v=/);
  for(const item of json.items.filter(x=>!x.id.startsWith('retro-')))assert(sanitized.items.some(x=>x.id===item.id),'retained original '+item.id);
});
test('retro path and game parameters have an exact restricted allowlist',()=>{
  const valid={id:'retro-snake',title:'Snake',platform:'web',page:'games-web/retro-vault/index.html',mode:'snake',controls:'Touch or keyboard.',keys:[],license:'Original',source:'https://github.com/to-shreds/torbox-web-player'};
  const clean=x=>cleanExtraGamesCatalog({version:1,items:[x]}).items;
  assert.equal(clean(valid).length,1);
  for(const malformed of [
    {...valid,mode:'../snake'}, {...valid,mode:'not-a-game'}, {...valid,mode:'snake?next=secret'},
    {...valid,id:'retro-other'}, {...valid,page:'games-web/../index.html'},
    {...valid,id:'retro-vault',mode:'snake'}, {...valid,id:'retro-snake',mode:undefined},
    {...valid,page:'games-web/skifree/index.html'}, {...valid,hosted:'https://example.org/'},
  ])assert.equal(clean(malformed).length,0,JSON.stringify(malformed));
});
test('retro runtime contains no external scripts, ROMs, credential requests or untrusted remote assets',async()=>{
  const html=await read('../public/games-web/retro-vault/index.html');
  const js=await read('../public/games-web/retro-vault/game.js');
  assert.match(html,/script-src 'self'/);
  assert.match(html,/connect-src 'none'/);
  assert.doesNotMatch(html,/<script\s*>|<style\s*>|https?:\/\//i);
  assert.doesNotMatch(js,/\bfetch\s*\(|\bXMLHttpRequest\b|\beval\s*\(/);
  for(const id of ids)assert(js.includes(`['${id}',`),id);
  assert.match(js,/navigator\.getGamepads/);
  assert.match(js,/torbox-extra-status/);
  assert.match(js,/torbox-extra-command/);
  assert.match(js,/torbox-extra-exit/);
});
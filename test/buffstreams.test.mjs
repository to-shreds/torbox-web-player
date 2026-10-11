import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BUFFSTREAMS_BASE,buffstreamsBase,buffstreamsLinks} from '../public/buffstreams.js';

test('Buffstreams normalizes a bare domain or provider page to an HTTPS root',()=>{
  assert.equal(DEFAULT_BUFFSTREAMS_BASE,'https://mybuffstreams.plus');
  for(const value of ['mybuffstreams.plus',' https://MYBUFFSTREAMS.plus/ ','https://mybuffstreams.plus/nflstreams2','https://mybuffstreams.plus/watch/game','https://mybuffstreams.plus:443']){
    assert.equal(buffstreamsBase(value),DEFAULT_BUFFSTREAMS_BASE);
  }
  assert.equal(buffstreamsBase('https://www.buffstreams.example/nhlstreams2'),'https://www.buffstreams.example');
  assert.equal(buffstreamsBase('new-buffstreams.example'),'https://new-buffstreams.example');
});

test('Buffstreams refuses private data, unsupported schemes and invalid provider hosts',()=>{
  for(const value of [
    '',null,undefined,'http://mybuffstreams.plus','javascript:alert(1)','data:text/html,test',
    'https://user:password@mybuffstreams.plus','https://mybuffstreams.plus?key=private',
    'https://mybuffstreams.plus/nflstreams2?token=private','https://mybuffstreams.plus/#private',
    'https://mybuffstreams.plus:444','https://127.0.0.1',
    'https://[::1]','https://localhost','https://example.com','https://mybuffstreams',
    'https://-buffstreams.example','https://buffstreams-.example','https://buffstreams..example',
    'https://buffstreams_test.example'
  ])assert.throws(()=>buffstreamsBase(value),undefined,String(value));
});

test('Buffstreams links contain only the current public root and sport paths',()=>{
  for(const base of [DEFAULT_BUFFSTREAMS_BASE,'https://new-buffstreams.example']){
    const links=buffstreamsLinks(base);
    assert.deepEqual(links.map(({id,url})=>({id,url})),[
      {id:'all',url:base+'/'},
      {id:'nfl',url:base+'/nflstreams2'},
      {id:'cfb',url:base+'/cfbstreams2'},
      {id:'nhl',url:base+'/nhlstreams2'}
    ]);
    for(const link of links){
      assert.equal(typeof link.title,'string');assert.ok(link.title.trim());
      const url=new URL(link.url);
      assert.equal(url.origin,base);assert.equal(url.search,'');assert.equal(url.hash,'');
      assert.equal(url.username,'');assert.equal(url.password,'');
    }
  }
  assert.throws(()=>buffstreamsLinks('https://example.com'));
});

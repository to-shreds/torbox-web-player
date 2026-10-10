import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ARTWORK_HOSTS, artworkCandidates, bindArtworkImage } from '../public/discover.js';

const id='tt6933238',small=`https://images.metahub.space/poster/small/${id}/img`,medium=`https://images.metahub.space/poster/medium/${id}/img`;
function fixture(){
  const listeners=new Map(),scheduled=new Map(),requests=[];let n=0;
  const img={isConnected:true,hidden:false,addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:(event)=>listeners.delete(event),set src(url){requests.push(url);},get src(){return requests.at(-1);}};
  const timers={setTimeout(fn){scheduled.set(++n,fn);return n;},clearTimeout(key){scheduled.delete(key);}};
  return {img,timers,requests,emit:event=>listeners.get(event)?.(),tick(){const work=[...scheduled.values()];scheduled.clear();for(const fn of work)fn();},scheduled};
}
test('actual live artwork redirect is allowed by the production image CSP without allowing scripts',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(csp.split(';').find(x=>x.trim().startsWith('img-src ')).includes('https://live.metahub.space'));
  assert.equal(csp.split(';').find(x=>x.trim().startsWith('script-src ')).trim(),"script-src 'self'");
  assert.ok(ARTWORK_HOSTS.includes('live.metahub.space'));
});
test('live poster metadata is accepted but lookalike hosts, cleartext and credentials are rejected',()=>{
  const live=`https://live.metahub.space/poster/small/${id}/img`;
  assert.equal(artworkCandidates(live,id)[0],live);
  for(const url of ['http://live.metahub.space/a','https://live.metahub.space.evil.test/a','https://user:key@live.metahub.space/a','https://live.metahub.space:8443/a','javascript:alert(1)'])assert.deepEqual(artworkCandidates(url,''),[]);
});
test('missing poster uses the exact title ID and an existing medium URL is deduplicated',()=>{
  assert.deepEqual(artworkCandidates('',id),[medium]);
  assert.deepEqual(artworkCandidates(medium,id),[medium]);
  assert.deepEqual(artworkCandidates('','not-an-id'),[]);
});
test('primary success does not add requests or retries',()=>{
  const f=fixture();bindArtworkImage(f.img,small,id,f.timers);f.emit('load');f.emit('error');f.tick();
  assert.deepEqual(f.requests,[small]);assert.equal(f.img.hidden,false);
});
test('failed or undecodable primary tries another size without hiding the card',()=>{
  const f=fixture();bindArtworkImage(f.img,small,id,f.timers);f.emit('error');
  assert.deepEqual(f.requests,[small,medium]);assert.equal(f.img.hidden,false);f.emit('load');f.tick();assert.equal(f.requests.length,2);
});
test('persistent failure makes at most three requests, then reveals the existing text fallback',()=>{
  const f=fixture();bindArtworkImage(f.img,small,id,f.timers);f.emit('error');f.emit('error');f.tick();
  assert.equal(f.requests.length,3);assert.equal(new URL(f.requests[2]).searchParams.get('_artwork_retry'),'1');
  f.emit('error');f.emit('error');f.tick();assert.equal(f.requests.length,3);assert.equal(f.img.hidden,true);assert.equal(f.scheduled.size,0);
});
test('navigation away cancels a delayed retry and does not start obsolete downloads',()=>{
  const f=fixture();bindArtworkImage(f.img,small,id,f.timers);f.emit('error');f.emit('error');f.img.isConnected=false;f.tick();assert.equal(f.requests.length,2);
  const other=fixture();bindArtworkImage(other.img,small,id,other.timers);other.img.isConnected=false;other.emit('error');assert.equal(other.requests.length,1);
});
test('successful transient retry remains visible',()=>{
  const f=fixture();bindArtworkImage(f.img,small,'',f.timers);f.emit('error');f.tick();f.emit('load');
  assert.equal(f.requests.length,2);assert.equal(f.img.hidden,false);assert.equal(f.scheduled.size,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { directApi } from '../public/direct-runtime.js';
const ID='tt9100001',shared='f'.repeat(40);
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
test('browser direct fan-in preserves a later H.264/AAC variant after forty unknown sources arrive first',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=String(input);
    if(url.startsWith('https://zileanfortheweebs.midnightignite.me/'))throw new TypeError('offline');
    if(url.startsWith('https://stremthru.13377001.xyz/')){
      const streams=Array.from({length:40},(_,i)=>({
        infoHash:i===0?shared:i.toString(16).padStart(40,'0'),
        title:'Fixture.'+i+'.720p',seeders:100-i,
        behaviorHints:{filename:'Fixture.'+i+'.720p.mkv',videoSize:900000000+i}
      }));
      return response({streams});
    }
    if(url.startsWith('https://stremthru.elfhosted.com/'))return response({streams:[{
      infoHash:shared,title:'Fixture.720p.H264.AAC',videoCodec:'H264',audioCodecs:['AAC'],
      behaviorHints:{filename:'Fixture.720p.H264.AAC.mp4',videoSize:700000000}
    }]});
    if(url.startsWith('https://mediafusion.elfhosted.com/'))return new Response('<rss><channel></channel></rss>',{status:200,headers:{'content-type':'application/xml'}});
    throw new Error('unexpected '+url);
  };
  try{
    const result=await directApi('/api/discover/lookup?type=movie&id='+ID);
    assert.ok(result.sources.length<=40);
    assert.ok(result.sources.some(source=>source.browserFriendly===true&&source.hash===shared));
    assert.equal(result.sources[0].browserFriendly,true);
  }finally{globalThis.fetch=original;}
});

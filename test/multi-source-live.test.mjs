import test from 'node:test';
import assert from 'node:assert/strict';
import { StremioSourceLookup, PUBLIC_STREMIO_PROVIDERS } from '../lib/source-lookup.mjs';

test('opt-in read-only anonymous fallback provider observation', { skip: process.env.MULTI_SOURCE_LIVE_CHECK !== '1', timeout: 120000 }, async()=>{
  const report={event:'multi_source_live',providers:[],torrentAdditions:0};
  for(const row of PUBLIC_STREMIO_PROVIDERS){
    const item={provider:row.name};
    try{
      const lookup=new StremioSourceLookup({...row});
      const movie=await lookup.lookup({type:'movie',id:'tt1160419'});
      const episode=await lookup.lookup({type:'series',id:'tt0903747',season:1,episode:1});
      item.movie=movie.sources.length;
      item.episode=episode.sources.length;
      item.outcome='ok';
      if(row.id==='stremthru'){
        assert.ok(item.movie>0);
        assert.ok(item.episode>0);
      }
    }catch(e){
      item.outcome=e?.code||'ERROR';
    }
    report.providers.push(item);
  }
  console.log(JSON.stringify(report));
});
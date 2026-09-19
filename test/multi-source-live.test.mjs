import test from 'node:test';
import { TorznabSourceLookup, StremioSourceLookup, ACTIVE_STREMIO_PROVIDERS } from '../lib/source-lookup.mjs';

test('opt-in read-only anonymous source aggregation observation', { skip: process.env.MULTI_SOURCE_LIVE_CHECK !== '1', timeout: 120000 }, async()=>{
  const report={event:'multi_source_live',providers:[],torrentAdditions:0};
  const providers=[
    {name:'MediaFusion Torznab',lookup:new TorznabSourceLookup()},
    ...ACTIVE_STREMIO_PROVIDERS.map(row=>({name:row.name,lookup:new StremioSourceLookup({...row})}))
  ];
  for(const provider of providers){
    const item={provider:provider.name};
    try{
      const movie=await provider.lookup.lookup({type:'movie',id:'tt1160419'});
      const episode=await provider.lookup.lookup({type:'series',id:'tt0903747',season:1,episode:1});
      item.movie=movie.sources.length; item.episode=episode.sources.length; item.outcome='ok';
      item.movieSeeders=movie.sources.filter(x=>Number.isSafeInteger(x.seeders)).length;
      item.episodeSeeders=episode.sources.filter(x=>Number.isSafeInteger(x.seeders)).length;
    }catch(e){ item.outcome=e?.code||'ERROR'; }
    report.providers.push(item);
  }
  console.log(JSON.stringify(report));
});

import {sportsMediaUrl} from './sports-core.js?v=release-1.2.7-audio.2';

// This document's exact media/connect CSP checks all redirect destinations.
// It excludes Render even when this document is served by Render itself.
globalThis.createSportsHls=()=>{
  if(!globalThis.fetch||!globalThis.AbortController||!globalThis.ReadableStream||!globalThis.Request)throw new Error('This browser needs a newer version to play this channel.');
  const player=new globalThis.Hls({
    enableWorker:false,progressive:true,maxBufferLength:30,capLevelToPlayerSize:true,
    manifestLoadingTimeOut:12000,fragLoadingTimeOut:15000,
    fetchSetup(context,init){return new Request(sportsMediaUrl(context.url),{...init,mode:'cors',credentials:'omit',redirect:'follow',referrerPolicy:'no-referrer'});}
  });
  if(player.config.loader===globalThis.Hls.DefaultConfig.loader){player.destroy();throw new Error('This browser needs a newer version to play this channel.');}
  return player;
};

// Synthetic, local-only integration fixture. Never imported by production.
import { createApp } from '../../server.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export const target = {type:'series',id:'tt1234567',season:1,episode:1};
export const recent = {type:'series',id:target.id,title:'Fixture Show',season:1,episode:1,episodeName:'One',position:40,duration:120,updatedAt:Date.now(),completed:false};
export async function startFixture(port=4175) {
  const origin=`http://127.0.0.1:${port}`;
  const control={sessionDelay:0,progressDelay:0,statusDelay:0,lookupDelay:0,cached:true,created:false,creates:0,playbackCalls:0,mediaFetches:0,logins:0};
  const items=[1,2,3].map(id=>({id,hash:String.fromCharCode(96+id).repeat(40),name:'Fixture Show',download_finished:true,download_present:true,files:[{id:0,short_name:`Fixture.Show.S01E0${id}.${['One','Two','Three'][id-1]}.720p.H264.AAC.mp4`,mimetype:'video/mp4',size:1000000}]}));
  const meta={id:target.id,type:'series',name:'Fixture Show',releaseInfo:'2024',videos:items.map((item,index)=>({id:`${target.id}:1:${index+1}`,season:1,episode:index+1,name:['One','Two','Three'][index],released:'2024-01-01'}))};
  const provider={key:'fixture-master-key',account:async()=>{await pause(control.statusDelay);return{valid:true};},request:async(path,params)=>params?.id?items.find(row=>row.id===Number(params.id)):control.cached||control.created?items:[],resolveForRelay:async id=>({file:{id,title:items[Number(id.split(':')[1])-1].files[0].short_name,state:'Ready to watch'},upstreamUrl:'https://store.tb-cdn.io/fixture.mp4?token=fixture-master-key'})};
  const discoveryFetch=async input=>{
    const url=new URL(input);
    if(url.hostname==='status.torbox.app')return new Response('All systems operational');
    if(url.pathname.includes('/meta/'))return Response.json({meta});
    if(url.pathname.includes('/catalog/'))return Response.json({metas:[{...meta,type:url.pathname.includes('/series/')?'series':'movie'}]});
    if(url.pathname.endsWith('/checkcached'))return Response.json({success:true,data:control.cached?Object.fromEntries(items.map(item=>[item.hash,{files:item.files.map(file=>({name:file.short_name,size:file.size,mimetype:file.mimetype}))}])):{}});
    if(url.pathname.endsWith('/createtorrent')){control.created=true;control.creates++;return Response.json({success:true,data:{torrent_id:1}});}
    throw new Error('Unexpected fixture upstream: '+url.origin+url.pathname);
  };
  const app=createApp({env:{AUTH_MODE:'api-key',PUBLIC_ORIGIN:origin,FRONTEND_ORIGINS:origin},provider,providerFactory:()=>provider,discoveryFetch,mediaFetch:async()=>{control.mediaFetches++;throw new Error('No media relay allowed');},sourceLookupService:{lookup:async selected=>{await pause(control.lookupDelay);const item=items[(selected.episode||1)-1];return{sources:[{hash:item.hash,title:item.files[0].short_name,filename:item.files[0].short_name,resolution:'720p',videoCodec:'H264',audioCodecs:['AAC'],size:1000000,provider:'Fixture'}]};}}});
  const handler=app.server.listeners('request')[0];app.server.removeAllListeners('request');
  app.server.on('request',async(req,res)=>{
    const path=new URL(req.url,origin).pathname;
    if(path==='/'){
      const html=(await readFile(new URL('../../public/index.html',import.meta.url),'utf8')).replaceAll('https://torbox-web-player-key.onrender.com',origin);
      res.setHeader('Content-Type','text/html');res.end(html);return;
    }
    if(path==='/api/session'&&control.sessionDelay)await pause(control.sessionDelay);
    if(path==='/api/progress'&&control.progressDelay)await pause(control.progressDelay);
    if(path==='/api/playback')control.playbackCalls++;
    if(path==='/api/login')control.logins++;
    void handler(req,res);
  });
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  return{...app,origin,control,provider,session(){const row=app.sessions.create();row.row.provider=provider;return row.id;},close:()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);})};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const f=await startFixture(4174);console.log('Synthetic player fixture: '+f.origin);}

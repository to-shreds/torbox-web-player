import test from 'node:test';
import assert from 'node:assert/strict';
import { validBridgeUrl, extractDriveFileId, selectIntegrationJob, DriveTransferTests } from '../lib/drive-share.mjs';
import { TorBox } from '../lib/torbox.mjs';

test('Drive bridge accepts only fixed Apps Script web-app URLs',()=>{
  assert.equal(validBridgeUrl('https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz1234567890/exec'),true);
  for(const value of ['https://evil.test/exec','https://script.google.com/macros/s/x/exec','https://script.google.com/macros/s/abcdefghijklmnopqrstuvwxyz1234567890/dev','javascript:alert(1)']) assert.equal(validBridgeUrl(value),false);
});

test('Drive file IDs are extracted only from Google Drive URLs',()=>{
  assert.equal(extractDriveFileId('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view'),'1AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(extractDriveFileId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv'),'1AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(extractDriveFileId('https://evil.test/file/d/1AbCdEfGhIjKlMnOpQrStUv/view'),'');
});

test('integration job selection ignores old jobs and keeps the matching fresh Google upload',()=>{
  const run={kind:'torrents',fileId:3,startedAt:100000,baselineJobIds:['1']};
  const jobs=[
    {id:1,integration:'googledrive',type:'torrent',file_id:3,created_at:new Date(99000).toISOString()},
    {id:2,integration:'googledrive',type:'torrent',file_id:4,created_at:new Date(101000).toISOString()},
    {id:3,integration:'googledrive',type:'torrent',file_id:3,created_at:new Date(102000).toISOString()}
  ];
  assert.equal(selectIntegrationJob(jobs,run).id,3);
});

test('TorBox Google Drive queue sends exact file identity and short-lived Google token',async()=>{
  const calls=[];
  const api=new TorBox({key:'tb-fixture-secret',fetchFn:async(url,opts)=>{
    calls.push({url:String(url),opts});
    assert.equal(String(url),'https://api.torbox.app/v1/api/integration/googledrive');
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers.Authorization,'Bearer tb-fixture-secret');
    assert.deepEqual(JSON.parse(opts.body),{id:7,type:'torrent',file_id:3,google_token:'google-oauth-token-abcdefghijklmnopqrstuvwxyz'});
    return new Response(null,{status:204});
  }});
  await api.queueGoogleDrive({kind:'torrents',itemId:7,fileId:3},'google-oauth-token-abcdefghijklmnopqrstuvwxyz');
  assert.equal(calls.length,1);
});

test('Drive transfer test measures upload and processing, publishes once, and permanently deletes',async()=>{
  let now=100000;
  const calls={queue:0,publish:0,remove:0,inspect:0};
  let jobs=[{id:10,integration:'googledrive',type:'torrent',file_id:99,status:'completed',created_at:new Date(50000).toISOString()}];
  const bridge={
    normalize:config=>config,
    ping:async()=>({bridge:'fixture',driveScope:'drive.file'}),
    token:async()=> 'google-oauth-token-abcdefghijklmnopqrstuvwxyz',
    find:async()=>({fileId:''}),
    publish:async(config,fileId,deleteAt,options)=>{calls.publish++;assert.equal(fileId,'1AbCdEfGhIjKlMnOpQrStUv');assert.equal(options.blockDownload,true);return{previewUrl:'https://drive.google.com/file/d/'+fileId+'/preview',viewUrl:'https://drive.google.com/file/d/'+fileId+'/view',downloadRestricted:true};},
    inspect:async()=>{calls.inspect++;return{name:'Episode.mp4',videoReady:calls.inspect>1};},
    remove:async(config,fileId)=>{calls.remove++;assert.equal(fileId,'1AbCdEfGhIjKlMnOpQrStUv');return{ok:true};}
  };
  const provider={
    resolveFile:async id=>{assert.equal(id,'torrents:7:3');return{kind:'torrents',itemId:7,fileId:3,file:{id,title:'Episode.mp4',size:700000000}};},
    integrationJobs:async()=>jobs,
    queueGoogleDrive:async(resolved,token)=>{calls.queue++;assert.equal(resolved.fileId,3);assert.match(token,/google-oauth-token/);}
  };
  const service=new DriveTransferTests({bridge,now:()=>now});
  const session={guest:false};
  assert.equal((await service.configure(session,{url:'fixture-url',secret:'fixture-secret'})).configured,true);
  const started=await service.start(session,provider,{videoId:'torrents:7:3',deleteMinutes:10,blockDownload:true});
  assert.equal(started.status,'queued');assert.equal(calls.queue,1);

  now+=30000;
  jobs=[...jobs,{id:11,integration:'googledrive',type:'torrent',file_id:3,status:'completed',progress:1,created_at:new Date(now-1000).toISOString(),download_url:'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view'}];
  const processing=await service.status(session,provider,started.id);
  assert.equal(processing.status,'drive_processing');assert.equal(processing.uploadMs,30000);assert.equal(processing.downloadRestricted,true);assert.equal(calls.publish,1);

  now+=12000;
  const ready=await service.status(session,provider,started.id);
  assert.equal(ready.status,'ready');assert.equal(ready.playbackMs,42000);assert.equal(calls.publish,1);
  assert.match(ready.previewUrl,/drive\.google\.com/);

  const deleted=await service.remove(session,started.id);
  assert.equal(deleted.status,'deleted');assert.equal(calls.remove,1);
});

test('guest sessions cannot configure or start Drive exports',async()=>{
  const bridge={normalize:x=>x,ping:async()=>({}),token:async()=>''};
  const service=new DriveTransferTests({bridge});
  await assert.rejects(service.configure({guest:true},{url:'x',secret:'y'}),e=>e.code==='GUEST_FORBIDDEN');
  await assert.rejects(service.start({guest:true},{},{}),e=>e.code==='GUEST_FORBIDDEN');
});

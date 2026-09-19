import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTorBoxGoogleSuccess, extractDriveFileId, selectIntegrationJob, GoogleDriveClient, DriveTransferTests, TORBOX_GOOGLE_OAUTH } from '../lib/drive-share.mjs';
import { TorBox } from '../lib/torbox.mjs';

test('TorBox Google success URL yields a short-lived Google token without accepting arbitrary origins',()=>{
  const now=1_800_000_000_000;
  const url='https://torbox.app/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_in=3600&expires_at='+Math.floor((now+3600000)/1000);
  const auth=parseTorBoxGoogleSuccess(url,now);
  assert.equal(auth.token,'google-oauth-token-abcdefghijklmnopqrstuvwxyz');
  assert.equal(auth.expiresAt,now+3600000);
  for(const value of [
    'https://evil.test/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_in=3600',
    'https://torbox.app/not-success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_in=3600',
    'https://torbox.app/google/success?token=x&expires_in=3600'
  ]) assert.throws(()=>parseTorBoxGoogleSuccess(value,now));
  assert.equal(TORBOX_GOOGLE_OAUTH,'https://api.torbox.app/v1/api/integration/oauth/google');
});

test('expired TorBox Google success tokens are rejected',()=>{
  const now=1_800_000_000_000;
  assert.throws(()=>parseTorBoxGoogleSuccess('https://torbox.app/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_at='+Math.floor((now+120000)/1000),now),e=>e.code==='DRIVE_OAUTH_EXPIRED');
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

test('Google Drive client sends bearer token and permanent DELETE without returning the token',async()=>{
  const token='google-oauth-token-abcdefghijklmnopqrstuvwxyz';
  const auth={token,expiresAt:Date.now()+3600000};
  const seen=[];
  const drive=new GoogleDriveClient({fetchFn:async(url,opts)=>{
    seen.push({url:String(url),opts});
    if(opts.method==='DELETE')return new Response(null,{status:204});
    return new Response(JSON.stringify({files:[{id:'x'}]}),{status:200,headers:{'content-type':'application/json'}});
  }});
  await drive.validate(auth);
  await drive.remove(auth,'1AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(seen[0].opts.headers.Authorization,'Bearer '+token);
  assert.equal(seen[1].opts.method,'DELETE');
  assert.ok(!JSON.stringify(await drive.remove).includes?.(token));
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

test('easy Drive transfer measures upload and processing, publishes once, and permanently deletes',async()=>{
  let now=1_800_000_000_000;
  const calls={queue:0,publish:0,remove:0,inspect:0,timers:0};
  let jobs=[{id:10,integration:'googledrive',type:'torrent',file_id:99,status:'completed',created_at:new Date(now-50000).toISOString()}];
  const drive={
    validate:async()=>true,
    find:async()=>({fileId:''}),
    publish:async(auth,fileId,options)=>{calls.publish++;assert.equal(fileId,'1AbCdEfGhIjKlMnOpQrStUv');assert.equal(options.blockDownload,true);return{previewUrl:'https://drive.google.com/file/d/'+fileId+'/preview',viewUrl:'https://drive.google.com/file/d/'+fileId+'/view',downloadRestricted:true};},
    inspect:async()=>{calls.inspect++;return{name:'Episode.mp4',videoReady:calls.inspect>1};},
    remove:async(auth,fileId)=>{calls.remove++;assert.equal(fileId,'1AbCdEfGhIjKlMnOpQrStUv');return{deleted:true};}
  };
  const provider={
    resolveFile:async id=>{assert.equal(id,'torrents:7:3');return{kind:'torrents',itemId:7,fileId:3,file:{id,title:'Episode.mp4',size:700000000}};},
    integrationJobs:async()=>jobs,
    queueGoogleDrive:async(resolved,token)=>{calls.queue++;assert.equal(resolved.fileId,3);assert.equal(token,'google-oauth-token-abcdefghijklmnopqrstuvwxyz');}
  };
  const fakeTimer=()=>{calls.timers++;return{unref(){}}};
  const service=new DriveTransferTests({drive,now:()=>now,setTimer:fakeTimer});
  const session={guest:false};
  const successUrl='https://torbox.app/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_at='+Math.floor((now+3600000)/1000);
  assert.equal((await service.configure(session,{successUrl})).configured,true);
  const started=await service.start(session,provider,{videoId:'torrents:7:3',deleteMinutes:10,blockDownload:true});
  assert.equal(started.status,'queued');assert.equal(calls.queue,1);

  now+=30000;
  jobs=[...jobs,{id:11,integration:'googledrive',type:'torrent',file_id:3,status:'completed',progress:1,created_at:new Date(now-1000).toISOString(),download_url:'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view'}];
  const processing=await service.status(session,provider,started.id);
  assert.equal(processing.status,'drive_processing');assert.equal(processing.uploadMs,30000);assert.equal(processing.downloadRestricted,true);assert.equal(calls.publish,1);assert.equal(calls.timers,1);

  now+=12000;
  const ready=await service.status(session,provider,started.id);
  assert.equal(ready.status,'ready');assert.equal(ready.playbackMs,42000);assert.equal(calls.publish,1);
  assert.match(ready.previewUrl,/drive\.google\.com/);

  const deleted=await service.remove(session,started.id);
  assert.equal(deleted.status,'deleted');assert.equal(calls.remove,1);
});

test('easy Drive timing test rejects too-long cleanup and guest access',async()=>{
  let now=1_800_000_000_000;
  const drive={validate:async()=>true};
  const service=new DriveTransferTests({drive,now:()=>now});
  const session={guest:false};
  await service.configure(session,{successUrl:'https://torbox.app/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_at='+Math.floor((now+3600000)/1000)});
  await assert.rejects(service.start(session,{}, {videoId:'torrents:7:3',deleteMinutes:60}),e=>e.code==='DRIVE_DELETE_TIME');
  await assert.rejects(service.configure({guest:true},{successUrl:'https://torbox.app/google/success?token=google-oauth-token-abcdefghijklmnopqrstuvwxyz&expires_in=3600'}),e=>e.code==='GUEST_FORBIDDEN');
  await assert.rejects(service.start({guest:true},{},{}),e=>e.code==='GUEST_FORBIDDEN');
});

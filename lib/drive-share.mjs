import { randomUUID } from 'node:crypto';
import { AppError } from './torbox.mjs';

const TYPE_MAP=Object.freeze({torrents:'torrent',usenet:'usenet',webdl:'webdownload'});
export const TORBOX_GOOGLE_OAUTH='https://api.torbox.app/v1/api/integration/oauth/google';

function clean(value,max=700){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';}
function escapeQuery(value){return String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
async function jsonBody(response,max=1024*1024){
  if(response.status===204)return null;
  const reader=response.body?.getReader();if(!reader)throw new AppError('DRIVE_BAD_RESPONSE','Google Drive returned no response.',502);
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new AppError('DRIVE_BAD_RESPONSE','Google Drive returned too much data.',502);chunks.push(Buffer.from(value));}}
  finally{try{await reader.cancel();}catch{}}
  const text=Buffer.concat(chunks).toString('utf8');
  if(!text)return null;
  try{return JSON.parse(text);}catch{throw new AppError('DRIVE_BAD_RESPONSE','Google Drive returned unreadable data.',502);}
}
export function parseTorBoxGoogleSuccess(value,now=Date.now()){
  if(typeof value!=='string'||value.length>10000)throw new AppError('DRIVE_OAUTH_RESULT','Paste the Google Drive success-page address from TorBox.',400);
  let url;try{url=new URL(value.trim());}catch{throw new AppError('DRIVE_OAUTH_RESULT','Paste the full TorBox Google Drive success-page address.',400);}
  if(url.protocol!=='https:'||url.hostname!=='torbox.app'||url.pathname.replace(/\/$/,'')!=='/google/success')throw new AppError('DRIVE_OAUTH_RESULT','That is not the TorBox Google Drive success-page address.',400);
  const token=url.searchParams.get('token')||'';
  if(token.length<20||token.length>4096||/[\u0000-\u001f\u007f]/.test(token))throw new AppError('DRIVE_OAUTH_RESULT','The TorBox success page does not contain a usable Google token.',400);
  const rawExpires=Number(url.searchParams.get('expires_at'));
  const expiresIn=Number(url.searchParams.get('expires_in'));
  let expiresAt=Number.isFinite(rawExpires)&&rawExpires>0?(rawExpires<1e12?rawExpires*1000:rawExpires):0;
  if(!expiresAt&&Number.isFinite(expiresIn)&&expiresIn>0)expiresAt=now+expiresIn*1000;
  if(!expiresAt)expiresAt=now+50*60000;
  if(expiresAt<=now+5*60000)throw new AppError('DRIVE_OAUTH_EXPIRED','That Google authorization is already too close to expiring. Connect Google Drive again.',400);
  return {token,expiresAt};
}
export function extractDriveFileId(value){
  if(typeof value!=='string'||value.length>4000)return '';
  try{
    const url=new URL(value);
    if(!/(^|\.)drive\.google\.com$/.test(url.hostname)&&!/(^|\.)docs\.google\.com$/.test(url.hostname))return '';
    const path=/\/d\/([A-Za-z0-9_-]{10,200})/.exec(url.pathname)?.[1];
    const query=url.searchParams.get('id');
    return path||(/^[A-Za-z0-9_-]{10,200}$/.test(query||'')?query:'');
  }catch{return '';}
}
export function selectIntegrationJob(jobs,run){
  if(!Array.isArray(jobs))return null;
  const baseline=new Set(run.baselineJobIds||[]),type=TYPE_MAP[run.kind];
  const candidates=jobs.filter(job=>{
    if(!job||!Number.isFinite(Number(job.id))||baseline.has(String(job.id)))return false;
    const integration=String(job.integration||'').toLowerCase();if(integration&&!integration.includes('google'))return false;
    if(job.type&&String(job.type).toLowerCase()!==type)return false;
    if(job.file_id!=null&&Number(job.file_id)!==run.fileId)return false;
    const created=Date.parse(job.created_at||job.createdAt||'');if(Number.isFinite(created)&&created<run.startedAt-10000)return false;
    return true;
  });
  candidates.sort((a,b)=>Date.parse(b.created_at||b.createdAt||0)-Date.parse(a.created_at||a.createdAt||0)||Number(b.id)-Number(a.id));
  return candidates[0]||null;
}

export class GoogleDriveClient{
  constructor({fetchFn=fetch,timeoutMs=20000}={}){Object.assign(this,{fetchFn,timeoutMs});}
  async call(auth,path,{method='GET',body}={}){
    if(!auth?.token||auth.expiresAt<=Date.now()+30000)throw new AppError('DRIVE_AUTH_EXPIRED','Google Drive authorization expired. Connect Drive again.',401);
    let response;
    try{
      response=await this.fetchFn('https://www.googleapis.com/drive/v3/'+path,{
        method,headers:{Authorization:'Bearer '+auth.token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
        body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)
      });
    }catch(e){
      if(['AbortError','TimeoutError'].includes(e?.name))throw new AppError('DRIVE_TIMEOUT','Google Drive took too long to answer.',504);
      throw new AppError('DRIVE_UNAVAILABLE','The server could not reach Google Drive.',502);
    }
    if(response.status===401||response.status===403){try{await response.body?.cancel();}catch{};throw new AppError('DRIVE_AUTH_EXPIRED','Google Drive authorization expired or was revoked. Connect Drive again.',401);}
    if(response.status===404){try{await response.body?.cancel();}catch{};throw new AppError('DRIVE_FILE_MISSING','The temporary Drive file is no longer available.',404);}
    if(!response.ok){
      let detail='';try{detail=clean((await jsonBody(response))?.error?.message||'',220);}catch{}
      throw new AppError('DRIVE_OPERATION_FAILED',detail||'Google Drive could not complete this action.',502);
    }
    return jsonBody(response);
  }
  async validate(auth){await this.call(auth,'files?pageSize=1&fields=files(id,name)');return true;}
  async find(auth,name,afterMs){
    const after=new Date(Math.max(0,afterMs-60000)).toISOString();
    const q="name = '"+escapeQuery(name)+"' and trashed = false and createdTime >= '"+after+"'";
    const data=await this.call(auth,'files?q='+encodeURIComponent(q)+'&orderBy=createdTime%20desc&pageSize=10&fields=files(id,name,createdTime,webViewLink,videoMediaMetadata)');
    const file=Array.isArray(data?.files)?data.files[0]:null;
    return {fileId:file?.id||'',name:file?.name||''};
  }
  async publish(auth,fileId,{blockDownload=true}={}){
    if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))throw new AppError('DRIVE_FILE_ID','Google Drive returned an invalid file identifier.',502);
    await this.call(auth,'files/'+encodeURIComponent(fileId)+'/permissions?sendNotificationEmail=false&supportsAllDrives=true',{method:'POST',body:{type:'anyone',role:'reader',allowFileDiscovery:false}});
    let downloadRestricted=false;
    if(blockDownload){
      try{
        await this.call(auth,'files/'+encodeURIComponent(fileId)+'?supportsAllDrives=true&fields=id,downloadRestrictions',{method:'PATCH',body:{downloadRestrictions:{itemDownloadRestriction:{restrictedForReaders:true,restrictedForWriters:false}}}});
        downloadRestricted=true;
      }catch(error){
        if(error.code==='DRIVE_AUTH_EXPIRED')throw error;
        await this.call(auth,'files/'+encodeURIComponent(fileId)+'?supportsAllDrives=true&fields=id,copyRequiresWriterPermission',{method:'PATCH',body:{copyRequiresWriterPermission:true}});
        downloadRestricted=true;
      }
    }
    return {previewUrl:'https://drive.google.com/file/d/'+fileId+'/preview',viewUrl:'https://drive.google.com/file/d/'+fileId+'/view',downloadRestricted};
  }
  async inspect(auth,fileId){
    const data=await this.call(auth,'files/'+encodeURIComponent(fileId)+'?fields=id,name,mimeType,size,videoMediaMetadata,capabilities(canDownload)&supportsAllDrives=true');
    const meta=data?.videoMediaMetadata||{};
    return {name:data?.name||'',videoReady:!!(meta.durationMillis||meta.width||meta.height),canDownload:data?.capabilities?.canDownload};
  }
  async remove(auth,fileId){await this.call(auth,'files/'+encodeURIComponent(fileId)+'?supportsAllDrives=true',{method:'DELETE'});return {deleted:true};}
}

export class DriveTransferTests{
  constructor({drive=new GoogleDriveClient(),now=Date.now,setTimer=setTimeout}={}){Object.assign(this,{drive,now,setTimer});}
  oauthUrl(){return TORBOX_GOOGLE_OAUTH;}
  async configure(session,{successUrl}={}){
    if(session.guest)throw new AppError('GUEST_FORBIDDEN','Temporary guests cannot configure Drive sharing.',403);
    const auth=parseTorBoxGoogleSuccess(successUrl,this.now());
    await this.drive.validate(auth);
    session.driveAuth=auth;
    return {configured:true,expiresAt:new Date(auth.expiresAt).toISOString(),oauthUrl:TORBOX_GOOGLE_OAUTH};
  }
  configured(session){return !!session?.driveAuth&&session.driveAuth.expiresAt>this.now()+60000;}
  config(session){return {configured:this.configured(session),oauthUrl:TORBOX_GOOGLE_OAUTH,expiresAt:this.configured(session)?new Date(session.driveAuth.expiresAt).toISOString():undefined};}
  runs(session){if(!session.driveRuns)session.driveRuns=new Map();return session.driveRuns;}
  async start(session,provider,{videoId,deleteMinutes=10,blockDownload=true}={}){
    if(session.guest)throw new AppError('GUEST_FORBIDDEN','Temporary guests cannot start Drive sharing.',403);
    if(!this.configured(session))throw new AppError('DRIVE_AUTH_REQUIRED','Connect Google Drive first.',409);
    if(!Number.isFinite(deleteMinutes)||deleteMinutes<5||deleteMinutes>45)throw new AppError('DRIVE_DELETE_TIME','For the easy timing test, choose 5 to 45 minutes.',400);
    if(this.now()+deleteMinutes*60000+120000>=session.driveAuth.expiresAt)throw new AppError('DRIVE_AUTH_TOO_SHORT','This Google authorization will expire before the test cleanup. Connect Drive again.',409);
    const resolved=await provider.resolveFile(videoId);
    const before=await provider.integrationJobs();
    const baselineJobIds=(Array.isArray(before)?before:[]).map(x=>String(x?.id)).filter(Boolean);
    const startedAt=this.now();
    await provider.queueGoogleDrive(resolved,session.driveAuth.token);
    const id=randomUUID();
    const run={id,videoId,kind:resolved.kind,itemId:resolved.itemId,fileId:resolved.fileId,title:resolved.file.title,size:resolved.file.size,startedAt,deleteMinutes,blockDownload:!!blockDownload,baselineJobIds,driveFileId:'',published:false,deleted:false,readyAt:0,playbackReadyAt:0,deleteAt:0,auth:{...session.driveAuth},deleteError:''};
    this.runs(session).set(id,run);
    if(this.runs(session).size>20)this.runs(session).delete(this.runs(session).keys().next().value);
    return this.publicRun(run,{status:'queued',progress:0});
  }
  publicRun(run,extra={}){
    return {id:run.id,title:run.title,size:run.size,startedAt:new Date(run.startedAt).toISOString(),elapsedMs:Math.max(0,this.now()-run.startedAt),deleteMinutes:run.deleteMinutes,blockDownload:run.blockDownload,driveFileId:run.driveFileId||undefined,readyAt:run.readyAt?new Date(run.readyAt).toISOString():undefined,playbackReadyAt:run.playbackReadyAt?new Date(run.playbackReadyAt).toISOString():undefined,deleteAt:run.deleteAt?new Date(run.deleteAt).toISOString():undefined,deleted:run.deleted,deleteError:run.deleteError||undefined,...extra};
  }
  scheduleDelete(run){
    if(!run.deleteAt||run.deleted)return;
    clearTimeout(run.deleteTimer);
    const wait=Math.max(0,run.deleteAt-this.now());
    run.deleteTimer=this.setTimer(async()=>{
      try{await this.drive.remove(run.auth,run.driveFileId);run.deleted=true;run.deleteError='';}
      catch(e){
        run.deleteError=e.message;
        if(run.auth.expiresAt>this.now()+90000){run.deleteAt=this.now()+60000;this.scheduleDelete(run);}
      }
    },wait);
    run.deleteTimer?.unref?.();
  }
  async status(session,provider,id){
    const run=this.runs(session).get(id);
    if(!run)throw new AppError('DRIVE_TEST_NOT_FOUND','That Drive transfer test is no longer available.',404);
    if(run.deleted)return this.publicRun(run,{status:'deleted',progress:1});
    if(run.deleteAt&&this.now()>=run.deleteAt&&run.driveFileId){
      try{await this.drive.remove(run.auth,run.driveFileId);run.deleted=true;return this.publicRun(run,{status:'deleted',progress:1});}
      catch(e){run.deleteError=e.message;}
    }
    const jobs=await provider.integrationJobs();
    const job=selectIntegrationJob(jobs,run);
    if(!job)return this.publicRun(run,{status:'queued',progress:0,detail:'Waiting for TorBox to register the Google Drive upload job.'});
    const status=String(job.status||'pending').toLowerCase();
    const progress=Number.isFinite(Number(job.progress))?Math.min(1,Math.max(0,Number(job.progress))):status==='completed'?1:0;
    if(status==='failed')return this.publicRun(run,{status:'failed',progress,detail:clean(job.detail)||'TorBox reported that the Drive upload failed.'});
    if(status!=='completed')return this.publicRun(run,{status,progress,detail:clean(job.detail)});
    if(!run.readyAt)run.readyAt=this.now();
    if(!run.driveFileId)run.driveFileId=extractDriveFileId(job.download_url||job.downloadUrl||'');
    if(!run.driveFileId){
      const found=await this.drive.find(run.auth,run.title,run.startedAt);
      if(found.fileId)run.driveFileId=String(found.fileId);
    }
    if(!run.driveFileId)return this.publicRun(run,{status:'drive_locating',progress:1,detail:'Upload completed. Waiting for the new file to appear in Google Drive.'});
    if(!run.published){
      const shared=await this.drive.publish(run.auth,run.driveFileId,{blockDownload:run.blockDownload});
      run.published=true;run.previewUrl=shared.previewUrl;run.viewUrl=shared.viewUrl||shared.previewUrl;run.downloadRestricted=shared.downloadRestricted===true;
      run.deleteAt=this.now()+run.deleteMinutes*60000;this.scheduleDelete(run);
    }
    const inspected=await this.drive.inspect(run.auth,run.driveFileId);
    if(inspected.videoReady&&!run.playbackReadyAt)run.playbackReadyAt=this.now();
    return this.publicRun(run,{status:inspected.videoReady?'ready':'drive_processing',progress:1,previewUrl:run.previewUrl,viewUrl:run.viewUrl,downloadRestricted:run.downloadRestricted===true,uploadMs:run.readyAt-run.startedAt,playbackMs:run.playbackReadyAt?run.playbackReadyAt-run.startedAt:null,driveName:inspected.name||run.title});
  }
  async remove(session,id){
    const run=this.runs(session).get(id);
    if(!run)throw new AppError('DRIVE_TEST_NOT_FOUND','That Drive transfer test is no longer available.',404);
    clearTimeout(run.deleteTimer);
    if(run.driveFileId&&!run.deleted)await this.drive.remove(run.auth,run.driveFileId);
    run.deleted=true;run.deleteError='';
    return this.publicRun(run,{status:'deleted',progress:1});
  }
}

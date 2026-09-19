import { randomUUID } from 'node:crypto';
import { AppError } from './torbox.mjs';

const BRIDGE_PATTERN=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
const TYPE_MAP=Object.freeze({torrents:'torrent',usenet:'usenet',webdl:'webdownload'});

async function readJson(response,max=1024*1024){
  const reader=response.body?.getReader();
  if(!reader) throw new AppError('DRIVE_BRIDGE_BAD_RESPONSE','The Drive bridge returned no response.',502);
  const chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>max)throw new AppError('DRIVE_BRIDGE_BAD_RESPONSE','The Drive bridge returned too much data.',502);
      chunks.push(Buffer.from(value));
    }
  }finally{try{await reader.cancel();}catch{}}
  const text=Buffer.concat(chunks).toString('utf8');
  try{return JSON.parse(text);}catch{throw new AppError('DRIVE_BRIDGE_BAD_RESPONSE','The Drive bridge returned unreadable data.',502);}
}
function cleanName(value){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,700):'';}
export function validBridgeUrl(value){
  if(typeof value!=='string')return false;
  try{const u=new URL(value.trim());return BRIDGE_PATTERN.test(u.href.replace(/\/$/,''));}catch{return false;}
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
  const baseline=new Set(run.baselineJobIds||[]);
  const type=TYPE_MAP[run.kind];
  const candidates=jobs.filter(job=>{
    if(!job||!Number.isFinite(Number(job.id)))return false;
    if(baseline.has(String(job.id)))return false;
    const integration=String(job.integration||'').toLowerCase();
    if(integration&&!integration.includes('google'))return false;
    if(job.type&&String(job.type).toLowerCase()!==type)return false;
    if(job.file_id!=null&&Number(job.file_id)!==run.fileId)return false;
    const created=Date.parse(job.created_at||job.createdAt||'');
    if(Number.isFinite(created)&&created<run.startedAt-10000)return false;
    return true;
  });
  candidates.sort((a,b)=>Date.parse(b.created_at||b.createdAt||0)-Date.parse(a.created_at||a.createdAt||0)||Number(b.id)-Number(a.id));
  return candidates[0]||null;
}
export class DriveBridgeClient{
  constructor({fetchFn=fetch,timeoutMs=20000}={}){Object.assign(this,{fetchFn,timeoutMs});}
  normalize(config){
    const url=typeof config?.url==='string'?config.url.trim().replace(/\/$/,''):'';
    const secret=typeof config?.secret==='string'?config.secret.trim():'';
    if(!validBridgeUrl(url))throw new AppError('DRIVE_BRIDGE_URL','Paste a valid Google Apps Script web-app /exec URL.',400);
    if(secret.length<24||secret.length>256||/[\u0000-\u001f\u007f]/.test(secret))throw new AppError('DRIVE_BRIDGE_SECRET','Use a Drive bridge secret between 24 and 256 characters.',400);
    return {url,secret};
  }
  async call(config,action,data={}){
    const {url,secret}=this.normalize(config);
    let response;
    try{
      response=await this.fetchFn(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8','Accept':'application/json'},body:JSON.stringify({secret,action,...data}),redirect:'follow',signal:AbortSignal.timeout(this.timeoutMs)});
    }catch(e){
      if(['AbortError','TimeoutError'].includes(e?.name))throw new AppError('DRIVE_BRIDGE_TIMEOUT','The Drive bridge took too long to answer.',504);
      throw new AppError('DRIVE_BRIDGE_UNAVAILABLE','The server could not reach the Drive bridge.',502);
    }
    if(!response.ok)throw new AppError('DRIVE_BRIDGE_UNAVAILABLE','The Drive bridge returned HTTP '+response.status+'.',502);
    const result=await readJson(response);
    if(!result?.ok)throw new AppError('DRIVE_BRIDGE_FAILED',cleanName(result?.error)||'The Drive bridge could not complete this request.',502);
    return result;
  }
  ping(config){return this.call(config,'ping');}
  async token(config){
    const result=await this.call(config,'token');
    if(typeof result.token!=='string'||result.token.length<20||result.token.length>4096)throw new AppError('DRIVE_BRIDGE_TOKEN','The Drive bridge did not return a usable Google token.',502);
    return result.token;
  }
  find(config,name,afterMs){return this.call(config,'find',{name:cleanName(name),afterMs});}
  publish(config,fileId,deleteAt,{blockDownload=true}={}){return this.call(config,'publish',{fileId,deleteAt,blockDownload});}
  inspect(config,fileId){return this.call(config,'inspect',{fileId});}
  remove(config,fileId){return this.call(config,'delete',{fileId});}
}

export class DriveTransferTests{
  constructor({bridge=new DriveBridgeClient(),now=Date.now}={}){Object.assign(this,{bridge,now});}
  async configure(session,input){
    if(session.guest)throw new AppError('GUEST_FORBIDDEN','Temporary guests cannot configure Drive sharing.',403);
    const config=this.bridge.normalize(input);
    const ping=await this.bridge.ping(config);
    session.driveBridge=config;
    return {configured:true,bridge:ping.bridge||'Google Apps Script',driveScope:ping.driveScope||'drive.file'};
  }
  configured(session){return !!session?.driveBridge;}
  runs(session){if(!session.driveRuns)session.driveRuns=new Map();return session.driveRuns;}
  async start(session,provider,{videoId,deleteMinutes=10,blockDownload=true}={}){
    if(session.guest)throw new AppError('GUEST_FORBIDDEN','Temporary guests cannot start Drive sharing.',403);
    if(!session.driveBridge)throw new AppError('DRIVE_BRIDGE_REQUIRED','Connect the Drive bridge first.',409);
    if(!Number.isFinite(deleteMinutes)||deleteMinutes<5||deleteMinutes>24*60)throw new AppError('DRIVE_DELETE_TIME','Choose a deletion time from 5 minutes through 24 hours.',400);
    const resolved=await provider.resolveFile(videoId);
    const googleToken=await this.bridge.token(session.driveBridge);
    const before=await provider.integrationJobs();
    const baselineJobIds=(Array.isArray(before)?before:[]).map(x=>String(x?.id)).filter(Boolean);
    const startedAt=this.now();
    await provider.queueGoogleDrive(resolved,googleToken);
    const id=randomUUID();
    const run={id,videoId,kind:resolved.kind,itemId:resolved.itemId,fileId:resolved.fileId,title:resolved.file.title,size:resolved.file.size,startedAt,deleteMinutes,blockDownload:!!blockDownload,baselineJobIds,driveFileId:'',published:false,deleted:false,readyAt:0,playbackReadyAt:0,deleteAt:0};
    this.runs(session).set(id,run);
    if(this.runs(session).size>20)this.runs(session).delete(this.runs(session).keys().next().value);
    return this.publicRun(run,{status:'queued',progress:0});
  }
  publicRun(run,extra={}){
    return {id:run.id,title:run.title,size:run.size,startedAt:new Date(run.startedAt).toISOString(),elapsedMs:Math.max(0,this.now()-run.startedAt),deleteMinutes:run.deleteMinutes,blockDownload:run.blockDownload,driveFileId:run.driveFileId||undefined,readyAt:run.readyAt?new Date(run.readyAt).toISOString():undefined,playbackReadyAt:run.playbackReadyAt?new Date(run.playbackReadyAt).toISOString():undefined,deleteAt:run.deleteAt?new Date(run.deleteAt).toISOString():undefined,deleted:run.deleted,...extra};
  }
  async status(session,provider,id){
    const run=this.runs(session).get(id);
    if(!run)throw new AppError('DRIVE_TEST_NOT_FOUND','That Drive transfer test is no longer available.',404);
    if(run.deleted)return this.publicRun(run,{status:'deleted',progress:1});
    const jobs=await provider.integrationJobs();
    const job=selectIntegrationJob(jobs,run);
    if(!job)return this.publicRun(run,{status:'queued',progress:0,detail:'Waiting for TorBox to register the Google Drive upload job.'});
    const status=String(job.status||'pending').toLowerCase();
    const progress=Number.isFinite(Number(job.progress))?Math.min(1,Math.max(0,Number(job.progress))):status==='completed'?1:0;
    if(status==='failed')return this.publicRun(run,{status:'failed',progress,detail:cleanName(job.detail)||'TorBox reported that the Drive upload failed.'});
    if(status!=='completed')return this.publicRun(run,{status,progress,detail:cleanName(job.detail)});

    if(!run.readyAt)run.readyAt=this.now();
    if(!run.driveFileId)run.driveFileId=extractDriveFileId(job.download_url||job.downloadUrl||'');
    if(!run.driveFileId){
      const found=await this.bridge.find(session.driveBridge,run.title,run.startedAt);
      if(found.fileId)run.driveFileId=String(found.fileId);
    }
    if(!run.driveFileId)return this.publicRun(run,{status:'drive_locating',progress:1,detail:'Upload completed. Waiting for the new file to appear in Google Drive.'});

    if(!run.published){
      run.deleteAt=this.now()+run.deleteMinutes*60000;
      const shared=await this.bridge.publish(session.driveBridge,run.driveFileId,run.deleteAt,{blockDownload:run.blockDownload});
      run.published=true;
      run.previewUrl=shared.previewUrl;
      run.viewUrl=shared.viewUrl||shared.previewUrl;
      run.downloadRestricted=shared.downloadRestricted===true;
    }
    const inspected=await this.bridge.inspect(session.driveBridge,run.driveFileId);
    if(inspected.videoReady&&!run.playbackReadyAt)run.playbackReadyAt=this.now();
    return this.publicRun(run,{status:inspected.videoReady?'ready':'drive_processing',progress:1,previewUrl:run.previewUrl,viewUrl:run.viewUrl,downloadRestricted:run.downloadRestricted===true,uploadMs:run.readyAt-run.startedAt,playbackMs:run.playbackReadyAt?run.playbackReadyAt-run.startedAt:null,driveName:inspected.name||run.title});
  }
  async remove(session,id){
    const run=this.runs(session).get(id);
    if(!run)throw new AppError('DRIVE_TEST_NOT_FOUND','That Drive transfer test is no longer available.',404);
    if(run.driveFileId&&!run.deleted)await this.bridge.remove(session.driveBridge,run.driveFileId);
    run.deleted=true;
    return this.publicRun(run,{status:'deleted',progress:1});
  }
}

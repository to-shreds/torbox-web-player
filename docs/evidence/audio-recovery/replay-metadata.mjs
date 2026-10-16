// Offline replay of sanitized provider metadata. No real media or account access.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as currentLookup from '../../../lib/source-lookup.mjs';
import * as currentSelection from '../../../public/discover.js';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const baseline='34460c5a7434728873b66d6fa8ffb7a6ea5a7c62';
const fixturePath='test/fixtures/dexter-resurrection-s01e02-streams.json';
const fixtureBytes=await readFile(join(root,fixturePath)),raw=JSON.parse(fixtureBytes);
const snapshot=await mkdtemp(join(tmpdir(),'torbox-audio-baseline-'));
globalThis.fetch=()=>{throw new Error('Offline replay must not use the network');};
const project=row=>({filename:row.filename,languages:row.languages,audioCodecs:row.audioCodecs,audioRisk:row.audioRisk,videoRisk:row.videoRisk});
const positive=row=>!row.audioRisk&&(row.audioCodecs||[]).some(codec=>['AAC','MP3','Opus'].includes(codec));
const summarize=rows=>({count:rows.length,compatibleAudioAttested:rows.filter(positive).length,compatibleAudioAndVideoAttested:rows.filter(row=>positive(row)&&!row.videoRisk).length,unknownAudio:rows.filter(row=>!row.audioRisk&&!positive(row)).length,knownAudioOrVideoRisk:rows.filter(row=>row.audioRisk||row.videoRisk).length});
function replay(lookup,selection){
  const beforeCap=raw.streams.flatMap(stream=>lookup.normalizeStremioStreams({streams:[stream]},raw.target,raw.provider));
  const capped=lookup.normalizeStremioStreams(raw,raw.target,raw.provider);
  const mockedCache=capped.map(row=>({...row,cached:true,cachedBrowserPlayable:true}));
  const automatic=selection.automaticCachedSourceOrder(mockedCache,'series','auto','balanced');
  return {beforeCap:summarize(beforeCap),afterCap:summarize(capped),automatic:summarize(automatic),firstEightAutomatic:automatic.slice(0,8).map(project),preparationChoices:selection.browserPreparationOptions(mockedCache,'series','auto','balanced',3).map(project)};
}
try{
  await mkdir(join(snapshot,'public'));await mkdir(join(snapshot,'lib'));
  await writeFile(join(snapshot,'package.json'),' {"type":"module"}');
  for(const path of ['lib/source-lookup.mjs',...['discover','source-client','runtime','playback-lifecycle','settings','history','watchlist','search-history','source-memory'].map(name=>'public/'+name+'.js')]){
    await writeFile(join(snapshot,path),execFileSync('git',['show',baseline+':'+path],{cwd:root}));
  }
  const beforeLookup=await import(pathToFileURL(join(snapshot,'lib/source-lookup.mjs')));
  const beforeSelection=await import(pathToFileURL(join(snapshot,'public/discover.js')));
  const report={recordedAt:new Date().toISOString(),baseline,networkRequests:0,actualMediaDownloads:0,accountAccess:false,target:raw.target,fixture:fixturePath,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),
    cacheAssumption:'All metadata rows are marked cached only to compare selection order. This does not attest real TorBox availability.',
    before:replay(beforeLookup,beforeSelection),after:replay(currentLookup,currentSelection),
    limits:'Codec names are metadata evidence, not decoded sound. Selected AAC MP4 language remains unconfirmed. User account and physical Android episode playback remain unverified.'};
  await writeFile(new URL('./metadata-replay.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({before:report.before.automatic,after:report.after.automatic,firstBefore:report.before.firstEightAutomatic[0],firstAfter:report.after.firstEightAutomatic[0]},null,2));
}finally{await rm(snapshot,{recursive:true,force:true});}

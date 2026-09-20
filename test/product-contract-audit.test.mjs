import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('2.x product contract: core shell, discovery, and automatic playback remain present',async()=>{
  const [html,discover]=await Promise.all([read('../public/index.html'),read('../public/discover.js')]);
  for(const id of ['viewer','open-settings','logout','search','catalog-type','catalog-feed','catalog-genre','catalog-grid','title-dialog','source-dialog']) assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(html.includes('<body class="mode-simple">'));
  assert.ok(discover.includes("const playButton=button('Play',()=>quickPlay"));
  assert.ok(discover.includes("const more=button('Options',()=>openOptions"));
  assert.doesNotMatch(discover,/no_confirmed_audio[\s\S]{0,300}openOptions\(/);
  assert.ok(!html.includes('id="library-panel"'));
});

test('2.x product contract: browse/search and Cinemeta resilience remain wired',async()=>{
  const [discover,direct]=await Promise.all([read('../public/discover.js'),read('../public/direct-runtime.js')]);
  assert.ok(discover.includes("type:query?'all':$('catalog-type').value"));
  assert.ok(discover.includes("genre:query?'':$('catalog-genre').value"));
  for(const marker of ['CATALOG_PRIMARY','CATALOG_SECONDARY','CATALOG_LIVE','catalogBridgeRequest','catalogMetaFlexible']) assert.ok(direct.includes(marker),marker);
  assert.ok(direct.includes("catalogAvailable=architecture.catalogDirect||architecture.catalogBridge"));
});

test('2.x product contract: Continue Watching remains editable and resumable without Clear All',async()=>{
  const [app,history,settings]=await Promise.all([read('../public/app.js'),read('../public/history.js'),read('../public/settings.js')]);
  assert.ok(app.includes('removeRecent'));
  assert.ok(app.includes('confirm('));
  assert.ok(!app.includes('clearRecent'));
  assert.ok(history.includes('removeRecent'));
  assert.ok(settings.includes('resumeRewindSeconds:10'));
  assert.ok(app.includes('rewindOnResumeSeconds'));
});

test('2.x product contract: My List, Next Up, search history, long press, and per-title quality remain',async()=>{
  const [html,discover]=await Promise.all([read('../public/index.html'),read('../public/discover.js')]);
  for(const id of ['watchlist-section','next-up-section','search-history-section','quick-actions-dialog']) assert.ok(html.includes('id="'+id+'"'),id);
  for(const marker of ['renderWatchlist','renderNextUp','renderSearchHistory','openQuickActions','getTitleQuality','setTitleQuality']) assert.ok(discover.includes(marker),marker);
  assert.ok(discover.includes("setTimeout(()=>{longPressed=true;openQuickActions(meta);},550)"));
});

test('2.x product contract: playback UX and safety controls remain',async()=>{
  const [html,app,settings]=await Promise.all([read('../public/index.html'),read('../public/app.js'),read('../public/settings.js')]);
  for(const id of ['pause-card','still-watching-card','playback-health','up-next-card']) assert.ok(html.includes('id="'+id+'"'),id);
  for(const marker of ['updatePauseCard','armSleepTimer','armStillWatchingTimer','acquireWakeLock','keyboardShortcuts','seekSeconds','webkitAudioDecodedByteCount']) assert.ok(app.includes(marker),marker);
  assert.ok(settings.includes('stillWatchingMinutes:90'));
  assert.ok(settings.includes('pauseOverlay:true'));
});

test('2.x product contract: automatic source ranking, audio learning, fan-in, auto-next, and recovery remain',async()=>{
  const [discover,direct,memory]=await Promise.all([read('../public/discover.js'),read('../public/direct-runtime.js'),read('../public/source-memory.js')]);
  for(const marker of ['recommendAutomaticSource','browserFriendly','audioRisk','autoNextSourceOrder','recoverPlayback','lowerResolutionOrder','automaticPreparedFile']) assert.ok(discover.includes(marker),marker);
  for(const marker of ['sourceFanInKey','sourceFanInRank','SOURCE_CACHE_MS = 90000','StremThru Main','StremThru ElfHosted','MediaFusion Torznab']) assert.ok(direct.includes(marker),marker);
  for(const marker of ['rememberSourceSuccess','setAudioFeedback','setSourceBad']) assert.ok(memory.includes(marker),marker);
});

test('2.x product contract: Render control plane, bridge fallback code, and direct CDN playback remain',async()=>{
  const [html,app,direct,runtime]=await Promise.all([read('../public/index.html'),read('../public/app.js'),read('../public/direct-runtime.js'),read('../public/runtime.js')]);
  assert.ok(html.includes('id="torbox-status-banner"'));
  assert.ok(html.includes('name="runtime-mode" content="backend"'));
  assert.ok(html.includes('name="api-origin" content="https://torbox-web-player-key.onrender.com"'));
  assert.ok(app.includes('Never block Play on a separate probe'));
  assert.ok(app.includes('driveTest: null'));
  assert.ok(app.includes('validateCredentialForImport'));
  assert.ok(direct.includes('DEFAULT_RELAY_PRIMARY'));
  assert.ok(direct.includes('DEFAULT_RELAY_SECONDARY'));
  assert.ok(direct.includes("torrents/requestdl"));
  assert.ok(runtime.includes('TORBOX_MEDIA_SUFFIXES'));
  assert.ok(!app.includes('/media/'));
});

test('2.x product contract: Settings, Kid Mode, and Parent PIN controls remain',async()=>{
  const [html,app,parental]=await Promise.all([read('../public/index.html'),read('../public/app.js'),read('../public/parental-controls.js')]);
  for(const id of ['settings-dialog','setting-interface-mode','setting-resolution','setting-size-profile','setting-rewind','setting-auto-next','setting-kid-mode','parent-pin-change','kid-limit-dialog']) assert.ok(html.includes('id="'+id+'"'),id);
  for(const marker of ['requestParentPin','consumeKidPlayback','grantKidExtension','resetKidAllowance']) assert.ok(app.includes(marker),marker);
  assert.ok(parental.includes('PIN_ITERATIONS'));
  assert.ok(parental.includes('timeLimitMinutes'));
  assert.ok(parental.includes('episodeLimit'));
  assert.ok(parental.includes('movieLimit'));
});

test('2.x product contract: backendless setup transfer scope and local QR/file flows remain',async()=>{
  const [html,portable,ui]=await Promise.all([read('../public/index.html'),read('../public/portable-setup.js'),read('../public/portable-setup-ui.js')]);
  for(const id of ['portable-open-send','portable-open-receive','portable-password','portable-export-file','portable-scan','portable-camera','portable-import-confirm']) assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(portable.includes("PORTABLE_KEYS = Object.freeze(['torbox-settings-v1','torbox-recent-v1','torbox-watchlist-v1'])"));
  assert.ok(portable.includes("PBKDF2"));
  assert.ok(portable.includes("AES-GCM"));
  assert.ok(ui.includes('SetupFrameCollector'));
  assert.ok(ui.includes('getUserMedia'));
});

test('2.x product contract: PWA, diagnostics, repair, and intentional exclusions remain',async()=>{
  const [html,app,sw]=await Promise.all([read('../public/index.html'),read('../public/app.js'),read('../public/sw.js')]);
  for(const id of ['settings-install-app','settings-run-diagnostics','diagnostics-dialog']) assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(app.includes('runDirectDiagnostics'));
  assert.ok(app.includes('version.json?check='));
  assert.ok(sw.includes("k.startsWith('torbox-main-v')")||sw.includes("startsWith('torbox-main-v')"));
  assert.ok(!html.includes('Replay last 30'));
  assert.ok(!html.includes('Recommended because:'));
});

test('2.1 settings contract: Basic first, advanced tabs, optional user names, and basic tooltips remain',async()=>{
  const [html,app,settings]=await Promise.all([read('../public/index.html'),read('../public/app.js'),read('../public/settings.js')]);
  assert.ok(html.indexOf('data-settings-tab="basic"')<html.indexOf('data-settings-tab="playback"'));
  for(const tab of ['basic','playback','home','discover','kids','devices'])assert.ok(html.includes('data-settings-tab="'+tab+'"'),tab);
  for(const id of ['setting-viewer-1-name','setting-viewer-2-name','setting-remember-viewer','setting-home-density','setting-search-delay','setting-prefer-cached'])assert.ok(html.includes('id="'+id+'"'),id);
  const basic=html.slice(html.indexOf('id="settings-panel-basic"'),html.indexOf('id="settings-panel-playback"'));
  assert.equal((basic.match(/class="setting-tip"/g)||[]).length,(basic.match(/class="basic-setting(?: |")/g)||[]).length,'every Basic setting needs a tooltip');
  assert.ok(app.includes("activateSettingsTab('basic')"));assert.ok(settings.includes("viewer1Name:''"));assert.ok(settings.includes('searchDelayMs:350'));assert.ok(settings.includes('preferCachedSources:true'));
});

test('2.2 protection contract: exact-variant learning, local recovery, and release gates remain',async()=>{
  const [memory,snapshots,app,html,pages,rollback]=await Promise.all([
    read('../public/source-memory.js'),read('../public/state-snapshots.js'),read('../public/app.js'),read('../public/index.html'),read('../.github/workflows/pages.yml'),read('../.github/workflows/rollback.yml')
  ]);
  assert.ok(memory.includes("['v2',i.hash"));
  assert.ok(memory.includes("fileIdx=Number.isSafeInteger(source.fileIdx)"));
  assert.ok(snapshots.includes("MAX_SNAPSHOTS=3"));
  assert.ok(snapshots.includes("'torbox-parental-controls-v1'"));
  assert.ok(!snapshots.includes("'torbox-api-key'"));
  assert.ok(app.includes("captureStateSnapshot('Before setup import'"));
  for(const id of ['state-snapshot-now','state-restore-open','state-restore-dialog'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(pages.includes('release-approved'));
  assert.ok(rollback.includes("default: 'rollback-stable'"));
});

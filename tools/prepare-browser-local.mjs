import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8'),write=(p,s)=>{fs.mkdirSync(p.slice(0,p.lastIndexOf('/'))||'.',{recursive:true});fs.writeFileSync(p,s);};
if(fs.existsSync('tools/.browser-local-prepared')){console.log('Source already prepared.');process.exit(0);}
function once(s,a,b){if(!s.includes(a))throw new Error('Missing migration anchor: '+a.slice(0,100));return s.replace(a,b);}
let app=read('public/app.js');
app=once(app,"import { directApi, runDirectDiagnostics, diagnosticText } from './direct-runtime.js';","import { directApi, runDirectDiagnostics, diagnosticText, exportActiveCredential, validateImportedCredential } from './direct-runtime.js';");
app=once(app,"import { createEncryptedTransfer, decryptEncryptedTransfer, applyTransferredState, transferLookup, transferCodeFromHash, buildTransferLink } from './device-transfer.js';","import { installPortableSetupUI } from './portable-setup-ui.js';\nimport { stagedPortableState, writePortableState, restorePortableState, hydratePortableMetadata } from './portable-setup.js';");
app=app.replace("let activeSetupTransferLink='';\n",'');
const start=app.indexOf('function clearSetupTransferHash()'),end=app.indexOf('async function bootstrap()',start);if(start<0||end<0)throw new Error('Transfer function bounds missing');app=app.slice(0,start)+app.slice(end);
app=app.split('\n').filter(line=>!line.includes('const transferCode=transferCodeFromHash()')&&!line.includes('if(transferCode&&!guestMode)')&&!line.startsWith("$('transfer-")&&!line.includes("$('transfer-share').hidden=")).join('\n');
app=app.replace("updateInstallButton();text('settings-message','');text('transfer-message','');","updateInstallButton();text('settings-message','');");
app=once(app,"leaveGuestUi(); await checkTorBoxStatus(true); renderRecent(); await discoveryUI.activate();","leaveGuestUi(); await checkTorBoxStatus(true); renderRecent(); await discoveryUI.activate(); refreshPortableMetadata();");
app=app.replace("'All tested core endpoints were readable directly by this browser.'","'Catalog/source checks and bridge health passed. Playback is verified separately.'");
app=once(app,"if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));\nbootstrap();",`let portableHydration=null;
function refreshPortableMetadata(){
  if(portableHydration)return;
  portableHydration=hydratePortableMetadata(async(type,id)=>(await api('/api/discover/meta?'+new URLSearchParams({type,id}))).meta,localStorage,()=>{renderRecent();discoveryUI?.settingsChanged();}).catch(()=>{}).finally(()=>{portableHydration=null;});
}
installPortableSetupUI({
  getCredential:exportActiveCredential,
  authorize:action=>{if(hasParentPin())requestParentPin('Enter this device’s Parent PIN to transfer or replace its setup.',action);else action();},
  importSetup:async value=>{
    const staged=stagedPortableState(value);await validateImportedCredential(value[2]);
    await stopPlayback();if($('player').open)$('player').close();
    const priorKey=await loadRememberedApiKey();let before=null,vaultChanged=false;
    try{
      if(!(await rememberApiKey(value[2])))throw new Error('This browser cannot securely remember the imported key.');vaultChanged=true;
      before=writePortableState(staged);
      await connectWithKey(value[2],false);
    }catch(error){
      if(before)restorePortableState(before);
      if(vaultChanged){if(priorKey)await rememberApiKey(priorKey);else await forgetApiKey();}
      throw error;
    }
    // Viewer and all parent controls deliberately remain destination-local.
    try{sessionStorage.removeItem('tw-source-resolution');}catch{}
    torboxStatusCache=null;autoLoginTried=false;
  },
  refresh:async()=>{if($('settings-dialog').open)$('settings-dialog').close();applyInterfaceMode();await bootstrap();}
});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
bootstrap();`);
write('public/app.js',app);

let runtime=read('public/direct-runtime.js');
runtime=once(runtime,"export const DIRECT_BUILD = 'browser-direct-0.4';","export const DIRECT_BUILD = 'browser-local-2.0.0';");
runtime=once(runtime,"const url = new URL('/stream/' + target.type + '/' + resourceId + '.json', origin);","const url = new URL(origin.replace(/\\/+$/, '') + '/stream/' + target.type + '/' + resourceId + '.json');");
runtime=once(runtime,"timeoutMs=2000,label='torbox_bridge'}={}){\n  const key=requireKey()","timeoutMs=2000,label='torbox_bridge',apiKey}={}){\n  const key=apiKey||requireKey()");
// Give a write and the backup enough time to complete. The two-second limit is
// a primary-read failover threshold, not a limit on every TorBox operation.
runtime=once(runtime,"const result=await bridgeOne(order[i],route,options);","const result=await bridgeOne(order[i],route,{...options,timeoutMs:options.timeoutMs??(mutation?25000:order[i]===cfg.primary?2000:15000)});");
runtime=once(runtime,"if(!bridgeRetryable(result.response.status)||i===order.length-1)return result;","if(!bridgeRetryable(result.response.status)||i===order.length-1||(result.response.status===429&&result.response.headers.get('x-torbox-bridge')))return result;");
runtime+=`\n// Used only after a local import confirmation. Validation does not replace the
// active credential or put any transfer payload on a server.
export function exportActiveCredential(){return credential;}
export async function validateImportedCredential(apiKey){
  if(typeof apiKey!=='string'||apiKey.length<8||apiKey.length>512||/[\\u0000-\\u001f\\u007f]/.test(apiKey))throw directError('BAD_API_KEY','The imported key is invalid.',400);
  const {response}=await bridgeRequest('user/me',{params:{settings:false},apiKey,label:'torbox_import_validate'});
  if(!response.ok)throw directError('IMPORT_KEY_REJECTED','Could not validate the imported TorBox connection. Your existing setup has not changed.',response.status);
  const payload=await readJson(response,1024*1024);
  if(payload?.success!==true||!payload.data||typeof payload.data!=='object')throw directError('IMPORT_KEY_REJECTED','TorBox did not confirm the imported connection.',401);
  return true;
}
`;
write('public/direct-runtime.js',runtime);

let html=read('public/index.html');
html=html.replace('<span class="tag">DIRECT LAB</span>','<span class="tag">2.0</span>');
html=html.replace('Experimental browser-local build.','Browser-local player.');
html=html.replace('https://*.workers.dev','https://torbox-web-player-relay.jonathanjablon.workers.dev');
html=once(html,'<meta name="runtime-mode" content="direct">','<meta name="runtime-mode" content="direct"><meta name="referrer" content="no-referrer">');
html=once(html,'<link rel="stylesheet" href="./discover.css">','<link rel="stylesheet" href="./discover.css"><link rel="stylesheet" href="./portable-setup.css">');
html=once(html,'<p id="login-message" role="status"></p>','<button id="portable-login-receive" class="text-button" type="button">Receive existing setup</button><p id="login-message" role="status"></p>');
html=html.replace(/<fieldset id="sync-settings-group"[\s\S]*?<\/fieldset>/,`<fieldset id="portable-settings-group" class="settings-group"><legend>Sync &amp; devices</legend>
<p class="setting-help">Copy your API key, ordinary settings, Continue Watching, and My List directly to another device. Parent PINs, Kid Mode, allowances, searches, and source learning stay on each device. This is a copy, not ongoing sync.</p>
<div class="setting-inline-actions"><button id="portable-open-send" type="button">Transfer this setup</button><button id="portable-open-receive" type="button">Receive setup</button></div>
<p class="setting-help">Save any changed settings before creating a transfer.</p></fieldset>`);
// Restore useful app controls accidentally hidden with the Drive experiment.
const actions=/<div class="setting-inline-actions"><button id="settings-install-app"[\s\S]*?<\/div>/;const matched=html.match(actions);if(!matched)throw new Error('App controls not found');html=html.replace(actions,'');
html=once(html,'<fieldset class="settings-group direct-only"><legend>Browser-only Test Lab</legend>',`<fieldset class="settings-group"><legend>App and maintenance</legend>${matched[0]}</fieldset><fieldset class="settings-group direct-only"><legend>Connection diagnostics</legend>`);
html=html.replace('<footer>Browser-local experiment · Direct source APIs · Redundant TorBox bridge · Direct TorBox video</footer>','<footer>Browser-local player 2.0 · Your own TorBox account · <a href="./key/">Previous player</a></footer>');
const dialog=`<dialog id="portable-dialog" class="portable-dialog"><div class="dialog-bar"><h2 id="portable-title">Transfer setup</h2><button id="portable-close" type="button" class="icon-button" aria-label="Close setup transfer">×</button></div>
<section id="portable-send" hidden>
<p>Only the API key, ordinary settings, Continue Watching, and My List are copied. Titles and posters are recovered from their catalog IDs on the receiving device.</p>
<p class="portable-warning">This QR, link, or file grants access to your TorBox account. Anyone who captures it can use it unless you add a transfer password. It does not expire automatically and cannot be remotely revoked without changing your API key.</p>
<label for="portable-password">Optional transfer password<input id="portable-password" type="password" autocomplete="new-password" minlength="10" maxlength="200" placeholder="At least 10 characters"></label>
<p class="setting-help">Recommended when sending a file or link. Send the password separately. It is not your Parent PIN.</p>
<div class="setting-inline-actions"><button id="portable-show-qr" type="button">Show QR code</button><button id="portable-export-file" type="button">Export setup file</button></div>
<div id="portable-send-result" hidden><p id="portable-size" class="setting-help"></p><canvas id="portable-qr" aria-label="Private setup QR code" hidden></canvas><p id="portable-frame-status" class="setting-help"></p><div id="portable-frame-controls" hidden><button id="portable-pause" type="button">Pause animation</button><button id="portable-next" type="button">Next frame</button></div><button id="portable-copy-link" type="button">Copy private setup link</button></div>
</section>
<section id="portable-receive" hidden>
<p>Use your normal camera for one static QR. For an animated QR, tap Scan camera and hold it pointed at the source screen until all frames are collected.</p>
<div class="setting-inline-actions"><button id="portable-scan" type="button">Scan camera</button><button id="portable-stop-camera" type="button">Stop camera</button></div><video id="portable-camera" muted autoplay playsinline hidden></video>
<label for="portable-file">Import setup file<input id="portable-file" type="file" accept=".twsetup,text/plain,application/octet-stream"></label>
<details><summary>Paste a private setup link instead</summary><label for="portable-paste">Setup link<input id="portable-paste" type="password" autocomplete="off" spellcheck="false" maxlength="67584"></label><button id="portable-read-paste" type="button">Read setup</button></details>
<div id="portable-unlock" hidden><label for="portable-unlock-password">Transfer password<input id="portable-unlock-password" type="password" autocomplete="off" maxlength="200"></label><button id="portable-unlock-button" type="button">Unlock setup</button></div>
<div id="portable-preview" hidden><p id="portable-preview-summary"></p><p>Importing replaces this browser’s API connection, ordinary settings, Continue Watching, and My List. Existing parental controls are not reset or replaced. The source device stays connected.</p><button id="portable-import-confirm" class="primary" type="button">Replace with this setup</button></div>
</section><p id="portable-message" class="status" role="status" aria-live="polite"></p></dialog>`;
html=once(html,'<dialog id="diagnostics-dialog">',dialog+'\n<dialog id="diagnostics-dialog">');write('public/index.html',html);
write('public/portable-setup.css',`.portable-dialog{width:min(94vw,620px);max-height:92dvh;overflow:auto}.portable-dialog p{line-height:1.5}.portable-dialog input:not([type=file]){width:100%;box-sizing:border-box}.portable-dialog label{display:block;margin-block:14px}.portable-warning{padding:12px;border:1px solid #b99656;border-radius:8px}.portable-dialog canvas{display:block;max-width:min(100%,440px);height:auto;margin:18px auto;image-rendering:pixelated;background:white}.portable-dialog video{width:100%;max-height:45vh;object-fit:contain;background:#000}.portable-dialog [hidden]{display:none!important}.portable-dialog details{margin-block:16px}.portable-dialog button{min-height:44px}footer a{color:inherit}\n`);

write('public/sw.js',`const CACHE='torbox-main-v2.0.0';
const SHELL=['./','./index.html','./style.css','./discover.css','./portable-setup.css','./app.js','./runtime.js','./vault.js','./history.js','./settings.js','./watchlist.js','./search-history.js','./source-memory.js','./parental-controls.js','./direct-runtime.js','./portable-setup.js','./portable-setup-ui.js','./vendor/qrcode.js','./vendor/jsqr.js','./playback-errors.js','./discover.js','./source-client.js','./manifest.webmanifest','./icon.svg','./relay-config.json'];
const shellUrls=new Set(SHELL.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('torbox-main-v')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);if(url.origin!==self.location.origin||!shellUrls.has(url.origin+url.pathname))return;
 // Never intercept /key/, /direct/, APIs, media, or other apps on this origin.
 const cacheKey=url.origin+url.pathname;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(cacheKey,clone)));}return response;}).catch(()=>caches.open(CACHE).then(c=>c.match(cacheKey))));
});
`);
write('public/direct/index.html',`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; base-uri 'none'; object-src 'none'"><title>Open TorBox Player</title><script src="./redirect.js" defer></script></head><body><p>The browser-local player is now at the main address.</p><a href="../">Open TorBox Player</a></body></html>`);
write('public/direct/redirect.js',`(async()=>{const target=new URL('../',location.href);target.search=location.search;target.hash=location.hash;try{const r=await navigator.serviceWorker?.getRegistration(location.href);if(r&&new URL(r.scope).pathname===location.pathname)await r.unregister();}catch{}location.replace(target.href);})();\n`);
write('public/direct/sw.js',`self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()));\n`);
const manifest=JSON.parse(read('public/manifest.webmanifest'));manifest.name='TorBox Player';manifest.short_name='TorBox';manifest.id='./';manifest.start_url='./';manifest.scope='./';write('public/manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');

let server=read('server.mjs');for(const p of ['portable-setup.js','portable-setup-ui.js','portable-setup.css','vendor/qrcode.js','vendor/jsqr.js']){const type=p.endsWith('.css')?'text/css':'text/javascript';server=once(server,"  ['/direct-runtime.js', ['direct-runtime.js', 'text/javascript; charset=utf-8']],",`  ['/${p}', ['${p}', '${type}; charset=utf-8']],\n  ['/direct-runtime.js', ['direct-runtime.js', 'text/javascript; charset=utf-8']],`);}server=server.replaceAll("version: '1.1.0'","version: '2.0.0'");write('server.mjs',server);
write('entry.mjs',read('entry.mjs').replaceAll("version: '1.1.0'","version: '2.0.0'"));
for(const p of ['package.json','package-lock.json']){const x=JSON.parse(read(p));x.version='2.0.0';if(x.packages?.[''])x.packages[''].version='2.0.0';if(x.scripts)x.scripts.check+=' && node --check public/portable-setup.js && node --check public/portable-setup-ui.js';write(p,JSON.stringify(x,null,2)+'\n');}
// Adapt assertions about the old experiment's label and hidden transfer area.
let tests=read('test/browser-direct.test.mjs').replace("assert.match(html, /id=\"sync-settings-group\"[^>]*hidden/);","assert.match(html, /id=\"portable-settings-group\"/);").replace('/Browser-local experiment/','/Browser-local player/').replace('https://*.workers.dev','https://torbox-web-player-relay.jonathanjablon.workers.dev');write('test/browser-direct.test.mjs',tests);
write('test/split-hosting.test.mjs',read('test/split-hosting.test.mjs').replace('https://*.workers.dev','https://torbox-web-player-relay.jonathanjablon.workers.dev'));
write('test/search-experience.test.mjs',read('test/search-experience.test.mjs').replaceAll('1.1.0','2.0.0').replaceAll('1\\.1\\.0','2\\.0\\.0').replace('torbox-player-direct-0\\.1','torbox-main-v2\\.0\\.0'));
write('test/kid-mode-ui.test.mjs',read('test/kid-mode-ui.test.mjs').replaceAll('1\\.1\\.0','2\\.0\\.0'));
write('tools/.browser-local-prepared','2.0.0\n');
console.log('Prepared browser-local v2. Original /key branch was not modified.');

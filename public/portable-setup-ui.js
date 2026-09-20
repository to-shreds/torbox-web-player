import { collectPortableSetup, encodePortableSetup, decodePortableSetup, portableSummary, makeSetupUrl, tokenFromText, isProtectedSetup, splitSetupFrames, SetupFrameCollector } from './portable-setup.js?v=2.3.1';

const BASE=new URL('./',import.meta.url).href;
const loads=new Map();
function library(path,globalName){if(globalThis[globalName])return Promise.resolve(globalThis[globalName]);if(!loads.has(path))loads.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,import.meta.url).href;s.onload=()=>resolve(globalThis[globalName]);s.onerror=()=>{loads.delete(path);s.remove();reject(new Error('The local camera/QR component could not load. Export or import a setup file instead.'));};document.head.append(s);}));return loads.get(path);}
function makeQr(qrcode,text){const qr=qrcode(0,'M');qr.addData(text,'Byte');qr.make();return qr;}
function paintQr(canvas,qr){const cells=qr.getModuleCount(),scale=5,edge=(cells+8)*scale;canvas.width=edge;canvas.height=edge;const c=canvas.getContext('2d');c.fillStyle='#ffffff';c.fillRect(0,0,edge,edge);c.fillStyle='#000000';for(let y=0;y<cells;y++)for(let x=0;x<cells;x++)if(qr.isDark(y,x))c.fillRect((x+4)*scale,(y+4)*scale,scale,scale);}

export function installPortableSetupUI({getCredential,importSetup,authorize,refresh}){
  const $=id=>document.getElementById(id),dialog=$('portable-dialog');
  let token='',value=null,frameTimer=null,stream=null,scanTimer=null,scanGeneration=0,sendGeneration=0,qrFrames=[],qrIndex=0;
  const collector=new SetupFrameCollector();
  const note=(text,error=false)=>{ $('portable-message').textContent=text; $('portable-message').classList.toggle('error',error); };
  function stopScanner(){scanGeneration++;clearTimeout(scanTimer);scanTimer=null;if(stream)for(const track of stream.getTracks())track.stop();stream=null;$('portable-camera').srcObject=null;$('portable-camera').hidden=true;}
  function stopFrames(){clearInterval(frameTimer);frameTimer=null;}
  function invalidateSend(){sendGeneration++;stopFrames();token='';value=null;qrFrames=[];$('portable-qr').hidden=true;$('portable-send-result').hidden=true;$('portable-frame-controls').hidden=true;$('portable-frame-status').textContent='';const canvas=$('portable-qr');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);}
  function clear(){invalidateSend();stopScanner();collector.reset();$('portable-password').value='';$('portable-unlock-password').value='';$('portable-paste').value='';$('portable-file').value='';$('portable-unlock').hidden=true;$('portable-preview').hidden=true;note('');}
  function open(mode){clear();$('portable-send').hidden=mode!=='send';$('portable-receive').hidden=mode!=='receive';$('portable-title').textContent=mode==='send'?'Transfer this setup':'Receive a setup';if(!dialog.open)dialog.showModal();}
  function choose(mode){authorize(()=>open(mode));}
  $('portable-open-send').addEventListener('click',()=>choose('send'));
  $('portable-open-receive').addEventListener('click',()=>choose('receive'));
  $('portable-login-receive').addEventListener('click',()=>choose('receive'));
  $('portable-close').addEventListener('click',()=>dialog.close());
  $('portable-password').addEventListener('input',()=>{invalidateSend();note('Password changed. Generate a fresh QR, file, or link. Previously shared copies are not revoked.');});
  dialog.addEventListener('close',clear);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopScanner();stopFrames();if(dialog.open)note('Camera and animation paused. Tap Scan or Resume to continue.');}});
  window.addEventListener('pagehide',()=>{stopScanner();stopFrames();});

  async function generate(){
    invalidateSend();const generation=sendGeneration;
    const key=getCredential();if(!key)throw new Error('Connect your TorBox account before exporting this setup.');
    const prepared=collectPortableSetup(key),encoded=await encodePortableSetup(prepared,{password:$('portable-password').value});
    if(generation!==sendGeneration||!dialog.open)throw new Error('Transfer changed or closed. Generate a fresh code when ready.');
    value=prepared;token=encoded;
    $('portable-send-result').hidden=false;$('portable-size').textContent=portableSummary(value).myList+' My List items; '+portableSummary(value).recent+' saved playback entries. Package: '+token.length+' characters.';
    return token;
  }
  function renderFrame(){if(!qrFrames.length)return;paintQr($('portable-qr'),qrFrames[qrIndex]);$('portable-frame-status').textContent=qrFrames.length===1?'One QR. Scan with the ordinary phone camera.':`Displaying frame ${qrIndex+1} of ${qrFrames.length}. The receiving device shows collection progress.`;qrIndex=(qrIndex+1)%qrFrames.length;}
  function animate(){stopFrames();if(qrFrames.length>1){frameTimer=setInterval(renderFrame,350);$('portable-pause').textContent='Pause animation';}}
  $('portable-show-qr').addEventListener('click',async()=>{
    const button=$('portable-show-qr');button.disabled=true;note('Building the QR locally...');stopFrames();
    try{await generate();const generation=sendGeneration,qrcode=await library('./vendor/qrcode.js','qrcode');if(generation!==sendGeneration||!dialog.open)return;const url=makeSetupUrl(token,BASE);let single=null;try{single=makeQr(qrcode,url);}catch{}
      if(single&&single.getModuleCount()<=113){qrFrames=[single];note('Scan this once using the other phone’s camera. Nothing was uploaded.');}
      else{const frames=await splitSetupFrames(token);if(generation!==sendGeneration||!dialog.open)return;qrFrames=frames.map(text=>makeQr(qrcode,text));note('This collection needs camera transfer. On the receiving device open Receive setup, tap Scan camera, and hold it here. No repeated tapping.');}
      qrIndex=0;$('portable-qr').hidden=false;$('portable-frame-controls').hidden=qrFrames.length<2;renderFrame();animate();
    }catch(error){note(error.message,true);}finally{button.disabled=false;}
  });
  $('portable-pause').addEventListener('click',()=>{if(frameTimer){stopFrames();$('portable-pause').textContent='Resume animation';}else animate();});
  $('portable-next').addEventListener('click',()=>{stopFrames();$('portable-pause').textContent='Resume animation';renderFrame();});
  $('portable-export-file').addEventListener('click',async()=>{
    const b=$('portable-export-file');b.disabled=true;
    try{await generate();const file=new Blob([token+'\n'],{type:'text/plain'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='TorBox-setup.twsetup';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);note($('portable-password').value?'Password-protected file created locally. Send the password separately.':'Setup file created locally. It contains your API key; share it only with a device you trust.');}catch(error){note(error.message,true);}finally{b.disabled=false;}
  });
  $('portable-copy-link').addEventListener('click',async()=>{try{if(!token)await generate();await navigator.clipboard.writeText(makeSetupUrl(token,BASE));note('Private setup link copied. This is a credential, not a public share link.');}catch(error){note('Could not copy the link. Use the QR or setup file.',true);}});

  async function preview(received){
    stopScanner();token=tokenFromText(received);value=null;$('portable-preview').hidden=true;
    if(isProtectedSetup(token)){$('portable-unlock').hidden=false;note('Enter the transfer password, not this device’s Parent PIN.');$('portable-unlock-password').focus();return;}
    value=await decodePortableSetup(token);showPreview();
  }
  function showPreview(){const summary=portableSummary(value);$('portable-unlock').hidden=true;$('portable-preview').hidden=false;$('portable-preview-summary').textContent=`TorBox connection, ordinary settings, ${summary.recent} saved playback entries, and ${summary.myList} My List items.`;note('Review before importing. No account details have been sent anywhere.');}
  $('portable-unlock-button').addEventListener('click',async()=>{try{value=await decodePortableSetup(token,{password:$('portable-unlock-password').value});$('portable-unlock-password').value='';showPreview();}catch(error){note(error.message,true);}});
  $('portable-file').addEventListener('change',async()=>{try{const file=$('portable-file').files?.[0];if(!file)return;if(file.size>100000)throw new Error('That file is too large to be a player setup.');await preview(await file.text());}catch(error){note(error.message,true);}});
  $('portable-read-paste').addEventListener('click',async()=>{try{await preview($('portable-paste').value);$('portable-paste').value='';}catch(error){note(error.message,true);}});
  $('portable-import-confirm').addEventListener('click',()=>{
    if(!value)return;const selected=value;
    authorize(async()=>{const button=$('portable-import-confirm');button.disabled=true;note('Validating the connection and saving this setup...');
      try{await importSetup(selected);dialog.close();await refresh();}catch(error){note(error.message,true);}finally{button.disabled=false;}
    });
  });
  $('portable-scan').addEventListener('click',async()=>{
    stopScanner();collector.reset();$('portable-preview').hidden=true;$('portable-unlock').hidden=true;note('Allow the camera, then point it at the other device.');
    const generation=scanGeneration;
    try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('This browser has no camera access. Import a setup file or paste the private setup link.');const jsQR=await library('./vendor/jsqr.js','jsQR');
      const camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280}},audio:false});
      if(generation!==scanGeneration||!dialog.open){camera.getTracks().forEach(t=>t.stop());return;}stream=camera;const video=$('portable-camera');video.srcObject=stream;video.hidden=false;await video.play();
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
      async function scan(){if(generation!==scanGeneration||!stream)return;
        try{if(video.readyState>=2&&video.videoWidth){const ratio=Math.min(1,960/video.videoWidth);canvas.width=Math.round(video.videoWidth*ratio);canvas.height=Math.round(video.videoHeight*ratio);context.drawImage(video,0,0,canvas.width,canvas.height);const data=context.getImageData(0,0,canvas.width,canvas.height),code=jsQR(data.data,data.width,data.height,{inversionAttempts:'dontInvert'});
          if(code){if(code.data.startsWith('TW2:')){const result=await collector.accept(code.data);note(`Receiving: ${result.received} of ${result.total} frames. Keep the camera pointed at the screen.`);if(result.token){await preview(result.token);return;}}
            else if(code.data.startsWith('tw2.')||code.data.includes('#setup=tw2.')){await preview(code.data);return;}}
        }}catch(error){note(error.message,true);}if(generation===scanGeneration)scanTimer=setTimeout(scan,120);
      }
      scan();
    }catch(error){stopScanner();note(error.name==='NotAllowedError'?'Camera access was not allowed. You can import a file or paste the private setup link instead.':error.message,true);}
  });
  $('portable-stop-camera').addEventListener('click',()=>{stopScanner();collector.reset();note('Scanner stopped.');});

  const incoming=location.hash.startsWith('#setup=')?location.href:'';
  if(incoming){history.replaceState(null,'',location.pathname+location.search);authorize(()=>{open('receive');preview(incoming).catch(error=>note(error.message,true));});}
  return {close:()=>dialog.close()};
}

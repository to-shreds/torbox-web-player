// Real browser storage/UI checks with synthetic credentials only. No Trakt account is contacted.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startFixture} from './fixture.mjs';
let browser,fixture;
before(async()=>{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{}),args:['--no-sandbox']});
  fixture=await startFixture(4195);
});
after(async()=>{await browser?.close();await fixture?.close();});
async function setup(t){
  const context=await browser.newContext({viewport:{width:1100,height:900},serviceWorkers:'block'});
  const errors=[],traktRequests=[];
  context.on('page',page=>{page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));});
  await context.route('https://**/*',route=>{if(new URL(route.request().url()).hostname.endsWith('trakt.tv'))traktRequests.push(route.request().url());return route.abort();});
  const token=fixture.session();
  await context.addInitScript(({token,origin})=>{if(location.origin===origin)sessionStorage.setItem('torbox-web-session',token);},{token,origin:fixture.origin});
  t.after(async()=>{await context.close();assert.deepEqual(errors,[]);assert.deepEqual(traktRequests,[]);});
  const page=await context.newPage();
  return {context,page};
}

test('Trakt remains optional and silent with no credentials in the actual player settings',async t=>{
  const {page}=await setup(t);
  await page.goto(fixture.origin);
  await page.waitForSelector('#workspace:not([hidden])');
  assert.equal(await page.locator('#trakt-scrobble-toggle').isChecked(),false);
  assert.equal(await page.locator('#trakt-scrobble-toggle').isDisabled(),true);
  await page.locator('#open-settings').click();
  assert.equal(await page.locator('#trakt-client-id').inputValue(),'');
  assert.equal(await page.locator('#trakt-import-history').isDisabled(),true);
  assert.equal(await page.locator('#trakt-disconnect').isDisabled(),true);
  assert.match(await page.locator('#trakt-status').textContent(),/Not connected/);
});

test('Trakt first saves from independent tabs share a durable key and preserve both viewers',async t=>{
  const {context,page}=await setup(t),second=await context.newPage();
  await Promise.all([page,second].map(p=>p.goto(fixture.origin+'/#sports')));
  // Delaying actual key generation makes first-save overlap repeatable while
  // retaining the browser's real WebCrypto, CryptoKey cloning and IndexedDB.
  await Promise.all([page,second].map(p=>p.evaluate(()=>{
    const generate=crypto.subtle.generateKey.bind(crypto.subtle);
    crypto.subtle.generateKey=async(...args)=>{await new Promise(r=>setTimeout(r,150));return generate(...args);};
  })));
  await Promise.all([page,second].map((p,index)=>p.evaluate(async index=>{
    const vault=await import('./trakt-vault.js');
    await vault.saveTraktCredentials('viewer-'+(index+1),{access_token:'synthetic-access-'+index,refresh_token:'synthetic-refresh-'+index,client_id:'synthetic-client'});
  },index)));
  await page.reload();
  const credentials=await page.evaluate(async()=>{
    const vault=await import('./trakt-vault.js');
    return Promise.all(['viewer-1','viewer-2'].map(v=>vault.loadTraktCredentials(v)));
  });
  assert.equal(credentials[0]?.access_token,'synthetic-access-0');
  assert.equal(credentials[1]?.access_token,'synthetic-access-1');
  const raw=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('torbox-trakt-credentials-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try{return await new Promise((resolve,reject)=>{const r=db.transaction('secrets','readonly').objectStore('secrets').getAll();r.onsuccess=()=>resolve(JSON.stringify(r.result));r.onerror=()=>reject(r.error);});}finally{db.close();}
  });
  assert.equal(raw.includes('synthetic-access'),false);
  assert.equal(raw.includes('synthetic-refresh'),false);
});

test('forty overlapping credential writes followed by removal cannot restore the removed viewer',async t=>{
  const {page}=await setup(t);await page.goto(fixture.origin+'/#sports');
  const result=await page.evaluate(async()=>{
    const vault=await import('./trakt-vault.js');
    const writes=Array.from({length:40},(_,i)=>vault.saveTraktCredentials('viewer-'+(i%2+1),{access_token:'synthetic-access-'+i,refresh_token:'synthetic-refresh-'+i}));
    const removal=vault.removeTraktCredentials('viewer-1');
    await Promise.all([...writes,removal]);
    return Promise.all(['viewer-1','viewer-2'].map(v=>vault.loadTraktCredentials(v)));
  });
  assert.equal(result[0],null);
  assert.equal(result[1]?.access_token,'synthetic-access-39');
});

test('actual viewer switching keeps independent Trakt toggle choices and encrypted credentials',async t=>{
  const {page}=await setup(t);await page.goto(fixture.origin+'/#sports');
  await page.evaluate(async()=>{
    const vault=await import('./trakt-vault.js'),client_id='a'.repeat(64);
    localStorage.setItem('torbox-trakt-client-id-v1',client_id);
    await Promise.all(['viewer-1','viewer-2'].map(async viewer=>{
      await vault.saveTraktCredentials(viewer,{client_id,access_token:'synthetic-access-'+viewer,refresh_token:'synthetic-refresh-'+viewer,expires_at:Date.now()+86400000});
      localStorage.setItem('torbox-trakt-preferences-v1:'+viewer,JSON.stringify({enabled:viewer==='viewer-1',importHistory:false}));
    }));
  });
  await page.locator('#open-cinema').click();await page.waitForSelector('#workspace:not([hidden])');
  await page.waitForFunction(()=>!document.querySelector('#trakt-scrobble-toggle').disabled);
  assert.equal(await page.locator('#trakt-scrobble-toggle').isChecked(),true);
  await page.locator('#viewer').selectOption('viewer-2');
  assert.equal(await page.locator('#trakt-scrobble-toggle').isChecked(),false);
  await page.locator('#trakt-scrobble-toggle').check();await page.locator('#trakt-scrobble-toggle').uncheck();
  await page.locator('#viewer').selectOption('viewer-1');
  assert.equal(await page.locator('#trakt-scrobble-toggle').isChecked(),true);
  assert.deepEqual(await page.evaluate(()=>['viewer-1','viewer-2'].map(v=>JSON.parse(localStorage.getItem('torbox-trakt-preferences-v1:'+v)).enabled)),[true,false]);
});

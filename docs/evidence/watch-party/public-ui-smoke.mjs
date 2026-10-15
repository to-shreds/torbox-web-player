import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

const site='https://to-shreds.github.io/torbox-web-player/';
const proxy=new URL(process.env.HTTPS_PROXY||process.env.HTTP_PROXY);
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/tmp/chromium',proxy:{server:proxy.origin},args:['--no-sandbox']});
const context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:412,height:915},isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],partyRequests=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/watch-party/'))partyRequests.push(request.url());});
try{
  await page.goto(site+'?v=release-1.2.3-party.1#party='+'Z'.repeat(43));
  await page.locator('#login:not([hidden])').waitFor({timeout:70000});
  assert.match(await page.locator('head').innerHTML(),/release-1\.2\.3-party\.1/);
  assert.equal(await page.locator('#party-join-code').inputValue(),'Z'.repeat(43));
  assert.equal(await page.locator('#watch-party-dialog').evaluate(node=>node.open),false);
  assert.deepEqual(partyRequests,[]);
  await page.locator('#open-games').click();
  await page.locator('[data-extra-game-id="mindmaze-encarta"], [data-game-id="mindmaze-encarta"]').waitFor();
  const catalog=await page.locator('#games-grid strong').allTextContents();
  assert.equal(catalog.length,8);assert(catalog.includes('MindMaze (Encarta browser recreation)'));
  assert.deepEqual(errors,[]);
  const report={checkedAt:new Date().toISOString(),site,build:'release-1.2.3-party.1',scope:'Public production login/invitation UI and catalog only; no authenticated account or actual party was used.',environmentProxyCertificateException:true,invitationPreservedUntilLogin:true,noUnauthenticatedPartyRequest:true,catalog,errors,success:true};
  await writeFile(new URL('./production-ui.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({success:true,catalog:catalog.length,errors}));
}finally{await context.close();await browser.close();}

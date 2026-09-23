import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('PiP playback does not explicitly surrender the screen wake lock when the page is hidden',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(app.includes("if(!playerIsPiP(active))releaseWakeLock();else void refreshWakeLockForPlayback(active)"));
  assert.ok(app.includes("listen('enterpictureinpicture',()=>{updatePlayerModeActions();void refreshWakeLockForPlayback(context);})"));
  assert.ok(app.includes("document.visibilityState!=='visible'&&!pip"));
});

test('fullscreen exposes a dedicated exit control and shields the first reveal tap from seeking',async()=>{
  const [app,html,css]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8')
  ]);
  assert.ok(html.includes('id="fullscreen-exit-overlay"'));
  assert.ok(html.includes('Exit full screen'));
  assert.ok(app.includes("$('fullscreen-exit-overlay').addEventListener('click'"));
  assert.ok(app.includes("if(wasHidden&&event.target===active?.video){event.preventDefault();event.stopPropagation();}"));
  assert.ok(app.includes("if(current===video)"));
  assert.ok(app.includes("shell.requestFullscreen()"));
  assert.ok(css.includes('.player-media-shell:fullscreen .fullscreen-exit-overlay'));
});
test('all static app element lookups point to published HTML ids',async()=>{
  const [app,html]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/index.html',import.meta.url),'utf8')
  ]);
  const ids=[...app.matchAll(/\\$\\('([^']+)'\\)/g)].map(match=>match[1]);
  const missing=[...new Set(ids)].filter(id=>!html.includes(`id="${id}"`));
  assert.deepEqual(missing,[]);
});
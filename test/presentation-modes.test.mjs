import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('player uses a stable fullscreen container instead of the replaceable video element',async()=>{
  const [html,app,css]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/style.css',import.meta.url),'utf8')
  ]);
  assert.ok(html.includes('id="player-media-shell"'));
  assert.ok(html.includes('id="toggle-fullscreen"'));
  assert.ok(app.includes("shell.requestFullscreen()"));
  assert.ok(app.includes("video.controlsList.add('nofullscreen')"));
  assert.ok(app.includes("document.addEventListener('fullscreenchange'"));
  assert.ok(app.includes("screen.orientation.addEventListener('change',noteOrientationChange)"));
  assert.ok(app.includes("fullscreenRestoreDeadline=Date.now()+6000"));
  assert.ok(css.includes('.player-media-shell:fullscreen'));
});

test('player offers picture in picture only when the browser exposes the standard API',async()=>{
  const [html,app]=await Promise.all([
    readFile(new URL('../public/index.html',import.meta.url),'utf8'),
    readFile(new URL('../public/app.js',import.meta.url),'utf8')
  ]);
  assert.ok(html.includes('id="toggle-pip"'));
  assert.ok(app.includes('document.pictureInPictureEnabled===true'));
  assert.ok(app.includes("typeof video.requestPictureInPicture==='function'"));
  assert.ok(app.includes('video.requestPictureInPicture()'));
  assert.ok(app.includes('document.exitPictureInPicture()'));
  assert.ok(app.includes("video.addEventListener('enterpictureinpicture'"));
  assert.ok(app.includes("video.addEventListener('leavepictureinpicture'"));
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, normalizeSettings } from '../public/settings.js';

test('credits window defaults to 45 seconds and accepts only supported choices',()=>{
  assert.equal(DEFAULT_SETTINGS.creditsLeadSeconds,45);
  for(const seconds of [0,20,30,45,60])assert.equal(normalizeSettings({creditsLeadSeconds:seconds}).creditsLeadSeconds,seconds);
  assert.equal(normalizeSettings({creditsLeadSeconds:12}).creditsLeadSeconds,45);
});

test('Up Next UI supports immediate skip and explicit credits viewing without Stay here',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('id="play-next-now"'));
  assert.ok(html.includes('Play next now'));
  assert.ok(html.includes('id="watch-credits"'));
  assert.ok(html.includes('Watch credits'));
  assert.ok(!html.includes('Stay here'));
  const lead=html.match(/<select id="setting-credits-lead">([\s\S]*?)<\/select>/);
  assert.ok(lead);
  for(const seconds of [0,20,30,45,60])assert.match(lead[1],new RegExp(`value="${seconds}"`));
});

test('auto-next is media-time driven during credits and ended is only the safety net',async()=>{
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(app.includes('updateNextEpisodePrompt(context)'));
  assert.ok(app.includes('duration-current<=lead'));
  assert.ok(app.includes('current-context.nextCountdownStart'));
  assert.ok(app.includes('context.nextWatchCredits=true'));
  assert.ok(app.includes("Watching credits · the next episode will start when this one ends."));
  assert.ok(app.includes('openNextEpisode(context,{fromEnded:true})'));
  assert.ok(app.includes('markPlaybackCompleted(context,completionDuration)'));
  assert.ok(!app.includes('nextCountdownTimer=setInterval'));
  assert.ok(!app.includes('scheduleNextEpisode(context)'));
});

test('next episode can be prepared during credits without exposing source options',async()=>{
  const [app,discover]=await Promise.all([
    readFile(new URL('../public/app.js',import.meta.url),'utf8'),
    readFile(new URL('../public/discover.js',import.meta.url),'utf8')
  ]);
  assert.ok(app.includes('discoveryUI.prepareNext'));
  assert.ok(app.includes('discoveryUI.playPreparedNext'));
  assert.ok(discover.includes('async function prepareNext'));
  assert.ok(discover.includes('async function playPreparedNext'));
  assert.ok(!app.includes('openOptions('));
});

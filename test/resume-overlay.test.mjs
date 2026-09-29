import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('resume actions use a prominent activity overlay until playback begins', async () => {
  const [html, app, discover, style] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/discover.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/style.css', import.meta.url), 'utf8')
  ]);
  assert.ok(html.includes('id="resume-overlay"'));
  assert.ok(html.includes('id="resume-overlay-title"'));
  assert.ok(html.includes('id="resume-overlay-detail"'));
  assert.ok(app.includes('function showResumeOverlay('));
  assert.ok(app.includes('function hideResumeOverlay('));
  assert.ok(app.includes('hideResumeOverlay(); clearBuffer();'));
  assert.ok(app.includes("updateResumeOverlay('Resuming at '+formatResumeTime(position)+'…'"));
  assert.ok(discover.includes("resumeActivity?.show?.(startOver?'Starting '+entry.title+' over…':'Resuming '+entry.title+'…'"));
  assert.ok(discover.includes('context.resumeIntent=!startOver;context.startOverIntent=startOver'));
  assert.ok(discover.includes('const resumeRow=showResumeActivity(meta,target,episodeName,false)'));
  assert.ok(style.includes('.resume-overlay{position:fixed;inset:0;z-index:200'));
  assert.ok(style.includes('@keyframes resume-spin'));
});

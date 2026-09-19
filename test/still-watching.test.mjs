import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, normalizeSettings } from '../public/settings.js';

test('still-watching guard defaults to 90 minutes and validates supported choices', () => {
  assert.equal(DEFAULT_SETTINGS.stillWatchingMinutes, 90);
  for (const minutes of [0, 60, 75, 90, 120]) {
    assert.equal(normalizeSettings({ stillWatchingMinutes: minutes }).stillWatchingMinutes, minutes);
  }
  assert.equal(normalizeSettings({ stillWatchingMinutes: 15 }).stillWatchingMinutes, 90);
  assert.equal(normalizeSettings({ stillWatchingMinutes: 999 }).stillWatchingMinutes, 90);
});

test('settings UI exposes Off, 60, 75, 90, and 120 minute still-watching choices', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const match = html.match(/<select id="setting-still-watching">([\s\S]*?)<\/select>/);
  assert.ok(match);
  for (const minutes of [0, 60, 75, 90, 120]) assert.match(match[1], new RegExp(`value="${minutes}"`));
});

test('unattended-playback guard survives auto-next and requires explicit Keep watching', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /stillWatchingDue=true/);
  assert.match(app, /if\(stillWatchingDue\)\{triggerStillWatchingPrompt\(\);return;\}/);
  assert.match(app, /!stillWatchingPromptActive&&!video\.ended\)clearStillWatchingTimer\(\)/);
  assert.match(app, /context\.video\.pause\(\)/);
  assert.match(app, /\$\('keep-watching'\)\.addEventListener/);
  assert.match(app, /active\.video\.play\(\)/);
});

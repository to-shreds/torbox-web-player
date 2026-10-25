import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production publication depends on native audio regression checks of the exact deployed commit', async () => {
  const [pages, release, packageText] = await Promise.all([
    readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/release-checks.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  assert.match(pages, /verify:\s*\n\s+uses: \.\/\.github\/workflows\/release-checks\.yml/);
  assert.match(pages, /deploy:\s*\n\s+needs: verify/);
  assert.match(pages, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(pages, /ref: main\s*$/m, 'a newer untested main must never replace the verified commit during publication');
  assert.match(release, /run: npm run test:browser:audio\s*$/m);
  assert.doesNotMatch(release, /continue-on-error:\s*true/);
  assert.equal(JSON.parse(packageText).scripts['test:browser:audio'], 'node --test test/browser/audio-recovery.mjs');
});

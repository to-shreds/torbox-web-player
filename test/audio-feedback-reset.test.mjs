import test from 'node:test';
import assert from 'node:assert/strict';
import { applySourceMemory, getTitleQuality, resetNegativeAudioFeedback, sourceMemory } from '../public/source-memory.js';
import { recommendSource } from '../public/discover.js';

const KEY = 'torbox-source-memory-v1';
const target = { type: 'series', id: 'tt1234567', season: 1, episode: 2 };
const title = 'series:tt1234567';
const hash = letter => letter.repeat(40);
const source = (letter, extra = {}) => ({ hash: hash(letter), filename: 'Example.S01E02.H264.AAC.mp4', resolution: '720p', audioCodecs: ['AAC'], cached: true, browserFriendly: true, audioRisk: false, videoRisk: false, score: 0, ...extra });

function memoryStore(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [];
  return {
    values, writes,
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => { writes.push([key, String(value)]); values.set(key, String(value)); },
    removeItem: key => values.delete(key),
  };
}

function savedPreferences() {
  return {
    customRootPreference: { preserve: true },
    titles: {
      [title]: {
        quality: '1080p',
        sources: {
          [hash('a')]: { hash: hash('a'), audio: 'bad', bad: true, successes: 3, provider: 'fixture', label: 'Previously working episode', updatedAt: 12345 },
          [hash('b')]: { hash: hash('b'), audio: 'good', bad: false, successes: 7, updatedAt: 23456 },
          [hash('c')]: { hash: hash('c'), bad: true, successes: 0, updatedAt: 34567 },
          [hash('d')]: { hash: hash('d'), audio: 'unknown', bad: true, successes: 1, updatedAt: 45678 },
          [hash('e')]: { hash: hash('e'), audio: 'good', bad: true, successes: 4, updatedAt: 56789 },
        },
      },
      'movie:tt7654321': {
        quality: '480p',
        sources: { [hash('f')]: { id: 'old-provider-id', audio: 'bad', bad: false, successes: 1, updatedAt: 67890 } },
      },
    },
  };
}

test('retiring negative audio feedback restores only affected rows and retains their exact prior snapshots', () => {
  const before = savedPreferences(), store = memoryStore({ [KEY]: JSON.stringify(before) });
  assert.equal(resetNegativeAudioFeedback(store), 2);
  const after = JSON.parse(store.getItem(KEY));
  assert.equal(after.negativeAudioReset, 1);
  const expected = structuredClone(before);
  expected.titles[title].sources[hash('a')].audio = 'unknown';
  expected.titles[title].sources[hash('a')].bad = false;
  expected.titles['movie:tt7654321'].sources[hash('f')].audio = 'unknown';
  expected.titles['movie:tt7654321'].sources[hash('f')].bad = false;
  assert.deepEqual(after.titles, expected.titles);
  assert.deepEqual(after.customRootPreference, before.customRootPreference);
  assert.deepEqual(after.retiredAudioFeedback[title][hash('a')], before.titles[title].sources[hash('a')]);
  assert.deepEqual(after.retiredAudioFeedback['movie:tt7654321'][hash('f')], before.titles['movie:tt7654321'].sources[hash('f')]);
  assert.equal(getTitleQuality(target, store), '1080p');
  assert.equal(sourceMemory(target, source('a'), store).successes, 3);
});

test('a working AAC source rejected by the former button becomes recommendable again', () => {
  const preferred = source('a', { score: 1000 }), fallback = source('b');
  const store = memoryStore({ [KEY]: JSON.stringify({ titles: { [title]: { quality: '720p', sources: { [preferred.hash]: { audio: 'bad', bad: true, successes: 2 } } } } }) });
  assert.equal(recommendSource(applySourceMemory(target, [preferred, fallback], store), 'series', '720p').hash, fallback.hash);
  assert.equal(resetNegativeAudioFeedback(store), 1);
  assert.equal(recommendSource(applySourceMemory(target, [preferred, fallback], store), 'series', '720p').hash, preferred.hash);
  assert.deepEqual(sourceMemory(target, preferred, store), { bad: false, audio: 'unknown', successes: 2, bonus: 170 });
});

test('the reset is idempotent and does not overwrite its backup or later feedback on another startup', () => {
  const store = memoryStore({ [KEY]: JSON.stringify(savedPreferences()) });
  assert.equal(resetNegativeAudioFeedback(store), 2);
  const first = store.getItem(KEY), writeCount = store.writes.length;
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.equal(store.getItem(KEY), first);
  assert.equal(store.writes.length, writeCount);
  const later = JSON.parse(first);
  later.titles[title].sources[hash('a')].bad = true;
  later.titles[title].sources[hash('a')].audio = 'bad';
  store.values.set(KEY, JSON.stringify(later));
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.equal(store.getItem(KEY), JSON.stringify(later));
  assert.equal(store.writes.length, writeCount);
});

test('history, settings, credentials, games and other storage entries remain unchanged', () => {
  const unrelated = {
    'torbox-recent-v1': JSON.stringify([{ key: 'series:tt1234567:1:2', position: 125.75, duration: 1800 }]),
    'torbox-settings-v1': JSON.stringify({ autoResume: true, defaultQuality: '720p' }),
    'torbox-key-vault-v1': 'synthetic encrypted credential',
    'torbox-games-save-v1': 'synthetic save bytes',
  };
  const store = memoryStore({ ...unrelated, [KEY]: JSON.stringify(savedPreferences()) });
  assert.equal(resetNegativeAudioFeedback(store), 2);
  for (const [key, value] of Object.entries(unrelated)) assert.equal(store.getItem(key), value, key);
  assert.ok(store.writes.every(([key]) => key === KEY));
});

test('an existing explicit bad-source block remains in force after audio feedback is retired', () => {
  const before = savedPreferences(), store = memoryStore({ [KEY]: JSON.stringify(before) });
  resetNegativeAudioFeedback(store);
  const after = JSON.parse(store.getItem(KEY));
  for (const letter of ['b', 'c', 'd', 'e']) assert.deepEqual(after.titles[title].sources[hash(letter)], before.titles[title].sources[hash(letter)]);
  assert.equal(sourceMemory(target, source('c'), store).bad, true);
  assert.equal(sourceMemory(target, source('d'), store).bad, true);
  assert.equal(sourceMemory(target, source('e'), store).audio, 'good');
  assert.equal(sourceMemory(target, source('e'), store).bad, true);
});

test('unavailable or unreadable browser storage does not throw or claim a reset', () => {
  assert.equal(resetNegativeAudioFeedback(null), 0);
  let writes = 0;
  const store = { getItem: () => { throw new Error('Storage denied'); }, setItem: () => { writes++; } };
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.equal(writes, 0);
});

test('a failed write keeps the original record and allows a later successful retry', () => {
  const original = JSON.stringify(savedPreferences()), store = memoryStore({ [KEY]: original });
  const save = store.setItem;
  store.setItem = () => { throw new Error('Storage quota exceeded'); };
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.equal(store.getItem(KEY), original);
  store.setItem = save;
  assert.equal(resetNegativeAudioFeedback(store), 2);
  assert.equal(JSON.parse(store.getItem(KEY)).negativeAudioReset, 1);
});

test('malformed or unsupported saved data is preserved rather than replaced during startup', () => {
  for (const raw of ['{invalid JSON', 'null', '[]', '42', '{"titles":null}', '{"titles":[]}']) {
    const store = memoryStore({ [KEY]: raw });
    assert.equal(resetNegativeAudioFeedback(store), 0, raw);
    assert.equal(store.getItem(KEY), raw, raw);
    assert.deepEqual(store.writes, [], raw);
  }
});

test('a valid store without negative audio keeps all preferences and becomes a no-op on repeat', () => {
  const original = { titles: { [title]: { quality: '2160p', sources: { [hash('a')]: { audio: 'good', bad: false, successes: 6 } } } } };
  const store = memoryStore({ [KEY]: JSON.stringify(original) });
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.deepEqual(JSON.parse(store.getItem(KEY)).titles, original.titles);
  const writeCount = store.writes.length;
  assert.equal(resetNegativeAudioFeedback(store), 0);
  assert.equal(store.writes.length, writeCount);
});

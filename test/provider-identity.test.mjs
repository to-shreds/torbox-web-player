import test from 'node:test';
import assert from 'node:assert/strict';
import { TorBox, mediaIdentityForFile } from '../lib/torbox.mjs';

const hash = '0123456789abcdef0123456789abcdef01234567';
const rawFile = { id: 3, name: 'Show/Season 01/Episode.mp4', short_name: 'Episode.mp4', size: 2_400_000, mimetype: 'video/mp4' };
const item = { id: 7, name: 'Show', hash, download_finished: true, download_present: true, files: [rawFile] };
const expected = { kind: 'torrent', hash, path: rawFile.name, size: rawFile.size };
const reply = data => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
function provider(value = item) {
  return new TorBox({ key: 'fixture-provider-identity-secret', fetchFn: async (url, options) => {
    if (url.pathname.endsWith('/mylist')) return reply(value);
    if (options.redirect === 'manual') return new Response(null, { status: 302, headers: { location: 'https://store.tb-cdn.io/file?temporary=fixture' } });
    return reply('https://store.tb-cdn.io/file?temporary=fixture');
  } });
}

test('torrent identity canonicalizes hash case and path separators without shortening the full relative path', () => {
  assert.deepEqual(mediaIdentityForFile('torrents', { hash: hash.toUpperCase() }, { ...rawFile, name: './Show\\Season 01\\Episode.mp4' }), expected);
  const longPath = 'Directory/'.repeat(80) + 'Episode.mp4';
  assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, name: longPath }).path, longPath);
});

test('different folders, path case, hashes and byte sizes remain different exact media identities', () => {
  const first = mediaIdentityForFile('torrents', item, rawFile);
  for (const other of [
    mediaIdentityForFile('torrents', item, { ...rawFile, name: 'Show/Season 02/Episode.mp4' }),
    mediaIdentityForFile('torrents', item, { ...rawFile, name: 'Show/Season 01/episode.mp4' }),
    mediaIdentityForFile('torrents', { ...item, hash: 'f'.repeat(40) }, rawFile),
    mediaIdentityForFile('torrents', item, { ...rawFile, size: rawFile.size + 1 })
  ]) assert.notDeepEqual(other, first);
});

test('identity never substitutes a display title, sourceInfo, account-local ID or collection name for missing proof', () => {
  const asserted = { ...expected, path: 'made-up.mp4' };
  assert.equal(mediaIdentityForFile('torrents', { ...item, hash: undefined, mediaIdentity: asserted }, { ...rawFile, sourceInfo: asserted }), null);
  assert.equal(mediaIdentityForFile('torrents', { ...item, sourceInfo: asserted }, { ...rawFile, name: undefined, mediaIdentity: asserted }), null);
  assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, size: undefined, sourceInfo: asserted }), null);
});

test('missing or invalid content hashes and non-torrent providers cannot establish exact identity', () => {
  for (const value of [undefined, null, 1, '', 'g'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), ` ${hash}`, `${hash}\n`]) {
    assert.equal(mediaIdentityForFile('torrents', { ...item, hash: value }, rawFile), null);
  }
  for (const kind of ['webdl', 'usenet', 'torrent', undefined]) assert.equal(mediaIdentityForFile(kind, item, rawFile), null);
  assert.equal(mediaIdentityForFile('torrents', null, rawFile), null);
  assert.equal(mediaIdentityForFile('torrents', item, null), null);
});

test('identity rejects ambiguous, absolute, traversing, control-bearing and oversized paths', () => {
  for (const name of [undefined, null, 9, '', '   ', '.', './', '../Episode.mp4', 'Show/../Episode.mp4', 'Show/./Episode.mp4', '/Episode.mp4', '\\Episode.mp4', '//server/Episode.mp4', 'C:\\Episode.mp4', 'C:Episode.mp4', './C:Episode.mp4', 'Show//Episode.mp4', 'Show/', 'Show\u0000/Episode.mp4', 'Show\nEpisode.mp4', 'Show\u007fEpisode.mp4', 'x'.repeat(2049)]) {
    assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, name }), null, JSON.stringify(name));
  }
  const boundary = 'x'.repeat(2044) + '.mp4';
  assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, name: boundary }).path, boundary);
});

test('identity requires an exact positive safe integer byte size', () => {
  for (const size of [undefined, null, 0, -1, 1.25, '2400000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, size }), null);
  }
  assert.equal(mediaIdentityForFile('torrents', item, { ...rawFile, size: Number.MAX_SAFE_INTEGER }).size, Number.MAX_SAFE_INTEGER);
});

test('resolved selected raw file supplies full identity while the existing display title stays short', async () => {
  const value = { ...item, files: [{ ...rawFile, id: 2, name: 'Show/Season 02/Episode.mp4' }, rawFile] };
  const result = await provider(value).resolveFile('torrents:7:3');
  assert.deepEqual(result.mediaIdentity, expected);
  assert.equal(result.file.title, 'Episode.mp4');
  assert.equal(result.file.id, 'torrents:7:3');
  assert.equal(Object.hasOwn(result.file, 'mediaIdentity'), false);
});

test('direct, redirect and relay resolvers propagate independently verified media identity', async () => {
  for (const method of ['resolve', 'resolveGuest', 'resolveForRelay']) {
    const result = await provider()[method]('torrents:7:3');
    assert.deepEqual(result.mediaIdentity, expected, method);
    assert.equal(result.file.title, 'Episode.mp4');
  }
});

test('ordinary playback still works without proof and explicitly returns a null media identity', async () => {
  for (const kind of ['torrents', 'webdl', 'usenet']) {
    for (const method of ['resolveFile', 'resolve', 'resolveGuest', 'resolveForRelay']) {
      const result = await provider({ ...item, hash: kind === 'torrents' ? undefined : hash })[method](`${kind}:7:3`);
      assert.equal(result.mediaIdentity, null, `${kind} ${method}`);
      assert.equal(result.file.title, 'Episode.mp4');
    }
  }
});

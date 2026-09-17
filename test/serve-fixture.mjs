// Explicit local test server. Not imported or enabled by the production entrypoint.
import { createApp } from '../server.mjs';
import { hashPassword } from '../lib/auth.mjs';
import { AppError } from '../lib/torbox.mjs';
const files = Array.from({ length: 12 }, (_, i) => ({ id: `torrents:1:${i}`, title: `Fixture Show S01E${String(i + 1).padStart(2, '0')}.mp4`, collection: 'Synthetic test library, not a TorBox account', mime: 'video/mp4', size: 12000000, state: 'Ready to watch', providerProgress: 1 }));
const provider = {
  list: async kind => { if (kind === 'webdl') throw new AppError('TORBOX_TIMEOUT', 'TorBox took too long to respond. Please try again.', 504); return { files, stale: false, nextOffset: null }; },
  resolve: async id => ({ file: files.find(file => file.id === id), url: 'https://cdn.torbox.app/fixture.mp4', delivery: 'direct', conversion: false }),
  account: async () => ({ valid: true, planCode: 'FIXTURE', planEntitlementsVerified: false })
};
const port = process.argv[2] || '10001';
const { server } = createApp({ env: { HOUSEHOLD_PASSWORD_HASH: await hashPassword('fixture-password-only'), PUBLIC_ORIGIN: `http://localhost:${port}` }, provider });
server.listen(Number(port), '0.0.0.0');

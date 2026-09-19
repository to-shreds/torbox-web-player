import { createApp } from './server.mjs';
import { TorBox, TORBOX_MEDIA_HOSTS } from './lib/torbox.mjs';
import { runStartupProbe } from './lib/startup-probe.mjs';

const mediaHosts = (process.env.MEDIA_HOST_SUFFIXES || TORBOX_MEDIA_HOSTS.join(','))
  .split(',')
  .map(value => value.trim().toLowerCase())
  .filter(Boolean);

const { server } = createApp();

server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', version: '0.4.1' }));

  if (process.env.TORBOX_VERIFY_ON_START === '1') {
    const provider = new TorBox({ key: process.env.TORBOX_API_KEY || '', mediaHosts });
    runStartupProbe(provider).catch(() => {
      console.error(JSON.stringify({ event: 'torbox_startup_check', ok: false, error: 'INTERNAL_ERROR' }));
    });
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

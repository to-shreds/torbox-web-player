import { createApp } from './server.mjs';
 const { server } = createApp();

server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', version: '2.1.0' }));

});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

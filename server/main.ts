import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`invalid PORT: ${process.env.PORT}`);
}

const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/web');
const server = await startServer({ port, staticDir });
console.log(`listening on :${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}

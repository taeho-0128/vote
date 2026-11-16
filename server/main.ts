import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SWEEP_MS, startServer } from './app.ts';
import { ROOM_TTL_MS } from './rooms.ts';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error(`invalid PORT: ${process.env.PORT}`);
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${name}: ${raw}`);
  return value;
}

const ttlMs = positiveInt('ROOM_TTL_MS', ROOM_TTL_MS);
const sweepMs = positiveInt('SWEEP_INTERVAL_MS', DEFAULT_SWEEP_MS);

const trustProxyRaw = process.env.TRUST_PROXY ?? '';
if (!['', '0', '1'].includes(trustProxyRaw)) throw new Error(`invalid TRUST_PROXY: ${trustProxyRaw}`);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const staticDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/web');
const server = await startServer({ port, staticDir, ttlMs, sweepMs, trustProxy: trustProxyRaw === '1', allowedOrigins });
console.log(`listening on :${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}

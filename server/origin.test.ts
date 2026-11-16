import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from './app.ts';
import type { RunningServer, ServerOptions } from './app.ts';
import { TestClient } from './testkit.ts';

let server: RunningServer | undefined;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = undefined;
});

async function start(options: Partial<ServerOptions> = {}) {
  server = await startServer({ port: 0, ...options });
  return server.port;
}

// 'open' when the upgrade went through, otherwise the HTTP status the server answered with.
async function tryUpgrade(port: number, { path = '/ws', origin }: { path?: string; origin?: string }): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: origin === undefined ? {} : { origin } });
  return new Promise<string>((resolve) => {
    ws.once('open', () => {
      ws.terminate();
      resolve('open');
    });
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve(String(res.statusCode));
    });
    ws.once('error', () => resolve('error'));
  });
}

describe('the origin of a websocket connection', () => {
  it('is allowed when it has the same host as the request', async () => {
    const port = await start();
    expect(await tryUpgrade(port, { origin: `http://127.0.0.1:${port}` })).toBe('open');
    expect(await tryUpgrade(port, { origin: `https://127.0.0.1:${port}` })).toBe('open');
  });

  it('is refused with 403 when the host differs', async () => {
    const port = await start();
    expect(await tryUpgrade(port, { origin: 'http://evil.example' })).toBe('403');
    expect(await tryUpgrade(port, { origin: `http://127.0.0.1:${port + 1}` })).toBe('403');
    expect(await tryUpgrade(port, { origin: `http://localhost:${port}` })).toBe('403');
  });

  it('is refused when it is not an origin at all', async () => {
    const port = await start();
    expect(await tryUpgrade(port, { origin: 'null' })).toBe('403');
    expect(await tryUpgrade(port, { origin: '' })).toBe('403');
    expect(await tryUpgrade(port, { origin: 'not a url' })).toBe('403');
  });

  it('is allowed from another host when that origin is listed', async () => {
    const port = await start({ allowedOrigins: ['https://vote.example.com', 'http://localhost:5173/'] });
    expect(await tryUpgrade(port, { origin: 'https://vote.example.com' })).toBe('open');
    expect(await tryUpgrade(port, { origin: 'http://localhost:5173' })).toBe('open');
    expect(await tryUpgrade(port, { origin: 'https://other.example.com' })).toBe('403');
    expect(await tryUpgrade(port, { origin: 'http://vote.example.com' })).toBe('403');
  });

  it('may be missing, as it is for clients that are not browsers', async () => {
    const port = await start();
    expect(await tryUpgrade(port, {})).toBe('open');
  });

  it('does not rescue a path other than /ws', async () => {
    const port = await start();
    expect(await tryUpgrade(port, { path: '/other' })).toBe('error');
    expect(await tryUpgrade(port, { path: '/other', origin: `http://127.0.0.1:${port}` })).toBe('error');
  });

  it('leaves a refused connection with nothing to talk to, while an allowed one works', async () => {
    const port = await start();
    expect(await tryUpgrade(port, { origin: 'http://evil.example' })).toBe('403');
    const client = await TestClient.connect(port, { headers: { origin: `http://127.0.0.1:${port}` } });
    clients.push(client);
    client.send({ t: 'createRoom' });
    await client.expect('hosted');
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { TestClient } from './testkit.ts';

let server: RunningServer | undefined;
const clients: TestClient[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = undefined;
});

const url = (path: string) => `http://127.0.0.1:${server!.port}${path}`;

describe('http', () => {
  it('answers /healthz with 200 ok', async () => {
    server = await startServer({ port: 0 });
    const res = await fetch(url('/healthz'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('serves static files and falls back to index.html for app routes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hanpyo-static-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<h1>app</h1>');
      writeFileSync(join(dir, 'a.txt'), 'asset');
      server = await startServer({ port: 0, staticDir: dir });
      expect(await (await fetch(url('/a.txt'))).text()).toBe('asset');
      expect(await (await fetch(url('/join/1234'))).text()).toBe('<h1>app</h1>');
      expect((await fetch(url('/healthz'))).status).toBe(200);
    } finally {
      await server?.close();
      server = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves 404 when there is no static directory', async () => {
    server = await startServer({ port: 0, staticDir: join(tmpdir(), 'hanpyo-does-not-exist') });
    expect((await fetch(url('/'))).status).toBe(404);
  });
});

describe('websocket endpoint', () => {
  it('refuses upgrades on any path but /ws', async () => {
    server = await startServer({ port: 0 });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
    const outcome = await new Promise<string>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('error'));
    });
    expect(outcome).toBe('error');
  });

  it('closes a connection that sends a message over the size cap', async () => {
    server = await startServer({ port: 0 });
    const client = await TestClient.connect(server.port);
    clients.push(client);
    client.send('x'.repeat(70_000));
    expect(await client.closed).toBe(1009);
  });

  it('keeps a connection open for a 5000-byte message, which the old 4096-byte cap refused', async () => {
    server = await startServer({ port: 0 });
    const client = await TestClient.connect(server.port);
    clients.push(client);
    client.send('x'.repeat(5000));
    await client.expectError('bad_message');
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('terminates a client that stops answering pings and tells the others', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    server = await startServer({ port: 0 });

    const host = await TestClient.connect(server.port);
    clients.push(host);
    host.send({ t: 'createRoom' });
    const { view } = await host.expect('hosted');

    const quiet = await TestClient.connect(server.port, { autoPong: false });
    clients.push(quiet);
    quiet.send({ t: 'join', code: view.code, nickname: 'Quiet' });
    await quiet.expect('joined');
    await host.expect('view');

    const tick = async () => {
      vi.advanceTimersByTime(25_000);
      await new Promise((r) => setTimeout(r, 100));
    };
    await tick();
    await tick();

    await quiet.closed;
    const after = (await host.expect('view')).view;
    expect(after.participants).toEqual([{ id: expect.any(String), nickname: 'Quiet', connected: false, submitted: false }]);
    expect(host.ws.readyState).toBe(WebSocket.OPEN);
  });
});

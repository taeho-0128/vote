import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAYLOAD_BYTES, startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { TestClient, startTestHub } from './testkit.ts';
import type { TestHub } from './testkit.ts';

const PONG = '{"t":"pong"}';

describe('ping', () => {
  let hub: TestHub;
  let clients: TestClient[];

  beforeEach(async () => {
    hub = await startTestHub({ codes: ['1234'], ttlMs: 10_000 });
    clients = [];
  });

  afterEach(async () => {
    for (const c of clients) c.close();
    await hub.close();
  });

  async function connect(address = '10.0.0.1'): Promise<TestClient> {
    const client = await TestClient.connect(hub.port, { headers: { 'x-forwarded-for': address } });
    clients.push(client);
    return client;
  }

  async function openRoom() {
    const host = await connect('10.9.9.9');
    host.send({ t: 'createRoom' });
    const { view, hostToken } = await host.expect('hosted');
    const alice = await connect('10.9.9.8');
    alice.send({ t: 'join', code: view.code, nickname: 'Alice' });
    await alice.expect('joined');
    await host.expect('view');
    const display = await connect('10.9.9.7');
    display.send({ t: 'watch', code: view.code, displayToken: view.displayToken });
    await display.expect('watching');
    return { host, alice, display, code: view.code, hostToken };
  }

  it('is answered with a bare pong by a socket that has not bound to a room', async () => {
    const stranger = await connect();
    stranger.send({ t: 'ping' });
    await stranger.expect('pong');
    expect(stranger.raw).toEqual([PONG]);

    stranger.send({ t: 'keepAlive' });
    await stranger.expectError('not_bound');
  });

  it('is answered on a host, a participant and a display socket, to that socket alone', async () => {
    const { host, alice, display } = await openRoom();
    for (const [sender, others] of [
      [host, [alice, display]],
      [alice, [host, display]],
      [display, [host, alice]],
    ] as const) {
      const before = sender.raw.length;
      sender.send({ t: 'ping' });
      await sender.expect('pong');
      expect(sender.raw.slice(before)).toEqual([PONG]);
      for (const other of others) await other.expectQuiet(50);
    }
  });

  it('answers with nothing but the pong when the message carries extra fields', async () => {
    const { alice, code, hostToken } = await openRoom();
    alice.send({ t: 'ping', code, hostToken, voteId: 'x' });
    await alice.expect('pong');
    expect(alice.raw.at(-1)).toBe(PONG);
  });

  it('is not room activity, so pings do not keep an idle room from expiring', async () => {
    const { host, alice, display } = await openRoom();

    hub.deps.tick(6_000);
    for (const client of [host, alice, display]) {
      client.send({ t: 'ping' });
      await client.expect('pong');
    }
    hub.deps.tick(4_000);
    hub.sweep();

    for (const client of [host, alice, display]) expect((await client.expect('error')).reason).toBe('room_expired');
    expect(hub.store.get('1234')).toBeUndefined();
  });

  it('does not count against the guess limiter, and still answers a locked address', async () => {
    const { code } = await openRoom();
    const guesser = await connect('10.1.1.1');
    const wrong = code === '0000' ? '0001' : '0000';
    for (let i = 0; i < 7; i++) {
      guesser.send({ t: 'join', code: wrong, nickname: 'Eve' });
      await guesser.expectError('room_not_found');
    }
    for (let i = 0; i < 50; i++) guesser.send({ t: 'ping' });
    for (let i = 0; i < 50; i++) await guesser.expect('pong');

    guesser.send({ t: 'join', code: wrong, nickname: 'Eve' });
    await guesser.expectError('room_not_found');
    guesser.send({ t: 'join', code, nickname: 'Eve' });
    await guesser.expectError('rate_limited');

    guesser.send({ t: 'ping' });
    await guesser.expect('pong');
  });

  it('reveals nothing a stranger could use, with or without a lock', async () => {
    const { code } = await openRoom();
    const guesser = await connect('10.1.1.2');
    const wrong = code === '0000' ? '0001' : '0000';
    guesser.send({ t: 'ping' });
    guesser.send({ t: 'join', code: wrong, nickname: 'Eve' });
    guesser.send({ t: 'ping' });
    await guesser.expect('pong');
    await guesser.expectError('room_not_found');
    await guesser.expect('pong');
    expect(guesser.raw.filter((raw) => raw === PONG)).toHaveLength(2);
    expect(guesser.raw.join('')).not.toContain(code);
  });
});

describe('ping on the real server', () => {
  let server: RunningServer | undefined;
  let client: TestClient | undefined;

  afterEach(async () => {
    client?.close();
    await server?.close();
    server = undefined;
  });

  it('is held to the same message size cap as everything else', async () => {
    server = await startServer({ port: 0 });
    client = await TestClient.connect(server.port);
    client.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_PAYLOAD_BYTES) }));
    expect(await client.closed).toBe(1009);

    client = await TestClient.connect(server.port);
    client.send(JSON.stringify({ t: 'ping', pad: 'x'.repeat(MAX_PAYLOAD_BYTES - 64) }));
    await client.expect('pong');
  });
});

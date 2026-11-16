import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { TestClient } from './testkit.ts';

let server: RunningServer;
let clients: TestClient[];

beforeEach(async () => {
  server = await startServer({ port: 0 });
  clients = [];
});

afterEach(async () => {
  for (const c of clients) c.close();
  await server.close();
});

async function connect(): Promise<TestClient> {
  const client = await TestClient.connect(server.port);
  clients.push(client);
  return client;
}

async function openRoom() {
  const host = await connect();
  host.send({ t: 'createRoom' });
  const hosted = await host.expect('hosted');
  return { host, code: hosted.view.code, hostToken: hosted.hostToken };
}

async function joinRoom(code: string, nickname: string, participantToken?: string) {
  const client = await connect();
  client.send({ t: 'join', code, nickname, participantToken });
  const joined = await client.expect('joined');
  return { client, joined };
}

const nicknames = (view: { participants: { nickname: string }[] }) => view.participants.map((p) => p.nickname);

describe('hosting', () => {
  it('creates a room with a 4-digit code and an empty lobby', async () => {
    const host = await connect();
    host.send({ t: 'createRoom' });
    const hosted = await host.expect('hosted');
    expect(hosted.view.code).toMatch(/^\d{4}$/);
    expect(hosted.view.participants).toEqual([]);
    expect(hosted.hostToken.length).toBeGreaterThanOrEqual(16);
  });

  it('gives different rooms different codes', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) codes.add((await openRoom()).code);
    expect(codes.size).toBe(20);
  });

  it('lets the host reconnect with the token and see the current lobby', async () => {
    const { host, code, hostToken } = await openRoom();
    await joinRoom(code, 'Alice');
    await host.expect('view');
    host.close();
    await host.closed;

    const again = await connect();
    again.send({ t: 'resumeHost', code, hostToken });
    const hosted = await again.expect('hosted');
    expect(hosted.view.code).toBe(code);
    expect(nicknames(hosted.view)).toEqual(['Alice']);
  });

  it('rejects resuming with a wrong token or an unknown room', async () => {
    const { code, hostToken } = await openRoom();
    const other = await connect();
    other.send({ t: 'resumeHost', code, hostToken: 'z'.repeat(24) });
    await other.expectError('bad_host_token');
    other.send({ t: 'resumeHost', code: code === '0000' ? '0001' : '0000', hostToken });
    await other.expectError('room_not_found');
  });

  it('allows several host sockets, each kept up to date', async () => {
    const { host, code, hostToken } = await openRoom();
    const second = await connect();
    second.send({ t: 'resumeHost', code, hostToken });
    await second.expect('hosted');

    await joinRoom(code, 'Alice');
    expect(nicknames((await host.expect('view')).view)).toEqual(['Alice']);
    expect(nicknames((await second.expect('view')).view)).toEqual(['Alice']);
  });

  it('refuses to rebind a socket that already has a role', async () => {
    const { host, code } = await openRoom();
    host.send({ t: 'createRoom' });
    await host.expectError('already_bound');
    host.send({ t: 'join', code, nickname: 'Alice' });
    await host.expectError('already_bound');
  });
});

describe('joining', () => {
  it('shows each joiner to the host and the earlier participants, in join order', async () => {
    const { host, code } = await openRoom();

    const alice = await joinRoom(code, 'Alice');
    expect(alice.joined.view.me.nickname).toBe('Alice');
    expect(nicknames(alice.joined.view)).toEqual(['Alice']);
    expect(nicknames((await host.expect('view')).view)).toEqual(['Alice']);

    const bob = await joinRoom(code, 'Bob');
    expect(nicknames(bob.joined.view)).toEqual(['Alice', 'Bob']);
    const hostView = (await host.expect('view')).view;
    expect(nicknames(hostView)).toEqual(['Alice', 'Bob']);
    expect(hostView.participants.every((p) => p.connected)).toBe(true);

    const aliceView = (await alice.client.expect('view')).view;
    expect(aliceView.role).toBe('participant');
    expect(nicknames(aliceView)).toEqual(['Alice', 'Bob']);
  });

  it('trims the nickname before showing it', async () => {
    const { code } = await openRoom();
    const { joined } = await joinRoom(code, '  민지 ');
    expect(joined.view.me.nickname).toBe('민지');
  });

  it('reports an unknown room code', async () => {
    const client = await connect();
    client.send({ t: 'join', code: '4321', nickname: 'Alice' });
    await client.expectError('room_not_found');
  });

  it('reports a duplicate or invalid nickname and leaves the socket usable', async () => {
    const { code } = await openRoom();
    await joinRoom(code, 'Alice');

    const client = await connect();
    client.send({ t: 'join', code, nickname: ' alice' });
    await client.expectError('nickname_taken');
    client.send({ t: 'join', code, nickname: '' });
    await client.expectError('nickname_invalid');
    client.send({ t: 'join', code, nickname: 'Bob' });
    expect((await client.expect('joined')).view.me.nickname).toBe('Bob');
  });

  it('reports a participant token that matches nobody', async () => {
    const { code } = await openRoom();
    const client = await connect();
    client.send({ t: 'join', code, nickname: 'Alice', participantToken: 'q'.repeat(24) });
    await client.expectError('bad_participant_token');
  });
});

describe('disconnecting', () => {
  it('flips connected to false for the host and others, then back on resume with the same identity', async () => {
    const { host, code } = await openRoom();
    const alice = await joinRoom(code, 'Alice');
    await host.expect('view');
    const bob = await joinRoom(code, 'Bob');
    await host.expect('view');
    await alice.client.expect('view');

    bob.client.close();
    const hostView = (await host.expect('view')).view;
    expect(hostView.participants.map((p) => [p.nickname, p.connected])).toEqual([
      ['Alice', true],
      ['Bob', false],
    ]);
    const aliceView = (await alice.client.expect('view')).view;
    expect(aliceView.participants.find((p) => p.nickname === 'Bob')?.connected).toBe(false);

    const back = await joinRoom(code, 'ignored', bob.joined.participantToken);
    expect(back.joined.view.me).toEqual(bob.joined.view.me);
    expect(back.joined.participantToken).toBe(bob.joined.participantToken);
    const resumed = (await host.expect('view')).view;
    expect(resumed.participants.map((p) => [p.nickname, p.connected])).toEqual([
      ['Alice', true],
      ['Bob', true],
    ]);
  });

  it('keeps the room alive when the host disconnects', async () => {
    const { host, code } = await openRoom();
    host.close();
    await host.closed;
    const { joined } = await joinRoom(code, 'Alice');
    expect(joined.view.code).toBe(code);
  });
});

describe('one socket per participant', () => {
  it('evicts the older socket with replaced, without showing the participant as disconnected', async () => {
    const { host, code } = await openRoom();
    const first = await joinRoom(code, 'Alice');
    await host.expect('view');

    const second = await joinRoom(code, 'Alice', first.joined.participantToken);
    await first.client.expectError('replaced');
    expect(await first.client.closed).toBeTypeOf('number');
    expect(second.joined.view.me).toEqual(first.joined.view.me);

    const hostView = (await host.expect('view')).view;
    expect(hostView.participants).toEqual([{ id: first.joined.view.me.id, nickname: 'Alice', connected: true }]);
    await host.expectQuiet();
  });
});

describe('malformed input', () => {
  it('answers bad JSON, wrong shapes, and binary frames with bad_message and keeps the socket open', async () => {
    const client = await connect();
    client.send('{not json');
    await client.expectError('bad_message');
    client.send({ t: 'nope' });
    await client.expectError('bad_message');
    client.send({ t: 'join', code: '12', nickname: 'Alice' });
    await client.expectError('bad_message');
    client.send({ t: 'resumeHost', code: '1234', hostToken: 'short' });
    await client.expectError('bad_message');
    client.ws.send(Buffer.from([1, 2, 3]));
    await client.expectError('bad_message');

    client.send({ t: 'createRoom' });
    await client.expect('hosted');
  });
});

describe('privacy', () => {
  it('never sends a token in a view or to a different person', async () => {
    const { host, code, hostToken } = await openRoom();
    const alice = await joinRoom(code, 'Alice');
    const bob = await joinRoom(code, 'Bob');
    await host.expect('view');
    await host.expect('view');
    bob.client.close();
    await host.expect('view');

    const tokenOf = (c: { joined: { participantToken: string } }) => c.joined.participantToken;
    for (const raw of alice.client.raw.filter((r) => JSON.parse(r).t === 'view')) {
      expect(raw).not.toContain(hostToken);
      expect(raw).not.toContain(tokenOf(alice));
      expect(raw).not.toContain(tokenOf(bob));
    }
    for (const raw of host.raw.filter((r) => JSON.parse(r).t === 'view')) {
      expect(raw).not.toContain(hostToken);
      expect(raw).not.toContain(tokenOf(alice));
      expect(raw).not.toContain(tokenOf(bob));
    }
  });
});

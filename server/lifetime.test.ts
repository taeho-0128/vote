import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { ROOM_EXPIRED_CLOSE_CODE } from './hub.ts';
import {
  ROOM_TTL_MS,
  RoomStore,
  closeVote,
  dismissVote,
  join,
  revealMove,
  setConnected,
  startVote,
  submitBallot,
  viewFor,
} from './rooms.ts';
import type { Room } from './rooms.ts';
import { NICKNAMES, TestClient, closedRoom, fakeDeps, must, roomWith, startTestHub, voteIdOf } from './testkit.ts';
import type { TestHub } from './testkit.ts';

const HOUR = 60 * 60 * 1000;
const draft = { title: '점심', paper: { kind: 'freeform' }, anonymity: 'anonymous' } as const;

describe('the room lifetime', () => {
  const left = (room: Room, now: number, ttlMs = ROOM_TTL_MS) => viewFor(room, { kind: 'host' }, { now, ttlMs }).expiresInMs;

  it('is 6 hours', () => {
    expect(ROOM_TTL_MS).toBe(6 * HOUR);
  });

  it('tells the host exactly how long is left, in every stage', () => {
    const deps = fakeDeps();
    const { lobby, voting, closed } = closedRoom(deps, draft, [{ kind: 'text', text: 'a' }]);
    expect(left(lobby, lobby.lastActiveAt)).toBe(ROOM_TTL_MS);
    expect(left(lobby, lobby.lastActiveAt + 1234)).toBe(ROOM_TTL_MS - 1234);
    expect(left(voting, voting.lastActiveAt + 10 * 60_000)).toBe(ROOM_TTL_MS - 10 * 60_000);
    expect(left(closed, closed.lastActiveAt + HOUR)).toBe(5 * HOUR);
  });

  it('never reports a negative time left', () => {
    const room = roomWith(fakeDeps());
    expect(left(room, room.lastActiveAt + ROOM_TTL_MS)).toBe(0);
    expect(left(room, room.lastActiveAt + ROOM_TTL_MS + 5000)).toBe(0);
  });

  describe('what counts as activity', () => {
    it('is a participant joining, resuming and submitting, and the host starting, closing, revealing and dismissing', () => {
      const deps = fakeDeps();
      const lobby = roomWith(deps, 'Alice');
      const aliceId = [...lobby.participants.keys()][0]!;
      const aliceToken = [...lobby.participants.values()][0]!.token;
      const steps: [string, (room: Room) => Room][] = [
        ['a new participant joining', (room) => { const r = join(deps, room, { nickname: 'Bobby' }); if (!r.ok) throw new Error(r.reason); return r.room; }],
        ['a participant resuming', (room) => { const r = join(deps, room, { nickname: '', participantToken: aliceToken }); if (!r.ok) throw new Error(r.reason); return r.room; }],
        ['the host starting a vote', (room) => must(startVote(deps, room, draft))],
        ['a ballot', (room) => must(submitBallot(deps, room, aliceId, voteIdOf(room), { kind: 'text', text: 'hi' }))],
        ['the host closing the vote', (room) => must(closeVote(deps, room, voteIdOf(room)))],
        ['the host moving the reveal', (room) => must(revealMove(deps, room, voteIdOf(room), 0))],
        ['the host starting the next vote after a dismiss', (room) => must(dismissVote(deps, room, voteIdOf(room)))],
      ];
      let room = lobby;
      for (const [name, step] of steps) {
        deps.tick(2 * HOUR);
        expect(left(room, deps.now()), `before ${name}`).toBe(ROOM_TTL_MS - 2 * HOUR);
        room = step(room);
        expect(left(room, deps.now()), name).toBe(ROOM_TTL_MS);
      }
    });

    it('is not a participant going away', () => {
      const deps = fakeDeps();
      const room = roomWith(deps, 'Alice');
      const id = [...room.participants.keys()][0]!;
      deps.tick(HOUR);
      expect(left(setConnected(room, id, false), deps.now())).toBe(5 * HOUR);
    });
  });
});

describe('sweeping a store', () => {
  it('removes exactly the rooms idle for the whole TTL and returns them', () => {
    const deps = fakeDeps(['1111', '2222', '3333']);
    const store = new RoomStore(deps, 1000);
    const idle = store.create()!;
    deps.tick(400);
    const touched = store.create()!;
    deps.tick(400);
    const joined = join(deps, touched, { nickname: 'Alice' });
    if (!joined.ok) throw new Error(joined.reason);
    store.update(touched.code, () => joined.room);
    deps.tick(199);
    expect(store.sweep(deps.now())).toEqual([]);

    deps.tick(1);
    expect(store.sweep(deps.now()).map((room) => room.code)).toEqual([idle.code]);
    expect(store.get(idle.code)).toBeUndefined();
    expect(store.get(touched.code)).toBeDefined();

    deps.tick(1000);
    expect(store.sweep(deps.now()).map((room) => room.code)).toEqual([touched.code]);
    expect(store.sweep(deps.now())).toEqual([]);
  });

  it('frees the code of a swept room for a new one', () => {
    const deps = fakeDeps(['1111']);
    const store = new RoomStore(deps, 1000);
    store.create();
    deps.tick(1000);
    store.sweep(deps.now());
    expect(store.create()?.code).toBe('1111');
  });
});

describe('a room expiring', () => {
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

  async function connect(): Promise<TestClient> {
    const client = await TestClient.connect(hub.port);
    clients.push(client);
    return client;
  }

  async function openRoom() {
    const host = await connect();
    host.send({ t: 'createRoom' });
    const { view, hostToken } = await host.expect('hosted');
    return { host, code: view.code, hostToken, displayToken: view.displayToken };
  }

  async function seatParticipant(code: string, nickname: string) {
    const client = await connect();
    client.send({ t: 'join', code, nickname });
    const { participantToken } = await client.expect('joined');
    return { client, participantToken };
  }

  async function watch(code: string, displayToken: string) {
    const display = await connect();
    display.send({ t: 'watch', code, displayToken });
    await display.expect('watching');
    return display;
  }

  it('tells the host, a participant and a display, then closes all three', async () => {
    const { host, code, displayToken } = await openRoom();
    const { client: alice } = await seatParticipant(code, 'Alice');
    await host.expect('view');
    const display = await watch(code, displayToken);

    hub.deps.tick(10_000);
    hub.sweep();

    for (const client of [host, alice, display]) {
      const frame = await client.expect('error');
      expect(frame.reason).toBe('room_expired');
      expect(frame.message).toMatch(/방/);
      expect(await client.closed).toBe(ROOM_EXPIRED_CLOSE_CODE);
    }
  });

  it('does not touch a room that is still within its time', async () => {
    const { host, code } = await openRoom();
    const { client: alice } = await seatParticipant(code, 'Alice');
    await host.expect('view');

    hub.deps.tick(9_999);
    hub.sweep();

    await host.expectQuiet();
    await alice.expectQuiet(0);
    expect(host.ws.readyState).toBe(host.ws.OPEN);
  });

  it('answers the old tokens as if the room never existed, and lets a new room take the code', async () => {
    const { host, code, hostToken, displayToken } = await openRoom();
    const { participantToken } = await seatParticipant(code, 'Alice');
    await host.expect('view');
    hub.deps.tick(10_000);
    hub.sweep();
    await host.closed;

    const stranger = await connect();
    stranger.send({ t: 'resumeHost', code, hostToken });
    await stranger.expectError('room_not_found');
    stranger.send({ t: 'join', code, nickname: 'Alice', participantToken });
    await stranger.expectError('room_not_found');
    stranger.send({ t: 'watch', code, displayToken });
    await stranger.expectError('room_not_found');

    const next = await openRoom();
    expect(next.code).toBe(code);
    expect(next.hostToken).not.toBe(hostToken);
    stranger.send({ t: 'join', code, nickname: 'Alice', participantToken });
    await stranger.expectError('bad_participant_token');
  });

  describe('keepAlive', () => {
    it('gives the host a fresh view with the full time left', async () => {
      const { host } = await openRoom();
      hub.deps.tick(6_000);
      host.send({ t: 'keepAlive' });
      const view = await host.expectView('host');
      expect(view.expiresInMs).toBe(10_000);
    });

    it('sends the fresh view to every host socket and to nobody else', async () => {
      const { host, code, hostToken } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      await host.expect('view');
      const second = await connect();
      second.send({ t: 'resumeHost', code, hostToken });
      await second.expect('hosted');
      hub.deps.tick(3_000);
      host.send({ t: 'keepAlive' });
      expect((await host.expectView('host')).expiresInMs).toBe(10_000);
      expect((await second.expectView('host')).expiresInMs).toBe(10_000);
      await alice.expectQuiet(0);
    });

    it('makes the room survive a sweep that would have removed it', async () => {
      const { host, code } = await openRoom();
      hub.deps.tick(9_000);
      host.send({ t: 'keepAlive' });
      await host.expectView('host');

      hub.deps.tick(9_000);
      hub.sweep();
      await host.expectQuiet();
      expect(hub.store.get(code)).toBeDefined();

      hub.deps.tick(1_000);
      hub.sweep();
      expect((await host.expect('error')).reason).toBe('room_expired');
      expect(hub.store.get(code)).toBeUndefined();
    });

    it('works in every stage', async () => {
      const { host, code } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      await host.expect('view');
      const stages: string[] = [];
      const keepAlive = async () => {
        hub.deps.tick(1_000);
        host.send({ t: 'keepAlive' });
        const view = await host.expectView('host');
        expect(view.expiresInMs).toBe(10_000);
        stages.push(view.stage.kind);
        return view;
      };
      await keepAlive();

      host.send({ t: 'startVote', draft });
      const voting = await host.expectView('host');
      await alice.expect('view');
      await keepAlive();

      if (voting.stage.kind !== 'voting') throw new Error('expected voting');
      host.send({ t: 'closeVote', voteId: voting.stage.vote.id });
      await host.expectView('host');
      await alice.expect('view');
      await keepAlive();
      expect(stages).toEqual(['lobby', 'voting', 'closed']);
    });

    it('is refused from a participant, an unbound socket and a display', async () => {
      const { code, displayToken } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      alice.send({ t: 'keepAlive' });
      await alice.expectError('not_host');

      const unbound = await connect();
      unbound.send({ t: 'keepAlive' });
      await unbound.expectError('not_bound');

      const display = await watch(code, displayToken);
      display.send({ t: 'keepAlive' });
      await display.expectError('not_host');
    });

    it('does not extend the room when a participant sends it', async () => {
      const { host, code } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      await host.expect('view');
      hub.deps.tick(9_000);
      alice.send({ t: 'keepAlive' });
      await alice.expectError('not_host');
      hub.deps.tick(1_000);
      hub.sweep();
      expect((await host.expect('error')).reason).toBe('room_expired');
    });
  });

  describe('what does not keep a room alive', () => {
    it('is a display connecting and disconnecting', async () => {
      const { host, code, displayToken } = await openRoom();
      hub.deps.tick(9_000);
      const display = await watch(code, displayToken);
      display.close();
      await display.closed;
      hub.deps.tick(1_000);
      hub.sweep();
      expect((await host.expect('error')).reason).toBe('room_expired');
    });

    it('is a participant disconnecting', async () => {
      const { host, code } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      await host.expect('view');
      hub.deps.tick(9_000);
      alice.close();
      await alice.closed;
      const view = await host.expectView('host');
      expect(view.participants[0]?.connected).toBe(false);
      expect(view.expiresInMs).toBe(1_000);
      hub.deps.tick(1_000);
      hub.sweep();
      expect((await host.expect('error')).reason).toBe('room_expired');
    });
  });

  describe('what keeps a room alive', () => {
    it('is the host resuming', async () => {
      const { host, code, hostToken } = await openRoom();
      host.close();
      await host.closed;
      hub.deps.tick(9_000);
      const again = await connect();
      again.send({ t: 'resumeHost', code, hostToken });
      expect((await again.expect('hosted')).view.expiresInMs).toBe(10_000);
      hub.deps.tick(9_000);
      hub.sweep();
      await again.expectQuiet();
      expect(hub.store.get(code)).toBeDefined();
    });

    it('is a participant joining and a participant resuming', async () => {
      const { host, code } = await openRoom();
      hub.deps.tick(9_000);
      const { client: alice, participantToken } = await seatParticipant(code, 'Alice');
      expect((await host.expectView('host')).expiresInMs).toBe(10_000);
      alice.close();
      await alice.closed;
      await host.expect('view');
      hub.deps.tick(9_000);
      const back = await connect();
      back.send({ t: 'join', code, nickname: 'Alice', participantToken });
      await back.expect('joined');
      expect((await host.expectView('host')).expiresInMs).toBe(10_000);
    });

    it('is a host command that the server then refuses', async () => {
      const { host, code } = await openRoom();
      hub.deps.tick(9_000);
      host.send({ t: 'closeVote', voteId: 'nothing' });
      await host.expectError('wrong_stage');
      hub.deps.tick(9_000);
      hub.sweep();
      await host.expectQuiet();
      expect(hub.store.get(code)).toBeDefined();
    });

    it('is a ballot', async () => {
      const { host, code } = await openRoom();
      const { client: alice } = await seatParticipant(code, 'Alice');
      await host.expect('view');
      host.send({ t: 'startVote', draft });
      const voting = await host.expectView('host');
      await alice.expect('view');
      if (voting.stage.kind !== 'voting') throw new Error('expected voting');
      hub.deps.tick(9_000);
      alice.send({ t: 'submitBallot', voteId: voting.stage.vote.id, content: { kind: 'text', text: 'pizza' } });
      expect((await host.expectView('host')).expiresInMs).toBe(10_000);
    });
  });
});

describe('the server sweeping on its own', () => {
  let server: RunningServer | undefined;
  let client: TestClient | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  });

  afterEach(async () => {
    client?.close();
    await server?.close();
    server = undefined;
    vi.useRealTimers();
  });

  it('closes a room once it has idled for the ttl, and stops its timer on close', async () => {
    const running = await startServer({ port: 0, ttlMs: 5_000, sweepMs: 1_000 });
    server = running;
    const host = await TestClient.connect(running.port);
    client = host;
    host.send({ t: 'createRoom' });
    expect((await host.expect('hosted')).view.expiresInMs).toBe(5_000);

    vi.advanceTimersByTime(3_000);
    await host.expectQuiet();
    vi.advanceTimersByTime(2_000);
    const frame = await host.expect('error');
    expect(frame.reason).toBe('room_expired');
    expect(await host.closed).toBe(ROOM_EXPIRED_CLOSE_CODE);

    server = undefined;
    await running.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

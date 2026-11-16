import { describe, expect, it } from 'vitest';
import { viewSchema } from '../shared/protocol.ts';
import { createRoom, isHostToken, join, RoomStore, setConnected, viewFor } from './rooms.ts';
import { fakeDeps, roomWith } from './testkit.ts';

describe('createRoom', () => {
  it('creates an empty lobby with the picked code', () => {
    const room = createRoom(fakeDeps(['0042']), new Set())!;
    expect(room.code).toBe('0042');
    expect(room.stage).toEqual({ kind: 'lobby' });
    expect(viewFor(room, { kind: 'host' }).participants).toEqual([]);
  });

  it('never reuses a code that is taken, even when the random source keeps colliding', () => {
    const room = createRoom(fakeDeps(['1111']), new Set(['1111', '1112']))!;
    expect(room.code).toBe('1113');
  });

  it('retries the random source before falling back', () => {
    const room = createRoom(fakeDeps(['1111', '1111', '2222']), new Set(['1111']))!;
    expect(room.code).toBe('2222');
  });

  it('wraps around the end of the code space when scanning', () => {
    const room = createRoom(fakeDeps(['9999']), new Set(['9999']))!;
    expect(room.code).toBe('0000');
  });

  it('returns null only when all 10000 codes are taken', () => {
    const all = Array.from({ length: 10_000 }, (_, i) => String(i).padStart(4, '0'));
    expect(createRoom(fakeDeps(['5000']), new Set(all))).toBeNull();
    const oneFree = new Set(all.filter((c) => c !== '7321'));
    expect(createRoom(fakeDeps(['5000']), oneFree)!.code).toBe('7321');
  });
});

describe('RoomStore', () => {
  it('hands out distinct codes to concurrent rooms', () => {
    const store = new RoomStore(fakeDeps(['1111']));
    const first = store.create()!;
    const second = store.create()!;
    expect(first.code).not.toBe(second.code);
    expect(store.get(first.code)).toBe(first);
  });

  it('frees a code when its room is deleted', () => {
    const store = new RoomStore(fakeDeps(['1111']));
    const first = store.create()!;
    store.delete(first.code);
    expect(store.get(first.code)).toBeUndefined();
    expect(store.create()!.code).toBe('1111');
  });
});

describe('join', () => {
  it('adds a connected participant with a normalized nickname', () => {
    const deps = fakeDeps();
    const room = roomWith(deps);
    const result = join(deps, room, { nickname: '  민지  ' });
    if (!result.ok) throw new Error(result.reason);
    expect(viewFor(result.room, { kind: 'host' }).participants).toEqual([
      { id: result.participant.id, nickname: '민지', connected: true, submitted: false },
    ]);
  });

  it.each(['', '   ', '아홉글자이름입니다요', 'a\u0000b'])('rejects invalid nickname %j', (nickname) => {
    const deps = fakeDeps();
    expect(join(deps, roomWith(deps), { nickname })).toEqual({ ok: false, reason: 'nickname_invalid' });
  });

  it('rejects duplicates regardless of case, surrounding space, and composed form', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice', '한솔');
    expect(join(deps, room, { nickname: 'aLiCe' })).toEqual({ ok: false, reason: 'nickname_taken' });
    expect(join(deps, room, { nickname: ' ALICE ' })).toEqual({ ok: false, reason: 'nickname_taken' });
    expect(join(deps, room, { nickname: '한솔'.normalize('NFD') })).toEqual({ ok: false, reason: 'nickname_taken' });
  });

  it('keeps the nickname of a disconnected participant reserved', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice');
    const id = [...room.participants.keys()][0]!;
    const away = setConnected(room, id, false, deps.now());
    expect(join(deps, away, { nickname: 'alice' })).toEqual({ ok: false, reason: 'nickname_taken' });
  });

  describe('resume with a participant token', () => {
    it('returns the same participant, reconnected, with the nickname unchanged', () => {
      const deps = fakeDeps();
      const room = roomWith(deps, 'Alice', 'Bob');
      const alice = [...room.participants.values()][0]!;
      const away = setConnected(room, alice.id, false, deps.now());

      const result = join(deps, away, { nickname: 'ignored', participantToken: alice.token });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.participant.id).toBe(alice.id);
      expect(result.participant.nickname).toBe('Alice');
      expect(result.participant.connected).toBe(true);
      expect(result.room.participants.size).toBe(2);
      expect(viewFor(result.room, { kind: 'host' }).participants.map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
    });

    it('rejects a token that matches nobody', () => {
      const deps = fakeDeps();
      const room = roomWith(deps, 'Alice');
      expect(join(deps, room, { nickname: 'Bob', participantToken: 'x'.repeat(20) })).toEqual({
        ok: false,
        reason: 'bad_participant_token',
      });
    });
  });
});

describe('setConnected', () => {
  it('flips the flag for that participant only and records activity', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice', 'Bob');
    const [alice, bob] = [...room.participants.values()];
    deps.tick(500);
    const next = setConnected(room, alice!.id, false, deps.now());
    expect(viewFor(next, { kind: 'host' }).participants.map((p) => [p.nickname, p.connected])).toEqual([
      ['Alice', false],
      ['Bob', true],
    ]);
    expect(next.lastActiveAt).toBe(deps.now());
    expect(next.lastActiveAt).toBeGreaterThan(room.lastActiveAt);
    expect(bob!.connected).toBe(true);
  });

  it('ignores an unknown participant', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice');
    expect(setConnected(room, 'nobody', false, deps.now())).toBe(room);
  });
});

describe('isHostToken', () => {
  it('accepts only the exact host token', () => {
    const room = roomWith(fakeDeps());
    expect(isHostToken(room, room.hostToken)).toBe(true);
    expect(isHostToken(room, room.hostToken + 'x')).toBe(false);
    expect(isHostToken(room, '')).toBe(false);
    expect(isHostToken(room, 'y'.repeat(room.hostToken.length))).toBe(false);
  });
});

describe('viewFor', () => {
  it('shows the host every participant with connection state', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice', 'Bob');
    const alice = [...room.participants.values()][0]!;
    const view = viewFor(setConnected(room, alice.id, false, deps.now()), { kind: 'host' });
    expect(view.role).toBe('host');
    expect(view.code).toBe(room.code);
    expect(view.participants).toEqual([
      { id: alice.id, nickname: 'Alice', connected: false, submitted: false },
      { id: expect.any(String), nickname: 'Bob', connected: true, submitted: false },
    ]);
  });

  it('shows a participant themselves plus everyone', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice', 'Bob');
    const bob = [...room.participants.values()][1]!;
    const view = viewFor(room, { kind: 'participant', id: bob.id });
    expect(view.role).toBe('participant');
    expect('me' in view && view.me).toEqual({ id: bob.id, nickname: 'Bob' });
    expect(view.participants.map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
  });

  it('never exposes any token to anyone', () => {
    const deps = fakeDeps();
    const room = roomWith(deps, 'Alice', 'Bob');
    const tokens = [room.hostToken, ...[...room.participants.values()].map((p) => p.token)];
    const views = [
      viewFor(room, { kind: 'host' }),
      ...[...room.participants.keys()].map((id) => viewFor(room, { kind: 'participant', id })),
    ];
    for (const view of views) {
      expect(viewSchema.safeParse(view).success).toBe(true);
      const wire = JSON.stringify(view);
      for (const token of tokens) expect(wire).not.toContain(token);
    }
  });
});

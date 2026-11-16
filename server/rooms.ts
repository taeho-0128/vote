import { createHash, timingSafeEqual } from 'node:crypto';
import { nicknameKey, normalizeNickname } from '../shared/nickname.ts';
import type { HostView, ParticipantView, Stage } from '../shared/protocol.ts';

export type ParticipantId = string;

export interface Participant {
  readonly id: ParticipantId;
  readonly token: string;
  readonly nickname: string;
  readonly connected: boolean;
}

export interface Room {
  readonly code: string;
  readonly hostToken: string;
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  readonly stage: Stage;
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export type Viewer = { readonly kind: 'host' } | { readonly kind: 'participant'; readonly id: ParticipantId };

export interface Deps {
  now(): number;
  randomCode(): string;
  randomToken(): string;
  randomId(): string;
}

export type JoinRequest = { readonly nickname: string; readonly participantToken?: string };

export type JoinResult =
  | { readonly ok: true; readonly room: Room; readonly participant: Participant }
  | { readonly ok: false; readonly reason: 'nickname_invalid' | 'nickname_taken' | 'bad_participant_token' };

const CODE_SPACE = 10_000;
const RANDOM_ATTEMPTS = 16;

const formatCode = (n: number): string => String(n).padStart(4, '0');

// Random retries stay cheap while rooms are sparse. The scan guarantees a free code whenever one exists.
function pickFreeCode(deps: Deps, taken: ReadonlySet<string>): string | null {
  let candidate = '';
  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
    candidate = deps.randomCode();
    if (!taken.has(candidate)) return candidate;
  }
  const start = Number.parseInt(candidate, 10) || 0;
  for (let offset = 0; offset < CODE_SPACE; offset++) {
    const code = formatCode((start + offset) % CODE_SPACE);
    if (!taken.has(code)) return code;
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function withParticipant(room: Room, participant: Participant, now: number): Room {
  const participants = new Map(room.participants).set(participant.id, participant);
  return { ...room, participants, lastActiveAt: now };
}

export function createRoom(deps: Deps, takenCodes: ReadonlySet<string>): Room | null {
  const code = pickFreeCode(deps, takenCodes);
  if (code === null) return null;
  const now = deps.now();
  return {
    code,
    hostToken: deps.randomToken(),
    participants: new Map(),
    stage: { kind: 'lobby' },
    createdAt: now,
    lastActiveAt: now,
  };
}

export function join(deps: Deps, room: Room, req: JoinRequest): JoinResult {
  if (req.participantToken !== undefined) {
    const token = req.participantToken;
    let existing: Participant | undefined;
    for (const p of room.participants.values()) {
      if (safeEqual(p.token, token)) existing = p;
    }
    if (!existing) return { ok: false, reason: 'bad_participant_token' };
    const participant = { ...existing, connected: true };
    return { ok: true, room: withParticipant(room, participant, deps.now()), participant };
  }

  const nickname = normalizeNickname(req.nickname);
  if (nickname === null) return { ok: false, reason: 'nickname_invalid' };
  const key = nicknameKey(nickname);
  for (const p of room.participants.values()) {
    if (nicknameKey(p.nickname) === key) return { ok: false, reason: 'nickname_taken' };
  }
  const participant: Participant = {
    id: deps.randomId(),
    token: deps.randomToken(),
    nickname,
    connected: true,
  };
  return { ok: true, room: withParticipant(room, participant, deps.now()), participant };
}

export function setConnected(room: Room, id: ParticipantId, connected: boolean, now: number): Room {
  const existing = room.participants.get(id);
  if (!existing) return room;
  return withParticipant(room, { ...existing, connected }, now);
}

export function isHostToken(room: Room, token: string): boolean {
  return safeEqual(room.hostToken, token);
}

export function viewFor(room: Room, viewer: { readonly kind: 'host' }): HostView;
export function viewFor(room: Room, viewer: { readonly kind: 'participant'; readonly id: ParticipantId }): ParticipantView;
export function viewFor(room: Room, viewer: Viewer): HostView | ParticipantView;
export function viewFor(room: Room, viewer: Viewer): HostView | ParticipantView {
  const participants = [...room.participants.values()].map(({ id, nickname, connected }) => ({
    id,
    nickname,
    connected,
  }));
  if (viewer.kind === 'host') {
    return { role: 'host', code: room.code, stage: room.stage, participants };
  }
  const me = room.participants.get(viewer.id);
  if (!me) throw new Error(`viewer ${viewer.id} is not in room ${room.code}`);
  return {
    role: 'participant',
    code: room.code,
    stage: room.stage,
    me: { id: me.id, nickname: me.nickname },
    participants,
  };
}

export class RoomStore {
  readonly #rooms = new Map<string, Room>();

  constructor(readonly deps: Deps) {}

  create(): Room | null {
    const room = createRoom(this.deps, new Set(this.#rooms.keys()));
    if (room) this.#rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.#rooms.get(code);
  }

  update(code: string, fn: (room: Room) => Room): Room {
    const room = this.#rooms.get(code);
    if (!room) throw new Error(`room ${code} not found`);
    const next = fn(room);
    this.#rooms.set(code, next);
    return next;
  }

  delete(code: string): void {
    this.#rooms.delete(code);
  }
}

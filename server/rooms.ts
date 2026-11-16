import { createHash, timingSafeEqual } from 'node:crypto';
import { nicknameKey, normalizeNickname } from '../shared/nickname.ts';
import type {
  DisplayReveal,
  DisplayStage,
  DisplayView,
  ErrorReason,
  HostStage,
  HostView,
  ParticipantStage,
  ParticipantSummary,
  ParticipantView,
  RevealMode,
  VotePublic,
} from '../shared/protocol.ts';
import { normalizeBallotContent, normalizeVoteDraft } from '../shared/vote.ts';
import type { BallotContent, Paper, VoteDraft } from '../shared/vote.ts';

export type ParticipantId = string;

export interface Participant {
  readonly id: ParticipantId;
  readonly token: string;
  readonly nickname: string;
  readonly connected: boolean;
}

export type Vote = VotePublic;

// Keyed by author so a second ballot from the same participant cannot be represented.
export type Ballots = ReadonlyMap<ParticipantId, Ballot>;

export interface Ballot {
  readonly participantId: ParticipantId;
  readonly content: BallotContent;
  readonly submittedAt: number;
}

export interface VoteRecord {
  readonly vote: Vote;
  readonly ballots: Ballots;
}

// `order` is the ballot authors in the random order fixed when the vote closed (D-09).
// `cursor` -1 is the folded pile, otherwise an index into `order`.
export interface Reveal {
  readonly order: readonly ParticipantId[];
  readonly cursor: number;
  readonly mode: RevealMode;
  readonly hidden: boolean;
}

export type Stage =
  | { readonly kind: 'lobby' }
  | ({ readonly kind: 'voting' } & VoteRecord)
  | ({ readonly kind: 'closed' } & VoteRecord & { readonly reveal: Reveal });

export type ClosedStage = Extract<Stage, { readonly kind: 'closed' }>;

export interface Room {
  readonly code: string;
  readonly hostToken: string;
  readonly displayToken: string;
  readonly participants: ReadonlyMap<ParticipantId, Participant>;
  readonly stage: Stage;
  readonly closedVotes: readonly VoteRecord[];
  readonly createdAt: number;
  readonly lastActiveAt: number;
}

export type Viewer =
  | { readonly kind: 'host' }
  | { readonly kind: 'participant'; readonly id: ParticipantId }
  | { readonly kind: 'display' };

export interface Deps {
  now(): number;
  randomCode(): string;
  randomToken(): string;
  randomId(): string;
  shuffle<T>(items: readonly T[]): T[];
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
    displayToken: deps.randomToken(),
    participants: new Map(),
    stage: { kind: 'lobby' },
    closedVotes: [],
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

export function isDisplayToken(room: Room, token: string): boolean {
  return safeEqual(room.displayToken, token);
}

export type Transition<R extends ErrorReason> =
  | { readonly ok: true; readonly room: Room }
  | { readonly ok: false; readonly reason: R };

const refuse = <R extends ErrorReason>(reason: R): Transition<R> => ({ ok: false, reason });

function advance(room: Room, stage: Stage, now: number): Transition<never> {
  return { ok: true, room: { ...room, stage, lastActiveAt: now } };
}

export function startVote(deps: Deps, room: Room, draft: VoteDraft): Transition<'wrong_stage' | 'bad_vote'> {
  if (room.stage.kind !== 'lobby') return refuse('wrong_stage');
  const normalized = normalizeVoteDraft(draft);
  if (!normalized.ok) return refuse('bad_vote');
  const { title, anonymity, paper } = normalized.draft;
  const vote: Vote = { id: deps.randomId(), title, anonymity, paper };
  return advance(room, { kind: 'voting', vote, ballots: new Map() }, deps.now());
}

export function submitBallot(
  deps: Deps,
  room: Room,
  participantId: ParticipantId,
  voteId: string,
  content: BallotContent,
): Transition<'wrong_stage' | 'stale_vote' | 'bad_ballot' | 'already_submitted'> {
  const { stage } = room;
  if (stage.kind !== 'voting') return refuse('wrong_stage');
  if (stage.vote.id !== voteId) return refuse('stale_vote');
  if (!room.participants.has(participantId)) throw new Error(`participant ${participantId} is not in room ${room.code}`);
  const normalized = normalizeBallotContent(content, stage.vote.paper);
  if (normalized === null) return refuse('bad_ballot');
  if (stage.ballots.has(participantId)) return refuse('already_submitted');
  const now = deps.now();
  const ballots = new Map(stage.ballots).set(participantId, { participantId, content: normalized, submittedAt: now });
  return advance(room, { kind: 'voting', vote: stage.vote, ballots }, now);
}

export function closeVote(deps: Deps, room: Room, voteId: string): Transition<'wrong_stage' | 'stale_vote'> {
  const { stage } = room;
  if (stage.kind !== 'voting') return refuse('wrong_stage');
  if (stage.vote.id !== voteId) return refuse('stale_vote');
  // Shuffling the entries keeps the stored ballots in reveal order, so a dismissed vote stays in that order too.
  const shuffled = deps.shuffle([...stage.ballots]);
  const reveal: Reveal = { order: shuffled.map(([id]) => id), cursor: -1, mode: 'one', hidden: false };
  return advance(room, { kind: 'closed', vote: stage.vote, ballots: new Map(shuffled), reveal }, deps.now());
}

type RevealRefusal = 'wrong_stage' | 'stale_vote' | 'bad_reveal';

function reviseReveal(
  deps: Deps,
  room: Room,
  voteId: string,
  revise: (reveal: Reveal, stage: ClosedStage) => Reveal | null,
): Transition<RevealRefusal> {
  const { stage } = room;
  if (stage.kind !== 'closed') return refuse('wrong_stage');
  if (stage.vote.id !== voteId) return refuse('stale_vote');
  const reveal = revise(stage.reveal, stage);
  if (reveal === null) return refuse('bad_reveal');
  return advance(room, { ...stage, reveal }, deps.now());
}

export function revealMove(deps: Deps, room: Room, voteId: string, cursor: number): Transition<RevealRefusal> {
  return reviseReveal(deps, room, voteId, (reveal) => {
    const inRange = Number.isInteger(cursor) && cursor >= -1 && cursor < reveal.order.length;
    return reveal.mode === 'one' && inRange ? { ...reveal, cursor } : null;
  });
}

// Going back to `one` keeps the cursor, so the host resumes where they were.
export function revealMode(deps: Deps, room: Room, voteId: string, mode: RevealMode): Transition<RevealRefusal> {
  return reviseReveal(deps, room, voteId, (reveal, stage) =>
    mode === 'all' && stage.vote.paper.kind !== 'choice' ? null : { ...reveal, mode },
  );
}

export function setHidden(deps: Deps, room: Room, voteId: string, hidden: boolean): Transition<RevealRefusal> {
  return reviseReveal(deps, room, voteId, (reveal) => ({ ...reveal, hidden }));
}

export function dismissVote(deps: Deps, room: Room, voteId: string): Transition<'wrong_stage' | 'stale_vote'> {
  const { stage } = room;
  if (stage.kind !== 'closed') return refuse('wrong_stage');
  if (stage.vote.id !== voteId) return refuse('stale_vote');
  const closed: VoteRecord = { vote: stage.vote, ballots: stage.ballots };
  return {
    ok: true,
    room: { ...room, stage: { kind: 'lobby' }, closedVotes: [...room.closedVotes, closed], lastActiveAt: deps.now() },
  };
}

// Only closed votes are readable, so an open vote's ballots cannot reach a view by accident (D-10).
// A closed vote's ballots are stored in their reveal order (D-09).
export function ballotsOf(room: Room, voteId: string): readonly Ballot[] | undefined {
  const records = room.stage.kind === 'closed' ? [...room.closedVotes, room.stage] : room.closedVotes;
  const record = records.find((r) => r.vote.id === voteId);
  return record && [...record.ballots.values()];
}

const NO_BALLOTS: Ballots = new Map();

const ballotsIn = (stage: Stage): Ballots => (stage.kind === 'lobby' ? NO_BALLOTS : stage.ballots);

// Fields are copied one by one so a field added to Vote later stays out of views until it is listed here.
const publicVote = ({ id, title, anonymity, paper }: Vote): VotePublic => ({ id, title, anonymity, paper });

const summariesOf = (room: Room): ParticipantSummary[] =>
  [...room.participants.values()].map(({ id, nickname, connected }) => ({ id, nickname, connected }));

function nicknameOf(room: Room, id: ParticipantId): string {
  const participant = room.participants.get(id);
  if (!participant) throw new Error(`author ${id} is not in room ${room.code}`);
  return participant.nickname;
}

const inRevealOrder = ({ ballots, reveal }: ClosedStage): Ballot[] =>
  reveal.order.map((id) => {
    const ballot = ballots.get(id);
    if (!ballot) throw new Error(`reveal order names ${id}, who has no ballot`);
    return ballot;
  });

function tallyOf(paper: Paper, ballots: readonly Ballot[]): number[] | null {
  if (paper.kind !== 'choice') return null;
  const counts = paper.options.map(() => 0);
  for (const { content } of ballots) {
    if (content.kind === 'choice') counts[content.optionIndex] = (counts[content.optionIndex] ?? 0) + 1;
  }
  return counts;
}

function hostStage(room: Room): HostStage {
  const { stage } = room;
  switch (stage.kind) {
    case 'lobby':
      return { kind: 'lobby' };
    case 'voting':
      return { kind: 'voting', vote: publicVote(stage.vote), submittedCount: stage.ballots.size };
    case 'closed': {
      const { cursor, mode, hidden } = stage.reveal;
      const ballots = inRevealOrder(stage).map(({ participantId, content }) => ({
        id: participantId,
        content,
        author: { id: participantId, nickname: nicknameOf(room, participantId) },
      }));
      return {
        kind: 'closed',
        vote: publicVote(stage.vote),
        ballotCount: stage.ballots.size,
        reveal: { cursor, mode, hidden, ballots },
      };
    }
  }
}

function participantStage(stage: Stage, submitted: boolean): ParticipantStage {
  if (stage.kind === 'lobby') return { kind: 'lobby' };
  return { kind: stage.kind, vote: publicVote(stage.vote), submitted, submittedCount: stage.ballots.size };
}

// The display is a public screen. Besides the ballot at the cursor it gets counts only, and never an author id,
// a token, or (for an anonymous vote) a nickname. Hiding (D-14) withholds the tally too, so a hidden screen shows nothing of the result.
function displayReveal(room: Room, stage: ClosedStage): DisplayReveal {
  const { cursor, mode, hidden } = stage.reveal;
  const ordered = inRevealOrder(stage);
  const ballot = cursor >= 0 && !hidden ? ordered[cursor] : undefined;
  const signed = stage.vote.anonymity === 'named';
  return {
    cursor,
    total: ordered.length,
    mode,
    hidden,
    current: ballot
      ? { content: ballot.content, signature: signed ? nicknameOf(room, ballot.participantId) : null }
      : null,
    tally: mode === 'all' && !hidden ? tallyOf(stage.vote.paper, ordered) : null,
  };
}

function displayStage(room: Room): DisplayStage {
  const { stage } = room;
  switch (stage.kind) {
    case 'lobby':
      return { kind: 'lobby', participants: summariesOf(room) };
    case 'voting':
      return {
        kind: 'voting',
        vote: publicVote(stage.vote),
        submittedCount: stage.ballots.size,
        participantCount: room.participants.size,
      };
    case 'closed':
      return { kind: 'closed', vote: publicVote(stage.vote), reveal: displayReveal(room, stage) };
  }
}

export function viewFor(room: Room, viewer: { readonly kind: 'host' }): HostView;
export function viewFor(room: Room, viewer: { readonly kind: 'participant'; readonly id: ParticipantId }): ParticipantView;
export function viewFor(room: Room, viewer: { readonly kind: 'display' }): DisplayView;
export function viewFor(room: Room, viewer: Viewer): HostView | ParticipantView | DisplayView;
export function viewFor(room: Room, viewer: Viewer): HostView | ParticipantView | DisplayView {
  const ballots = ballotsIn(room.stage);
  switch (viewer.kind) {
    case 'host':
      return {
        role: 'host',
        code: room.code,
        displayToken: room.displayToken,
        stage: hostStage(room),
        participants: summariesOf(room).map((p) => ({ ...p, submitted: ballots.has(p.id) })),
      };
    case 'participant': {
      const me = room.participants.get(viewer.id);
      if (!me) throw new Error(`viewer ${viewer.id} is not in room ${room.code}`);
      return {
        role: 'participant',
        code: room.code,
        stage: participantStage(room.stage, ballots.has(me.id)),
        me: { id: me.id, nickname: me.nickname },
        participants: summariesOf(room),
      };
    }
    case 'display':
      return { role: 'display', code: room.code, stage: displayStage(room) };
  }
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

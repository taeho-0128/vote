import { WebSocket } from 'ws';
import type { ClientOptions } from 'ws';
import { serverMsgSchema } from '../shared/protocol.ts';
import type { ErrorReason, ServerMsg, View } from '../shared/protocol.ts';
import type { BallotContent, VoteDraft } from '../shared/vote.ts';
import { closeVote, createRoom, join, startVote, submitBallot } from './rooms.ts';
import type { Deps, ParticipantId, Room, Transition } from './rooms.ts';

type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

export class TestClient {
  readonly ws: WebSocket;
  readonly raw: string[] = [];
  readonly closed: Promise<number>;
  #queue: string[] = [];
  #waiter: ((text: string) => void) | undefined;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const text = data.toString();
      this.raw.push(text);
      if (this.#waiter) {
        const waiter = this.#waiter;
        this.#waiter = undefined;
        waiter(text);
      } else {
        this.#queue.push(text);
      }
    });
    this.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    ws.on('error', () => {});
  }

  static async connect(port: number, options?: ClientOptions): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, options);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new TestClient(ws);
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async next(timeoutMs = 2000): Promise<ServerMsg> {
    const queued = this.#queue.shift();
    const text =
      queued ??
      (await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a server message')), timeoutMs);
        this.#waiter = (t) => {
          clearTimeout(timer);
          resolve(t);
        };
      }));
    return serverMsgSchema.parse(JSON.parse(text));
  }

  async expect<T extends ServerMsg['t']>(t: T): Promise<MsgOf<T>> {
    const msg = await this.next();
    if (msg.t !== t) throw new Error(`expected ${t}, got ${JSON.stringify(msg)}`);
    return msg as MsgOf<T>;
  }

  async expectView<R extends View['role']>(role: R): Promise<Extract<View, { role: R }>> {
    const { view } = await this.expect('view');
    if (view.role !== role) throw new Error(`expected a ${role} view, got ${view.role}`);
    return view as Extract<View, { role: R }>;
  }

  async expectError(reason: string): Promise<void> {
    const msg = await this.expect('error');
    if (msg.reason !== reason) throw new Error(`expected error ${reason}, got ${msg.reason}`);
  }

  async expectQuiet(ms = 150): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    if (this.#queue.length > 0) throw new Error(`unexpected message: ${this.#queue[0]}`);
  }

  close(): void {
    this.ws.terminate();
  }
}

export function fakeDeps(codes: string[] = ['1234']): Deps & { tick(ms: number): void } {
  let clock = 1_000;
  let n = 0;
  let codeIndex = 0;
  return {
    now: () => clock,
    tick: (ms) => {
      clock += ms;
    },
    randomCode: () => codes[Math.min(codeIndex++, codes.length - 1)]!,
    randomToken: () => `token-${String(++n).padStart(16, '0')}`,
    randomId: () => `id-${n++}`,
    shuffle: (items) => [...items].reverse(),
  };
}

export function must(result: Transition<ErrorReason>): Room {
  if (!result.ok) throw new Error(`setup refused: ${result.reason}`);
  return result.room;
}

export function voteIdOf(room: Room): string {
  if (room.stage.kind === 'lobby') throw new Error('no vote is open');
  return room.stage.vote.id;
}

export const NICKNAMES = ['Alice', 'Bobby', 'Carol', 'Dmitri', 'Elena'] as const;

// Participant i submits contents[i], then the vote closes. With fakeDeps the reveal order is the submission order reversed.
export function closedRoom(deps: Deps, draft: VoteDraft, contents: readonly BallotContent[]) {
  const lobby = roomWith(deps, ...NICKNAMES.slice(0, Math.max(contents.length, 1)));
  const ids: ParticipantId[] = [...lobby.participants.keys()];
  const voting = must(startVote(deps, lobby, draft));
  const voteId = voteIdOf(voting);
  const submitted = contents.reduce((room, content, i) => must(submitBallot(deps, room, ids[i]!, voteId, content)), voting);
  return { lobby, voting, submitted, closed: must(closeVote(deps, submitted, voteId)), voteId, ids };
}

export function roomWith(deps: Deps, ...nicknames: string[]): Room {
  let room = createRoom(deps, new Set())!;
  for (const nickname of nicknames) {
    const result = join(deps, room, { nickname });
    if (!result.ok) throw new Error(`setup join failed: ${result.reason}`);
    room = result.room;
  }
  return room;
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INK_HEIGHT, INK_MAX_POINTS, INK_MAX_STROKES, INK_WIDTH } from '../shared/ink.ts';
import type { InkStroke } from '../shared/ink.ts';
import { viewSchema } from '../shared/protocol.ts';
import type { ErrorReason } from '../shared/protocol.ts';
import type { BallotContent, Paper, VoteDraft } from '../shared/vote.ts';
import { MAX_PAYLOAD_BYTES, startServer } from './app.ts';
import type { RunningServer } from './app.ts';
import { ballotsOf, closeVote, dismissVote, startVote, submitBallot, viewFor } from './rooms.ts';
import type { Room, Transition } from './rooms.ts';
import { LIFETIME, TestClient, fakeDeps, roomWith } from './testkit.ts';

type Point = readonly [number, number];

const scribble = (i: number): Point => [100 + ((i * 7) % 901), 1000 + ((i * 13) % 334)];
const widest = (): Point => [INK_WIDTH, INK_HEIGHT];

function strokesOf(count: number, total: number, point: (i: number) => Point = scribble): InkStroke[] {
  let i = 0;
  return Array.from({ length: count }, (_, s) => {
    const n = Math.floor(total / count) + (s < total % count ? 1 : 0);
    const pts: number[] = [];
    for (let k = 0; k < n; k++) pts.push(...point(i++));
    return { w: s % 2 === 0 ? 'thin' : 'thick', pts };
  });
}

const ink = (strokes: InkStroke[]): BallotContent => ({ kind: 'ink', strokes });
const text = (t: string): BallotContent => ({ kind: 'text', text: t });
const ballotMsg = (voteId: string, content: unknown) => ({ t: 'submitBallot', voteId, content });

const freeform: VoteDraft = { title: '손글씨', paper: { kind: 'freeform' }, anonymity: 'anonymous' };
const lunch: VoteDraft = { title: '점심', paper: { kind: 'choice', options: ['김밥', '라면'] }, anonymity: 'named' };

describe('ink ballots in the domain', () => {
  const must = (result: Transition<ErrorReason>): Room => {
    if (!result.ok) throw new Error(`setup refused: ${result.reason}`);
    return result.room;
  };
  const voteIdOf = (room: Room): string => {
    if (room.stage.kind === 'lobby') throw new Error('no vote');
    return room.stage.vote.id;
  };

  function setup(draft: VoteDraft = freeform) {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice', 'Bob');
    const voting = must(startVote(deps, lobby, draft));
    return { deps, lobby, voting, voteId: voteIdOf(voting), ids: [...lobby.participants.keys()] };
  }

  it('stores the strokes of a free-form ink ballot and returns them unchanged after close and dismiss', () => {
    const { deps, voting, voteId, ids } = setup();
    const strokes = strokesOf(3, 120);
    const closed = must(closeVote(deps, must(submitBallot(deps, voting, ids[0]!, voteId, ink(strokes))), voteId));

    expect(ballotsOf(closed, voteId)).toEqual([{ participantId: ids[0], content: ink(strokes), submittedAt: expect.any(Number) }]);
    const lobby = must(dismissVote(deps, closed, voteId));
    expect(ballotsOf(lobby, voteId)?.[0]?.content).toEqual(ink(strokes));
  });

  it('accepts the full limits: 5000 points over 300 strokes', () => {
    const { deps, voting, voteId, ids } = setup();
    const strokes = strokesOf(INK_MAX_STROKES, INK_MAX_POINTS, widest);
    expect(submitBallot(deps, voting, ids[0]!, voteId, ink(strokes)).ok).toBe(true);
  });

  it.each([
    ['an ink ballot on a multiple-choice paper', lunch, ink(strokesOf(1, 10))],
    ['an empty stroke list', freeform, ink([])],
    ['more than 5000 points', freeform, ink(strokesOf(3, INK_MAX_POINTS + 1))],
    ['an x coordinate past the paper width', freeform, ink([{ w: 'thin', pts: [INK_WIDTH + 1, 10, 20, 30] }])],
  ])('refuses %s with bad_ballot and records nothing', (_, draft, content) => {
    const { deps, voting, voteId, ids } = setup(draft);
    expect(submitBallot(deps, voting, ids[0]!, voteId, content)).toEqual({ ok: false, reason: 'bad_ballot' });
    expect(viewFor(voting, { kind: 'host' }, LIFETIME).stage).toMatchObject({ submittedCount: 0 });
  });

  it('stores a text ballot and an ink ballot from two participants of one vote', () => {
    const { deps, voting, voteId, ids } = setup();
    const strokes = strokesOf(2, 40);
    const room = must(submitBallot(deps, must(submitBallot(deps, voting, ids[0]!, voteId, text('글'))), ids[1]!, voteId, ink(strokes)));
    const closed = must(closeVote(deps, room, voteId));

    expect(ballotsOf(closed, voteId)?.map((b) => [b.participantId, b.content])).toEqual([
      [ids[1], ink(strokes)],
      [ids[0], text('글')],
    ]);
  });

  it.each([
    ['ink after text', text('글'), ink(strokesOf(1, 10))],
    ['text after ink', ink(strokesOf(1, 10)), text('글')],
    ['ink after ink', ink(strokesOf(1, 10)), ink(strokesOf(2, 10))],
  ])('refuses %s from the same participant with already_submitted and keeps the first', (_, first, second) => {
    const { deps, voting, voteId, ids } = setup();
    const once = must(submitBallot(deps, voting, ids[0]!, voteId, first));
    expect(submitBallot(deps, once, ids[0]!, voteId, second)).toEqual({ ok: false, reason: 'already_submitted' });
    expect(ballotsOf(must(closeVote(deps, once, voteId)), voteId)?.map((b) => b.content)).toEqual([first]);
  });

  it('carries stroke coordinates only in the host view of the closed vote', () => {
    const { deps, lobby, voting, voteId, ids } = setup();
    const submitted = must(submitBallot(deps, voting, ids[0]!, voteId, ink([{ w: 'thin', pts: [731, 1297, 888, 1111] }])));
    const closed = must(closeVote(deps, submitted, voteId));
    const lobbyAgain = must(dismissVote(deps, closed, voteId));

    for (const room of [lobby, voting, submitted, closed, lobbyAgain]) {
      for (const view of [viewFor(room, { kind: 'host' }, LIFETIME), ...ids.map((id) => viewFor(room, { kind: 'participant', id }))]) {
        expect(viewSchema.safeParse(view).success).toBe(true);
        const wire = JSON.stringify(view);
        const hostSeesBallots = view.role === 'host' && room === closed;
        for (const leak of ['731', '1297', '888', '1111', 'pts', 'strokes']) expect(wire.includes(leak)).toBe(hostSeesBallots);
      }
    }
  });
});

describe('ink ballots over a real socket', () => {
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

  async function openVote(paper: Paper, ...nicknames: string[]) {
    const host = await connect();
    host.send({ t: 'createRoom' });
    const { view } = await host.expect('hosted');
    const guests: TestClient[] = [];
    for (const nickname of nicknames) {
      const guest = await connect();
      guest.send({ t: 'join', code: view.code, nickname });
      await guest.expect('joined');
      await host.expect('view');
      for (const earlier of guests) await earlier.expect('view');
      guests.push(guest);
    }
    host.send({ t: 'startVote', draft: { ...freeform, paper } });
    const opened = (await host.expect('view')).view;
    for (const guest of guests) await guest.expect('view');
    if (opened.role !== 'host' || opened.stage.kind !== 'voting') throw new Error('vote did not open');
    return { host, guests, voteId: opened.stage.vote.id };
  }

  const submittedCount = async (host: TestClient): Promise<number | undefined> => {
    const { view } = await host.expect('view');
    return view.role === 'host' && view.stage.kind === 'voting' ? view.stage.submittedCount : undefined;
  };

  it('accepts a ~40 KB ink ballot, counts it, and sends no stroke to anyone but the host after close', async () => {
    const { host, guests, voteId } = await openVote({ kind: 'freeform' }, 'Pen');
    const [pen] = guests as [TestClient];
    const message = ballotMsg(voteId, ink(strokesOf(2, 4000)));
    const bytes = Buffer.byteLength(JSON.stringify(message));
    expect(bytes).toBeGreaterThan(35_000);
    expect(bytes).toBeLessThan(45_000);

    pen.send(message);
    expect(await submittedCount(host)).toBe(1);
    expect((await pen.expect('view')).view).toMatchObject({ stage: { kind: 'voting', submitted: true } });
    expect(pen.ws.readyState).toBe(pen.ws.OPEN);

    host.send({ t: 'closeVote', voteId });
    expect((await host.expect('view')).view).toMatchObject({ stage: { kind: 'closed', ballotCount: 1 } });
    await pen.expect('view');

    const [first] = scribble(0);
    const closedFrame = host.raw.at(-1)!;
    expect(closedFrame).toContain(`[${first},`);
    for (const raw of [...host.raw.slice(0, -1), ...pen.raw]) {
      expect(raw).not.toContain('pts');
      expect(raw).not.toContain('strokes');
      expect(raw).not.toContain(`${first},`);
    }
  });

  it('accepts the largest legal ballot, which is under the size cap', async () => {
    const { host, guests, voteId } = await openVote({ kind: 'freeform' }, 'Pen');
    const message = ballotMsg(voteId, ink(strokesOf(INK_MAX_STROKES, INK_MAX_POINTS, widest)));
    const bytes = Buffer.byteLength(JSON.stringify(message));
    expect(bytes).toBeGreaterThan(50_000);
    expect(bytes).toBeLessThan(MAX_PAYLOAD_BYTES);

    guests[0]!.send(message);
    expect(await submittedCount(host)).toBe(1);
  });

  it('refuses ink that breaks a limit with bad_ballot, then still takes a valid one', async () => {
    const { host, guests, voteId } = await openVote({ kind: 'freeform' }, 'Pen');
    const [pen] = guests as [TestClient];

    for (const strokes of [[], strokesOf(3, INK_MAX_POINTS + 1)]) {
      pen.send(ballotMsg(voteId, ink(strokes)));
      await pen.expectError('bad_ballot');
    }
    await host.expectQuiet();

    pen.send(ballotMsg(voteId, ink(strokesOf(1, 50))));
    expect(await submittedCount(host)).toBe(1);
  });

  it('refuses ink on a multiple-choice paper with bad_ballot', async () => {
    const { host, guests, voteId } = await openVote({ kind: 'choice', options: ['김밥', '라면'] }, 'Pen');
    guests[0]!.send(ballotMsg(voteId, ink(strokesOf(1, 10))));
    await guests[0]!.expectError('bad_ballot');
    await host.expectQuiet();
  });

  it.each([
    ['a pts list of odd length', [{ w: 'thin', pts: [1, 2, 3] }]],
    ['a y coordinate above 1333', [{ w: 'thin', pts: [1, 2, 3, INK_HEIGHT + 1] }]],
    ['an x coordinate above 1333', [{ w: 'thin', pts: [INK_HEIGHT + 1, 2, 3, 4] }]],
    ['a negative coordinate', [{ w: 'thin', pts: [1, 2, -3, 4] }]],
    ['a fractional coordinate', [{ w: 'thin', pts: [1, 2, 3.5, 4] }]],
    ['a single-number pts list', [{ w: 'thin', pts: [1] }]],
    ['an unknown pen width', [{ w: 'medium', pts: [1, 2, 3, 4] }]],
    ['more than 2000 points in one stroke', [{ w: 'thin', pts: new Array<number>(4002).fill(5) }]],
  ])('answers %s with bad_message and keeps the socket open', async (_, strokes) => {
    const { host, guests, voteId } = await openVote({ kind: 'freeform' }, 'Pen');
    const [pen] = guests as [TestClient];

    pen.send(ballotMsg(voteId, { kind: 'ink', strokes }));
    await pen.expectError('bad_message');
    expect(pen.ws.readyState).toBe(pen.ws.OPEN);
    await host.expectQuiet();

    pen.send(ballotMsg(voteId, ink(strokesOf(1, 10))));
    expect(await submittedCount(host)).toBe(1);
  });

  it('counts a text ballot and an ink ballot from two participants, and refuses a second ballot from one', async () => {
    const { host, guests, voteId } = await openVote({ kind: 'freeform' }, 'Alice', 'Bob');
    const [alice, bob] = guests as [TestClient, TestClient];

    alice.send(ballotMsg(voteId, text('글로 냈어요')));
    expect(await submittedCount(host)).toBe(1);
    await Promise.all([alice.expect('view'), bob.expect('view')]);

    bob.send(ballotMsg(voteId, ink(strokesOf(2, 200))));
    expect(await submittedCount(host)).toBe(2);
    await Promise.all([alice.expect('view'), bob.expect('view')]);

    bob.send(ballotMsg(voteId, text('또 낼래요')));
    await bob.expectError('already_submitted');
    alice.send(ballotMsg(voteId, ink(strokesOf(1, 10))));
    await alice.expectError('already_submitted');
    await host.expectQuiet();

    host.send({ t: 'closeVote', voteId });
    expect((await host.expect('view')).view).toMatchObject({ stage: { kind: 'closed', ballotCount: 2 } });
  });
});

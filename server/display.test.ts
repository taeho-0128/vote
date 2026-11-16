import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DisplayView, HostView, ServerMsg } from '../shared/protocol.ts';
import type { VoteDraft } from '../shared/vote.ts';
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

const secretFreeform: VoteDraft = { title: '이번 달 MVP는?', paper: { kind: 'freeform' }, anonymity: 'anonymous' };
const lunch: VoteDraft = { title: '점심', paper: { kind: 'choice', options: ['김밥', '라면'] }, anonymity: 'named' };

async function watcher(code: string, displayToken: string) {
  const client = await connect();
  client.send({ t: 'watch', code, displayToken });
  const { view } = await client.expect('watching');
  return { client, view };
}

// Alice and Bobby join, then two displays watch. Nobody has an unread message afterwards.
async function world() {
  const host = await connect();
  host.send({ t: 'createRoom' });
  const hosted = await host.expect('hosted');
  const { code, displayToken } = hosted.view;

  const guests: TestClient[] = [];
  for (const nickname of ['Alice', 'Bobby']) {
    const guest = await connect();
    guest.send({ t: 'join', code, nickname });
    await guest.expect('joined');
    await host.expectView('host');
    for (const earlier of guests) await earlier.expectView('participant');
    guests.push(guest);
  }
  const d1 = await watcher(code, displayToken);
  const d2 = await watcher(code, displayToken);
  return { host, alice: guests[0]!, bob: guests[1]!, d1: d1.client, d2: d2.client, code, displayToken, hostToken: hosted.hostToken };
}
type World = Awaited<ReturnType<typeof world>>;

async function step(w: World) {
  const [host, alice, bob, d1, d2] = await Promise.all([
    w.host.expectView('host'),
    w.alice.expectView('participant'),
    w.bob.expectView('participant'),
    w.d1.expectView('display'),
    w.d2.expectView('display'),
  ]);
  return { host, alice, bob, d1, d2 };
}

async function startAndClose(w: World, draft: VoteDraft, aliceBallot: object, bobBallot: object) {
  w.host.send({ t: 'startVote', draft });
  const opened = (await step(w)).host;
  if (opened.stage.kind !== 'voting') throw new Error('vote did not open');
  const voteId = opened.stage.vote.id;
  w.alice.send({ t: 'submitBallot', voteId, content: aliceBallot });
  await step(w);
  w.bob.send({ t: 'submitBallot', voteId, content: bobBallot });
  await step(w);
  w.host.send({ t: 'closeVote', voteId });
  return { voteId, closed: await step(w) };
}

const hostReveal = (view: HostView) => {
  if (view.stage.kind !== 'closed') throw new Error('expected a closed host view');
  return view.stage.reveal;
};
const displayReveal = (view: DisplayView) => {
  if (view.stage.kind !== 'closed') throw new Error('expected a closed display view');
  return view.stage.reveal;
};
const frames = (c: TestClient): ServerMsg[] => c.raw.map((r) => JSON.parse(r) as ServerMsg);
const stageKind = (msg: ServerMsg) => ('view' in msg ? msg.view.stage.kind : null);

describe('a whole anonymous vote with a host, two participants and two displays', () => {
  it('opens ballots one at a time, the same on every display and on the host', async () => {
    const w = await world();
    const text = (t: string) => ({ kind: 'text', text: t });
    const { voteId, closed } = await startAndClose(w, secretFreeform, text('비밀문장-ALPHA'), text('비밀문장-BRAVO'));

    const papers = hostReveal(closed.host).ballots;
    expect(papers.map((b) => b.author.nickname).sort()).toEqual(['Alice', 'Bobby']);
    for (const display of [closed.d1, closed.d2]) {
      expect(displayReveal(display)).toEqual({ cursor: -1, total: 2, mode: 'one', hidden: false, current: null, tally: null });
    }

    for (const cursor of [0, 1, 0]) {
      w.host.send({ t: 'revealMove', voteId, cursor });
      const seen = await step(w);
      expect(hostReveal(seen.host).cursor).toBe(cursor);
      expect(hostReveal(seen.host).ballots).toEqual(papers);
      expect(seen.d1).toEqual(seen.d2);
      expect(displayReveal(seen.d1)).toMatchObject({ cursor, current: { content: papers[cursor]!.content, signature: null } });
    }

    w.host.send({ t: 'setHidden', voteId, hidden: true });
    const hidden = await step(w);
    for (const display of [hidden.d1, hidden.d2]) {
      expect(displayReveal(display)).toMatchObject({ cursor: 0, hidden: true, current: null, tally: null });
    }
    expect(hostReveal(hidden.host)).toMatchObject({ cursor: 0, hidden: true });
    expect(hostReveal(hidden.host).ballots).toEqual(papers);
    expect(hidden.alice.stage.kind).toBe('closed');

    w.host.send({ t: 'setHidden', voteId, hidden: false });
    const shown = await step(w);
    expect(displayReveal(shown.d1).current?.content).toEqual(papers[0]!.content);
  });

  it('never sends a display a nickname, an author id, a token or an unopened ballot after the lobby', async () => {
    const w = await world();
    const text = (t: string) => ({ kind: 'text', text: t });
    const { voteId } = await startAndClose(w, secretFreeform, text('비밀문장-ALPHA'), text('비밀문장-BRAVO'));
    w.host.send({ t: 'revealMove', voteId, cursor: 0 });
    const first = await step(w);
    const openedContent = displayReveal(first.d1).current!.content;
    const opened = openedContent.kind === 'text' ? openedContent.text : '';
    w.host.send({ t: 'setHidden', voteId, hidden: true });
    await step(w);
    w.host.send({ t: 'dismissVote', voteId });
    await step(w);

    const ids = [w.alice, w.bob].map((c) => {
      const joined = frames(c).find((m) => m.t === 'joined');
      if (joined?.t !== 'joined') throw new Error('no joined frame');
      return joined.view.me.id;
    });
    for (const display of [w.d1, w.d2]) {
      for (const msg of frames(display)) {
        const raw = JSON.stringify(msg);
        for (const secret of [w.hostToken, w.displayToken]) expect(raw).not.toContain(secret);
        if (stageKind(msg) === 'lobby') continue;
        for (const nickname of ['Alice', 'Bobby']) expect(raw).not.toContain(nickname);
        for (const id of ids) expect(raw).not.toContain(id);
        const unopened = opened.includes('ALPHA') ? 'BRAVO' : 'ALPHA';
        expect(raw).not.toContain(unopened);
      }
      const withOpened = display.raw.filter((r) => r.includes(opened));
      expect(withOpened).toHaveLength(1);
    }
  });

  it('keeps participants out of the reveal entirely', async () => {
    const w = await world();
    const { voteId } = await startAndClose(w, secretFreeform, { kind: 'text', text: 'ALPHA' }, { kind: 'text', text: 'BRAVO' });
    w.host.send({ t: 'revealMove', voteId, cursor: 1 });
    const seen = await step(w);
    for (const view of [seen.alice, seen.bob]) {
      expect(view.stage).toMatchObject({ kind: 'closed', submitted: true, submittedCount: 2 });
      expect(JSON.stringify(view)).not.toMatch(/ALPHA|BRAVO|reveal|cursor/);
    }
  });
});

describe('a named multiple-choice vote', () => {
  it('shows the signature one paper at a time and the tally only when every paper is open', async () => {
    const w = await world();
    const { voteId, closed } = await startAndClose(w, lunch, { kind: 'choice', optionIndex: 0 }, { kind: 'choice', optionIndex: 0 });
    const papers = hostReveal(closed.host).ballots;

    w.host.send({ t: 'revealMove', voteId, cursor: 0 });
    const one = await step(w);
    expect(displayReveal(one.d1)).toMatchObject({
      current: { content: { kind: 'choice', optionIndex: 0 }, signature: papers[0]!.author.nickname },
      tally: null,
    });

    w.host.send({ t: 'revealMode', voteId, mode: 'all' });
    const all = await step(w);
    for (const display of [all.d1, all.d2]) expect(displayReveal(display)).toMatchObject({ mode: 'all', tally: [2, 0] });

    w.host.send({ t: 'revealMove', voteId, cursor: 1 });
    await w.host.expectError('bad_reveal');

    w.host.send({ t: 'setHidden', voteId, hidden: true });
    const hidden = await step(w);
    expect(displayReveal(hidden.d1)).toMatchObject({ mode: 'all', current: null, tally: null });

    w.host.send({ t: 'revealMode', voteId, mode: 'one' });
    const back = await step(w);
    expect(hostReveal(back.host)).toMatchObject({ cursor: 0, mode: 'one' });
    expect(displayReveal(back.d1).tally).toBeNull();
  });

  it('refuses all on a free-form vote with bad_reveal and sends nothing to anyone else', async () => {
    const w = await world();
    const { voteId } = await startAndClose(w, secretFreeform, { kind: 'text', text: 'a' }, { kind: 'text', text: 'b' });
    w.host.send({ t: 'revealMode', voteId, mode: 'all' });
    await w.host.expectError('bad_reveal');
    for (const c of [w.host, w.alice, w.bob, w.d1, w.d2]) await c.expectQuiet();
  });
});

describe('watching', () => {
  it('answers a wrong token with bad_display_token and an unknown room with room_not_found, then still lets the socket in', async () => {
    const w = await world();
    const stranger = await connect();
    stranger.send({ t: 'watch', code: w.code, displayToken: 'z'.repeat(24) });
    await stranger.expectError('bad_display_token');
    stranger.send({ t: 'watch', code: w.code, displayToken: w.hostToken });
    await stranger.expectError('bad_display_token');
    stranger.send({ t: 'watch', code: w.code === '0000' ? '0001' : '0000', displayToken: w.displayToken });
    await stranger.expectError('room_not_found');
    stranger.send({ t: 'watch', code: w.code, displayToken: 'short' });
    await stranger.expectError('bad_message');

    stranger.send({ t: 'watch', code: w.code, displayToken: w.displayToken });
    expect((await stranger.expect('watching')).view.role).toBe('display');
  });

  it('tells a display nothing about which token was wrong once it is bound', async () => {
    const w = await world();
    w.d1.send({ t: 'watch', code: w.code, displayToken: 'z'.repeat(24) });
    await w.d1.expectError('already_bound');
  });

  it('gives a display that arrives late the current state at once', async () => {
    const w = await world();
    const { voteId, closed } = await startAndClose(w, lunch, { kind: 'choice', optionIndex: 1 }, { kind: 'choice', optionIndex: 0 });
    const papers = hostReveal(closed.host).ballots;
    w.host.send({ t: 'revealMove', voteId, cursor: 1 });
    await step(w);

    const late = await watcher(w.code, w.displayToken);
    expect(displayReveal(late.view)).toMatchObject({
      cursor: 1,
      total: 2,
      current: { content: papers[1]!.content, signature: papers[1]!.author.nickname },
    });

    w.host.send({ t: 'revealMove', voteId, cursor: 0 });
    await step(w);
    expect(displayReveal(await late.client.expectView('display'))).toMatchObject({ cursor: 0 });
  });

  it('keeps the lobby list on a display current as people join and leave', async () => {
    const w = await world();
    const carol = await connect();
    carol.send({ t: 'join', code: w.code, nickname: 'Carol' });
    await carol.expect('joined');
    const joined = await w.d1.expectView('display');
    expect(joined.stage).toMatchObject({ kind: 'lobby', participants: [{ nickname: 'Alice' }, { nickname: 'Bobby' }, { nickname: 'Carol', connected: true }] });
    await w.d2.expectView('display');

    carol.close();
    await carol.closed;
    const left = await w.d1.expectView('display');
    expect(left.stage).toMatchObject({ kind: 'lobby', participants: [{}, {}, { nickname: 'Carol', connected: false }] });
  });

  it('shows the count and the number of participants while voting, and nobody by name', async () => {
    const w = await world();
    w.host.send({ t: 'startVote', draft: lunch });
    const opened = await step(w);
    expect(opened.d1.stage).toEqual({
      kind: 'voting',
      vote: expect.objectContaining({ title: '점심', anonymity: 'named' }),
      submittedCount: 0,
      participantCount: 2,
    });
    expect(JSON.stringify(opened.d1)).not.toMatch(/Alice|Bobby/);
  });

  it('leaves the room alone when a display disconnects', async () => {
    const w = await world();
    w.d1.close();
    await w.d1.closed;
    for (const c of [w.host, w.alice, w.bob, w.d2]) await c.expectQuiet();
  });
});

describe('who may command', () => {
  const commands = [
    { t: 'startVote', draft: secretFreeform },
    { t: 'closeVote', voteId: 'x' },
    { t: 'dismissVote', voteId: 'x' },
    { t: 'submitBallot', voteId: 'x', content: { kind: 'text', text: 'hi' } },
    { t: 'revealMove', voteId: 'x', cursor: 0 },
    { t: 'revealMode', voteId: 'x', mode: 'one' },
    { t: 'setHidden', voteId: 'x', hidden: true },
  ];

  it('answers every command from a display with not_host and changes nothing', async () => {
    const w = await world();
    const { voteId } = await startAndClose(w, secretFreeform, { kind: 'text', text: 'a' }, { kind: 'text', text: 'b' });
    for (const cmd of commands) {
      w.d1.send(cmd);
      await w.d1.expectError('not_host');
      if ('voteId' in cmd) {
        w.d1.send({ ...cmd, voteId });
        await w.d1.expectError('not_host');
      }
    }
    for (const c of [w.host, w.alice, w.bob, w.d2]) await c.expectQuiet();

    w.host.send({ t: 'revealMove', voteId, cursor: 0 });
    const next = await step(w);
    expect(hostReveal(next.host)).toMatchObject({ cursor: 0, hidden: false });
  });

  it('keeps already_bound for createRoom, resumeHost, join and watch on a bound display, host and participant', async () => {
    const w = await world();
    const binders = [
      { t: 'createRoom' },
      { t: 'resumeHost', code: w.code, hostToken: w.hostToken },
      { t: 'join', code: w.code, nickname: 'Zed' },
      { t: 'watch', code: w.code, displayToken: w.displayToken },
    ];
    for (const c of [w.d1, w.host, w.alice]) {
      for (const msg of binders) {
        c.send(msg);
        await c.expectError('already_bound');
      }
    }
    for (const c of [w.host, w.alice, w.bob, w.d1, w.d2]) await c.expectQuiet();
  });

  it('refuses the reveal commands from a participant with not_host and from an unbound socket with not_bound', async () => {
    const w = await world();
    const { voteId } = await startAndClose(w, secretFreeform, { kind: 'text', text: 'a' }, { kind: 'text', text: 'b' });
    const reveal = [
      { t: 'revealMove', voteId, cursor: 0 },
      { t: 'revealMode', voteId, mode: 'one' },
      { t: 'setHidden', voteId, hidden: true },
    ];
    const stranger = await connect();
    for (const msg of reveal) {
      w.alice.send(msg);
      await w.alice.expectError('not_host');
      stranger.send(msg);
      await stranger.expectError('not_bound');
    }
    for (const c of [w.host, w.bob, w.d1, w.d2]) await c.expectQuiet();
  });

  it('refuses a reveal command in the wrong stage, for a stale vote, or out of range without broadcasting', async () => {
    const w = await world();
    w.host.send({ t: 'revealMove', voteId: 'x', cursor: 0 });
    await w.host.expectError('wrong_stage');

    const { voteId } = await startAndClose(w, secretFreeform, { kind: 'text', text: 'a' }, { kind: 'text', text: 'b' });
    w.host.send({ t: 'setHidden', voteId: 'old', hidden: true });
    await w.host.expectError('stale_vote');
    w.host.send({ t: 'revealMove', voteId, cursor: 2 });
    await w.host.expectError('bad_reveal');
    w.host.send({ t: 'revealMove', voteId, cursor: -2 });
    await w.host.expectError('bad_message');
    for (const c of [w.host, w.alice, w.bob, w.d1, w.d2]) await c.expectQuiet();
  });
});

describe('the host reloading', () => {
  it('returns to the same reveal state, display token included', async () => {
    const w = await world();
    const { voteId } = await startAndClose(w, lunch, { kind: 'choice', optionIndex: 0 }, { kind: 'choice', optionIndex: 1 });
    w.host.send({ t: 'revealMove', voteId, cursor: 1 });
    await step(w);
    w.host.send({ t: 'setHidden', voteId, hidden: true });
    const before = (await step(w)).host;

    w.host.close();
    await w.host.closed;
    const again = await connect();
    again.send({ t: 'resumeHost', code: w.code, hostToken: w.hostToken });
    const { view } = await again.expect('hosted');

    expect(view).toEqual(before);
    expect(hostReveal(view)).toMatchObject({ cursor: 1, mode: 'one', hidden: true });
    expect(view.displayToken).toBe(w.displayToken);
  });
});

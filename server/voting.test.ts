import { describe, expect, it } from 'vitest';
import { viewSchema } from '../shared/protocol.ts';
import type { ErrorReason } from '../shared/protocol.ts';
import type { BallotContent, VoteDraft } from '../shared/vote.ts';
import { ballotsOf, closeVote, dismissVote, join, setConnected, startVote, submitBallot, viewFor } from './rooms.ts';
import type { Deps, ParticipantId, Room, Transition } from './rooms.ts';
import { fakeDeps, roomWith } from './testkit.ts';

const freeform: VoteDraft = { title: '이번 달 MVP는?', paper: { kind: 'freeform' }, anonymity: 'anonymous' };
const lunch: VoteDraft = { title: '점심', paper: { kind: 'choice', options: ['김밥', '라면', '비빔밥'] }, anonymity: 'named' };
const text = (t: string): BallotContent => ({ kind: 'text', text: t });
const pick = (optionIndex: number): BallotContent => ({ kind: 'choice', optionIndex });

function must(result: Transition<ErrorReason>): Room {
  if (!result.ok) throw new Error(`setup refused: ${result.reason}`);
  return result.room;
}

const idsOf = (room: Room): ParticipantId[] => [...room.participants.keys()];
const voteIdOf = (room: Room): string => {
  if (room.stage.kind === 'lobby') throw new Error('no vote');
  return room.stage.vote.id;
};
const hostStage = (room: Room) => viewFor(room, { kind: 'host' }).stage;

function setup(draft: VoteDraft = freeform, ...nicknames: string[]) {
  const deps = fakeDeps();
  const lobby = roomWith(deps, ...(nicknames.length ? nicknames : ['Alice', 'Bob', 'Cara']));
  const voting = must(startVote(deps, lobby, draft));
  const closed = must(closeVote(deps, voting, voteIdOf(voting)));
  return { deps, lobby, voting, closed, voteId: voteIdOf(voting), ids: idsOf(lobby) };
}

describe('startVote', () => {
  it('opens the vote with a generated id and the cleaned-up draft', () => {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice');
    const room = must(startVote(deps, lobby, { ...lunch, title: '  점심 뭐 먹지?  ' }));
    const stage = hostStage(room);
    expect(stage).toEqual({
      kind: 'voting',
      vote: { id: expect.any(String), title: '점심 뭐 먹지?', anonymity: 'named', paper: lunch.paper },
      submittedCount: 0,
    });
  });

  it('gives every vote its own id', () => {
    const { deps, closed, voteId } = setup();
    const next = must(startVote(deps, must(dismissVote(deps, closed, voteId)), freeform));
    expect(voteIdOf(next)).not.toBe(voteId);
  });

  it.each([
    ['an empty title', { ...freeform, title: '   ' }],
    ['a single option', { ...lunch, paper: { kind: 'choice' as const, options: ['하나'] } }],
    ['duplicate options', { ...lunch, paper: { kind: 'choice' as const, options: ['김밥', ' 김밥 '] } }],
  ])('refuses %s with bad_vote and stays in the lobby', (_, draft) => {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice');
    expect(startVote(deps, lobby, draft)).toEqual({ ok: false, reason: 'bad_vote' });
    expect(lobby.stage).toEqual({ kind: 'lobby' });
  });
});

describe('transitions out of order', () => {
  const stages = ['lobby', 'voting', 'closed'] as const;
  const legal = { startVote: 'lobby', submitBallot: 'voting', closeVote: 'voting', dismissVote: 'closed' } as const;

  const commands = {
    startVote: (deps: Deps, room: Room) => startVote(deps, room, freeform),
    submitBallot: (deps: Deps, room: Room, ids: ParticipantId[], voteId: string) =>
      submitBallot(deps, room, ids[0]!, voteId, text('hi')),
    closeVote: (deps: Deps, room: Room, _ids: ParticipantId[], voteId: string) => closeVote(deps, room, voteId),
    dismissVote: (deps: Deps, room: Room, _ids: ParticipantId[], voteId: string) => dismissVote(deps, room, voteId),
  };

  for (const stage of stages) {
    for (const [name, run] of Object.entries(commands)) {
      if (legal[name as keyof typeof legal] === stage) continue;
      it(`refuses ${name} while ${stage} with wrong_stage and changes nothing`, () => {
        const s = setup();
        const room = s[stage];
        const before = structuredClone(room);
        expect(run(s.deps, room, s.ids, s.voteId)).toEqual({ ok: false, reason: 'wrong_stage' });
        expect(room).toEqual(before);
      });
    }
  }

  it('walks lobby, voting, closed, lobby in order', () => {
    const { deps, lobby, voting, closed, voteId } = setup();
    expect(lobby.stage.kind).toBe('lobby');
    expect(voting.stage.kind).toBe('voting');
    expect(closed.stage.kind).toBe('closed');
    expect(must(dismissVote(deps, closed, voteId)).stage).toEqual({ kind: 'lobby' });
  });
});

describe('stale vote ids', () => {
  it('refuses submit and close that name another vote, leaving the open vote untouched', () => {
    const { deps, voting, ids } = setup();
    const before = structuredClone(voting);
    expect(submitBallot(deps, voting, ids[0]!, 'old-vote', text('hi'))).toEqual({ ok: false, reason: 'stale_vote' });
    expect(closeVote(deps, voting, 'old-vote')).toEqual({ ok: false, reason: 'stale_vote' });
    expect(voting).toEqual(before);
  });

  it('refuses dismiss that names another vote', () => {
    const { deps, closed } = setup();
    expect(dismissVote(deps, closed, 'old-vote')).toEqual({ ok: false, reason: 'stale_vote' });
  });

  it('keeps a command aimed at the previous vote from touching the next one', () => {
    const { deps, closed, voteId, ids } = setup();
    const next = must(startVote(deps, must(dismissVote(deps, closed, voteId)), freeform));
    expect(submitBallot(deps, next, ids[0]!, voteId, text('late'))).toEqual({ ok: false, reason: 'stale_vote' });
    expect(closeVote(deps, next, voteId)).toEqual({ ok: false, reason: 'stale_vote' });
    expect(next.stage.kind).toBe('voting');
  });
});

describe('submitBallot', () => {
  it('accepts one ballot per participant and refuses the second, even with different content', () => {
    const { deps, voting, voteId, ids } = setup();
    const once = must(submitBallot(deps, voting, ids[0]!, voteId, text('첫 번째')));
    expect(submitBallot(deps, once, ids[0]!, voteId, text('두 번째'))).toEqual({ ok: false, reason: 'already_submitted' });

    const closed = must(closeVote(deps, once, voteId));
    expect(ballotsOf(closed, voteId)?.map((b) => b.content)).toEqual([text('첫 번째')]);
  });

  it('lets different participants each submit', () => {
    const { deps, voting, voteId, ids } = setup();
    const room = must(submitBallot(deps, must(submitBallot(deps, voting, ids[0]!, voteId, text('a'))), ids[1]!, voteId, text('b')));
    expect(hostStage(room)).toMatchObject({ kind: 'voting', submittedCount: 2 });
  });

  it.each([
    ['choice on a free-form paper', freeform, pick(0)],
    ['text on a multiple-choice paper', lunch, text('김밥')],
    ['an option index past the last option', lunch, pick(3)],
    ['blank text', freeform, text(' \n  ')],
    ['text over 200 characters', freeform, text('가'.repeat(201))],
  ])('refuses %s with bad_ballot and records nothing', (_, draft, content) => {
    const { deps, voting, voteId, ids } = setup(draft);
    expect(submitBallot(deps, voting, ids[0]!, voteId, content)).toEqual({ ok: false, reason: 'bad_ballot' });
    expect(hostStage(voting)).toMatchObject({ submittedCount: 0 });
  });

  it('stores the trimmed text and the chosen option', () => {
    const free = setup(freeform);
    const typed = must(submitBallot(free.deps, free.voting, free.ids[0]!, free.voteId, text('  정답  ')));
    expect(ballotsOf(must(closeVote(free.deps, typed, free.voteId)), free.voteId)?.[0]?.content).toEqual(text('정답'));

    const choice = setup(lunch);
    const picked = must(submitBallot(choice.deps, choice.voting, choice.ids[0]!, choice.voteId, pick(2)));
    expect(ballotsOf(must(closeVote(choice.deps, picked, choice.voteId)), choice.voteId)?.[0]?.content).toEqual(pick(2));
  });

  it('lets a participant who joined after the vote started submit', () => {
    const { deps, voting, voteId } = setup(freeform, 'Alice');
    const joined = join(deps, voting, { nickname: 'Late' });
    if (!joined.ok) throw new Error(joined.reason);
    const room = must(submitBallot(deps, joined.room, joined.participant.id, voteId, text('늦었지만')));

    const view = viewFor(room, { kind: 'participant', id: joined.participant.id });
    expect(view.stage).toMatchObject({ kind: 'voting', submitted: true });
    expect(hostStage(room)).toMatchObject({ submittedCount: 1 });
  });

  it('keeps the submitted state when the participant resumes with their token', () => {
    const { deps, voting, voteId, ids } = setup(freeform, 'Alice', 'Bob');
    const alice = voting.participants.get(ids[0]!)!;
    const submitted = must(submitBallot(deps, voting, alice.id, voteId, text('hi')));
    const away = setConnected(submitted, alice.id, false, deps.now());

    const back = join(deps, away, { nickname: 'ignored', participantToken: alice.token });
    if (!back.ok) throw new Error(back.reason);
    expect(viewFor(back.room, { kind: 'participant', id: alice.id }).stage).toMatchObject({ submitted: true });
    expect(viewFor(back.room, { kind: 'host' }).participants.map((p) => [p.nickname, p.submitted])).toEqual([
      ['Alice', true],
      ['Bob', false],
    ]);
  });
});

describe('views', () => {
  it('shows the host the submitted count and a per-participant flag while voting', () => {
    const { deps, voting, voteId, ids } = setup();
    const room = must(submitBallot(deps, voting, ids[1]!, voteId, text('hi')));
    const view = viewFor(room, { kind: 'host' });
    expect(view.stage).toMatchObject({ kind: 'voting', submittedCount: 1 });
    expect(view.participants.map((p) => [p.nickname, p.submitted])).toEqual([
      ['Alice', false],
      ['Bob', true],
      ['Cara', false],
    ]);
  });

  it('shows the host the ballot count once closed, with the flags kept', () => {
    const { deps, voting, voteId, ids } = setup();
    const submitted = must(submitBallot(deps, voting, ids[0]!, voteId, text('hi')));
    const closed = must(closeVote(deps, submitted, voteId));
    const view = viewFor(closed, { kind: 'host' });
    expect(view.stage).toMatchObject({ kind: 'closed', ballotCount: 1 });
    expect(view.participants.map((p) => p.submitted)).toEqual([true, false, false]);
  });

  it('clears the flags and counts when the host returns to the lobby', () => {
    const { deps, voting, voteId, ids } = setup();
    const closed = must(closeVote(deps, must(submitBallot(deps, voting, ids[0]!, voteId, text('hi'))), voteId));
    const lobby = must(dismissVote(deps, closed, voteId));
    const view = viewFor(lobby, { kind: 'host' });
    expect(view.stage).toEqual({ kind: 'lobby' });
    expect(view.participants.every((p) => !p.submitted)).toBe(true);
  });

  it('shows a participant only their own submitted state, while voting and after closing', () => {
    const { deps, voting, voteId, ids } = setup();
    const submitted = must(submitBallot(deps, voting, ids[0]!, voteId, text('hi')));
    const closed = must(closeVote(deps, submitted, voteId));
    const vote = { id: voteId, title: '이번 달 MVP는?', anonymity: 'anonymous', paper: { kind: 'freeform' } };

    for (const [room, kind] of [[submitted, 'voting'], [closed, 'closed']] as const) {
      expect(viewFor(room, { kind: 'participant', id: ids[0]! }).stage).toEqual({ kind, vote, submitted: true, submittedCount: 1 });
      expect(viewFor(room, { kind: 'participant', id: ids[1]! }).stage).toEqual({ kind, vote, submitted: false, submittedCount: 1 });
    }
  });

  it('gives every participant the same ballot count as the host, while voting and after closing', () => {
    const { deps, voting, voteId, ids } = setup();
    const empty = voting;
    const two = must(submitBallot(deps, must(submitBallot(deps, voting, ids[0]!, voteId, text('a'))), ids[2]!, voteId, text('b')));
    const closed = must(closeVote(deps, two, voteId));

    const countOf = (room: Room, viewer: { kind: 'host' } | { kind: 'participant'; id: ParticipantId }) => {
      const { stage } = viewFor(room, viewer);
      return stage.kind === 'lobby' ? undefined : 'submittedCount' in stage ? stage.submittedCount : stage.ballotCount;
    };
    for (const [room, expected] of [[empty, 0], [two, 2], [closed, 2]] as const) {
      for (const id of ids) expect(countOf(room, { kind: 'participant', id })).toBe(expected);
      expect(countOf(room, { kind: 'host' })).toBe(expected);
    }
  });

  it('counts only the current vote, so the next vote starts at zero', () => {
    const { deps, voting, voteId, ids } = setup();
    const closed = must(closeVote(deps, must(submitBallot(deps, voting, ids[0]!, voteId, text('x'))), voteId));
    const next = must(startVote(deps, must(dismissVote(deps, closed, voteId)), freeform));
    expect(viewFor(next, { kind: 'participant', id: ids[1]! }).stage).toMatchObject({ kind: 'voting', submitted: false, submittedCount: 0 });
  });

  it('never puts a submitted flag in the roster a participant sees', () => {
    const { deps, voting, voteId, ids } = setup();
    const room = must(submitBallot(deps, voting, ids[0]!, voteId, text('hi')));
    for (const id of ids) {
      const { participants } = viewFor(room, { kind: 'participant', id });
      for (const p of participants) expect(Object.keys(p).sort()).toEqual(['connected', 'id', 'nickname']);
    }
  });
});

describe('ballotsOf', () => {
  it('keeps the author of every ballot, including in an anonymous vote', () => {
    const { deps, voting, voteId, ids } = setup(freeform);
    expect(voting.stage.kind === 'voting' && voting.stage.vote.anonymity).toBe('anonymous');
    const room = must(submitBallot(deps, must(submitBallot(deps, voting, ids[2]!, voteId, text('c'))), ids[0]!, voteId, text('a')));
    deps.tick(10);
    const closed = must(closeVote(deps, room, voteId));

    expect(ballotsOf(closed, voteId)).toEqual([
      { participantId: ids[2], content: text('c'), submittedAt: expect.any(Number) },
      { participantId: ids[0], content: text('a'), submittedAt: expect.any(Number) },
    ]);
  });

  it('stays unreadable while the vote is open', () => {
    const { deps, voting, voteId, ids } = setup();
    const room = must(submitBallot(deps, voting, ids[0]!, voteId, text('hi')));
    expect(ballotsOf(room, voteId)).toBeUndefined();
  });

  it('keeps every closed vote readable after the room moves on', () => {
    const { deps, closed, voteId } = setup(lunch);
    const first = must(dismissVote(deps, closed, voteId));
    const secondOpen = must(startVote(deps, first, freeform));
    const secondId = voteIdOf(secondOpen);
    const secondClosed = must(closeVote(deps, secondOpen, secondId));

    expect(ballotsOf(secondClosed, voteId)).toEqual([]);
    expect(ballotsOf(secondClosed, secondId)).toEqual([]);
    expect(ballotsOf(secondClosed, 'nope')).toBeUndefined();
  });
});

describe('what a view may reveal', () => {
  const secret = '비밀문장-ALPHA-7731';

  it('carries no ballot text and no token in any view at any stage', () => {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice', 'Bob');
    const ids = idsOf(lobby);
    const tokens = [lobby.hostToken, ...[...lobby.participants.values()].map((p) => p.token)];

    const open = must(startVote(deps, lobby, freeform));
    const voteId = voteIdOf(open);
    const submitted = must(submitBallot(deps, open, ids[0]!, voteId, text(secret)));
    const closed = must(closeVote(deps, submitted, voteId));
    const lobbyAgain = must(dismissVote(deps, closed, voteId));
    const named = must(startVote(deps, lobbyAgain, { ...freeform, anonymity: 'named' }));
    const namedSubmitted = must(submitBallot(deps, named, ids[1]!, voteIdOf(named), text(secret)));
    const choiceOpen = must(startVote(deps, must(dismissVote(deps, must(closeVote(deps, namedSubmitted, voteIdOf(named))), voteIdOf(named))), lunch));
    const choiceSubmitted = must(submitBallot(deps, choiceOpen, ids[0]!, voteIdOf(choiceOpen), pick(1)));

    const rooms = [lobby, open, submitted, closed, lobbyAgain, named, namedSubmitted, choiceOpen, choiceSubmitted];
    for (const room of rooms) {
      for (const view of [viewFor(room, { kind: 'host' }), ...ids.map((id) => viewFor(room, { kind: 'participant', id }))]) {
        expect(viewSchema.safeParse(view).success).toBe(true);
        if (view.role === 'participant') {
          expect(Object.keys(view).sort()).toEqual(['code', 'me', 'participants', 'role', 'stage']);
          expect(Object.keys(view.stage).sort()).toEqual(
            view.stage.kind === 'lobby' ? ['kind'] : ['kind', 'submitted', 'submittedCount', 'vote'],
          );
          expect(Object.keys(view.me).sort()).toEqual(['id', 'nickname']);
        }
        const wire = JSON.stringify(view);
        expect(wire).not.toContain(secret);
        expect(wire).not.toContain('optionIndex');
        for (const token of tokens) expect(wire).not.toContain(token);
      }
    }
  });

  it('shows the same vote fields to host and participants, and no others', () => {
    const { voting, ids } = setup(lunch);
    const host = viewFor(voting, { kind: 'host' }).stage;
    const guest = viewFor(voting, { kind: 'participant', id: ids[0]! }).stage;
    if (host.kind !== 'voting' || guest.kind !== 'voting') throw new Error('expected voting');
    expect(Object.keys(host.vote).sort()).toEqual(['anonymity', 'id', 'paper', 'title']);
    expect(guest.vote).toEqual(host.vote);
  });
});

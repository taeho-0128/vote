import { describe, expect, it } from 'vitest';
import type { BallotContent, VoteDraft } from '../shared/vote.ts';
import { systemDeps } from './deps.ts';
import {
  ballotsOf,
  closeVote,
  dismissVote,
  isDisplayToken,
  revealMode,
  revealMove,
  setHidden,
  startVote,
  submitBallot,
  viewFor,
} from './rooms.ts';
import type { Deps, Room } from './rooms.ts';
import { LIFETIME, closedRoom, fakeDeps, must, roomWith, voteIdOf } from './testkit.ts';

const freeform: VoteDraft = { title: '이번 달 MVP는?', paper: { kind: 'freeform' }, anonymity: 'anonymous' };
const lunch: VoteDraft = { title: '점심', paper: { kind: 'choice', options: ['김밥', '라면', '비빔밥'] }, anonymity: 'named' };
const text = (t: string): BallotContent => ({ kind: 'text', text: t });
const pick = (optionIndex: number): BallotContent => ({ kind: 'choice', optionIndex });

const hostReveal = (room: Room) => {
  const { stage } = viewFor(room, { kind: 'host' }, LIFETIME);
  if (stage.kind !== 'closed') throw new Error('expected a closed vote');
  return stage.reveal;
};
const displayReveal = (room: Room) => {
  const { stage } = viewFor(room, { kind: 'display' });
  if (stage.kind !== 'closed') throw new Error('expected a closed vote');
  return stage.reveal;
};
const authors = (room: Room) => hostReveal(room).ballots.map((b) => b.author.nickname);

const refused = (reason: string) => ({ ok: false, reason });

describe('closing a vote fixes the reveal order', () => {
  it('opens the reveal on the folded pile, one at a time, not hidden', () => {
    const { closed } = closedRoom(fakeDeps(), freeform, [text('a'), text('b'), text('c')]);
    expect(hostReveal(closed)).toMatchObject({ cursor: -1, mode: 'one', hidden: false });
    expect(hostReveal(closed).ballots).toHaveLength(3);
  });

  it('lists every ballot once, in the order the injected shuffle gives', () => {
    const contents = [text('a'), text('b'), text('c'), text('d')];
    const reversed = closedRoom(fakeDeps(), freeform, contents).closed;
    expect(authors(reversed)).toEqual(['Dmitri', 'Carol', 'Bobby', 'Alice']);
    expect(hostReveal(reversed).ballots.map((b) => b.content)).toEqual([text('d'), text('c'), text('b'), text('a')]);

    const rotate: Deps['shuffle'] = (items) => [...items.slice(1), ...items.slice(0, 1)];
    const rotated = closedRoom({ ...fakeDeps(), shuffle: rotate }, freeform, contents).closed;
    expect(authors(rotated)).toEqual(['Bobby', 'Carol', 'Dmitri', 'Alice']);
  });

  it('keeps each ballot with its own author, including in an anonymous vote (D-27)', () => {
    const { closed, ids } = closedRoom(fakeDeps(), freeform, [text('a'), text('b'), text('c')]);
    expect(hostReveal(closed).ballots).toEqual([
      { id: ids[2], content: text('c'), author: { id: ids[2], nickname: 'Carol' } },
      { id: ids[1], content: text('b'), author: { id: ids[1], nickname: 'Bobby' } },
      { id: ids[0], content: text('a'), author: { id: ids[0], nickname: 'Alice' } },
    ]);
  });

  it('lists only the people who submitted', () => {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice', 'Bobby', 'Carol');
    const [alice, , carol] = [...lobby.participants.keys()];
    const open = must(startVote(deps, lobby, freeform));
    const voteId = voteIdOf(open);
    const closed = must(closeVote(deps, must(submitBallot(deps, must(submitBallot(deps, open, alice!, voteId, text('a'))), carol!, voteId, text('c'))), voteId));
    expect(authors(closed)).toEqual(['Carol', 'Alice']);
  });

  it('closes a vote with no ballots into an empty reveal that stays on the folded pile', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, freeform, []);
    expect(hostReveal(closed)).toEqual({ cursor: -1, mode: 'one', hidden: false, ballots: [] });
    expect(displayReveal(closed)).toMatchObject({ cursor: -1, total: 0, current: null, tally: null });

    expect(revealMove(deps, closed, voteId, 0)).toEqual(refused('bad_reveal'));
    expect(hostReveal(must(revealMove(deps, closed, voteId, -1))).cursor).toBe(-1);
  });
});

describe('reveal commands out of order', () => {
  const commands = {
    revealMove: (deps: Deps, room: Room, voteId: string) => revealMove(deps, room, voteId, 0),
    revealMode: (deps: Deps, room: Room, voteId: string) => revealMode(deps, room, voteId, 'one'),
    setHidden: (deps: Deps, room: Room, voteId: string) => setHidden(deps, room, voteId, true),
  };

  for (const [name, run] of Object.entries(commands)) {
    for (const stage of ['lobby', 'voting'] as const) {
      it(`refuses ${name} while ${stage} with wrong_stage and changes nothing`, () => {
        const deps = fakeDeps();
        const s = closedRoom(deps, freeform, [text('a')]);
        const room = s[stage];
        const before = structuredClone(room);
        expect(run(deps, room, s.voteId)).toEqual(refused('wrong_stage'));
        expect(room).toEqual(before);
      });
    }

    it(`refuses ${name} for another vote's id with stale_vote and changes nothing`, () => {
      const deps = fakeDeps();
      const { closed } = closedRoom(deps, freeform, [text('a')]);
      const before = structuredClone(closed);
      expect(run(deps, closed, 'old-vote')).toEqual(refused('stale_vote'));
      expect(closed).toEqual(before);
    });

    it(`refuses ${name} aimed at the previous vote while the next one is closed`, () => {
      const deps = fakeDeps();
      const first = closedRoom(deps, freeform, [text('a')]);
      const open = must(startVote(deps, must(dismissVote(deps, first.closed, first.voteId)), freeform));
      const second = must(closeVote(deps, open, voteIdOf(open)));
      const before = structuredClone(second);
      expect(run(deps, second, first.voteId)).toEqual(refused('stale_vote'));
      expect(second).toEqual(before);
    });
  }
});

describe('revealMove', () => {
  const setup = () => {
    const deps = fakeDeps();
    return { deps, ...closedRoom(deps, freeform, [text('a'), text('b'), text('c')]) };
  };

  it.each([[-1], [0], [1], [2]])('accepts cursor %i of a 3-ballot vote', (cursor) => {
    const { deps, closed, voteId } = setup();
    expect(hostReveal(must(revealMove(deps, closed, voteId, cursor))).cursor).toBe(cursor);
  });

  it.each([[-2], [3], [100], [0.5], [Number.NaN]])('refuses cursor %s with bad_reveal and changes nothing', (cursor) => {
    const { deps, closed, voteId } = setup();
    const before = structuredClone(closed);
    expect(revealMove(deps, closed, voteId, cursor)).toEqual(refused('bad_reveal'));
    expect(closed).toEqual(before);
  });

  it('moves freely back and forth, down to the folded pile', () => {
    const { deps, closed, voteId } = setup();
    const cursors = [2, 0, 1, -1, 2];
    let room = closed;
    for (const cursor of cursors) {
      room = must(revealMove(deps, room, voteId, cursor));
      expect(hostReveal(room).cursor).toBe(cursor);
    }
  });

  it('does not reorder the ballots as the cursor moves', () => {
    const { deps, closed, voteId } = setup();
    const moved = must(revealMove(deps, closed, voteId, 1));
    expect(hostReveal(moved).ballots).toEqual(hostReveal(closed).ballots);
  });

  it('refuses a move while every ballot is open', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1)]);
    const all = must(revealMode(deps, closed, voteId, 'all'));
    const before = structuredClone(all);
    expect(revealMove(deps, all, voteId, 0)).toEqual(refused('bad_reveal'));
    expect(all).toEqual(before);
  });
});

describe('revealMode', () => {
  it('accepts all on a multiple-choice vote and refuses it on a free-form vote', () => {
    const deps = fakeDeps();
    const choice = closedRoom(deps, lunch, [pick(0)]);
    expect(hostReveal(must(revealMode(deps, choice.closed, choice.voteId, 'all'))).mode).toBe('all');

    const free = closedRoom(deps, freeform, [text('a')]);
    const before = structuredClone(free.closed);
    expect(revealMode(deps, free.closed, free.voteId, 'all')).toEqual(refused('bad_reveal'));
    expect(free.closed).toEqual(before);
    expect(hostReveal(must(revealMode(deps, free.closed, free.voteId, 'one'))).mode).toBe('one');
  });

  it('keeps the cursor when going from all back to one', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1), pick(2)]);
    const at = must(revealMove(deps, closed, voteId, 1));
    const back = must(revealMode(deps, must(revealMode(deps, at, voteId, 'all')), voteId, 'one'));
    expect(hostReveal(back)).toMatchObject({ cursor: 1, mode: 'one' });
    expect(hostReveal(must(revealMove(deps, back, voteId, 2))).cursor).toBe(2);
  });

  it('allows all on a multiple-choice vote with no ballots', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, []);
    const all = must(revealMode(deps, closed, voteId, 'all'));
    expect(displayReveal(all)).toMatchObject({ mode: 'all', total: 0, tally: [0, 0, 0] });
  });
});

describe('setHidden', () => {
  it('toggles hiding without touching the cursor or the mode', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1), pick(2)]);
    const at = must(revealMove(deps, closed, voteId, 1));
    const hidden = must(setHidden(deps, at, voteId, true));
    expect(hostReveal(hidden)).toMatchObject({ cursor: 1, mode: 'one', hidden: true });
    expect(hostReveal(must(setHidden(deps, hidden, voteId, true))).hidden).toBe(true);
    expect(hostReveal(must(setHidden(deps, hidden, voteId, false)))).toMatchObject({ cursor: 1, hidden: false });
  });

  it('lets the host move and switch mode while hidden, and keeps hiding', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1), pick(2)]);
    const hidden = must(setHidden(deps, closed, voteId, true));
    const moved = must(revealMove(deps, hidden, voteId, 2));
    const all = must(revealMode(deps, moved, voteId, 'all'));
    expect(hostReveal(all)).toMatchObject({ cursor: 2, mode: 'all', hidden: true });
  });

  it('keeps the host view full while hidden, since only the displays are hidden (D-14)', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, freeform, [text('a'), text('b')]);
    const hidden = must(setHidden(deps, must(revealMove(deps, closed, voteId, 0)), voteId, true));
    expect(hostReveal(hidden).ballots.map((b) => b.content)).toEqual([text('b'), text('a')]);
    expect(displayReveal(hidden).current).toBeNull();
  });
});

describe('the display projection of a reveal', () => {
  it('shows nothing of the ballots on the folded pile and counts them', () => {
    const { closed } = closedRoom(fakeDeps(), freeform, [text('a'), text('b')]);
    expect(displayReveal(closed)).toEqual({ cursor: -1, total: 2, mode: 'one', hidden: false, current: null, tally: null });
  });

  it('shows the ballot at the cursor and no other', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, freeform, [text('a'), text('b'), text('c')]);
    const reveal = (cursor: number) => displayReveal(must(revealMove(deps, closed, voteId, cursor)));
    expect(reveal(0).current).toEqual({ content: text('c'), signature: null });
    expect(reveal(1).current).toEqual({ content: text('b'), signature: null });
    expect(reveal(2).current).toEqual({ content: text('a'), signature: null });
  });

  it('signs the ballot with the author only when the vote is named', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1)]);
    const first = displayReveal(must(revealMove(deps, closed, voteId, 0)));
    expect(first.current).toEqual({ content: pick(1), signature: 'Bobby' });
  });

  it('shows no ballot when hidden, wherever the cursor is', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(1)]);
    const hidden = must(setHidden(deps, must(revealMove(deps, closed, voteId, 1)), voteId, true));
    expect(displayReveal(hidden)).toMatchObject({ cursor: 1, hidden: true, current: null, tally: null });
  });

  it('counts the votes per option only in all mode on a choice vote', () => {
    const deps = fakeDeps();
    const { closed, voteId } = closedRoom(deps, lunch, [pick(0), pick(0), pick(1), pick(0), pick(1)]);
    expect(displayReveal(closed).tally).toBeNull();
    expect(displayReveal(must(revealMove(deps, closed, voteId, 3))).tally).toBeNull();

    const all = must(revealMode(deps, closed, voteId, 'all'));
    expect(displayReveal(all).tally).toEqual([3, 2, 0]);

    const hidden = must(setHidden(deps, all, voteId, true));
    expect(displayReveal(hidden).tally).toBeNull();
    expect(displayReveal(must(setHidden(deps, hidden, voteId, false))).tally).toEqual([3, 2, 0]);
  });

  it('never has a tally on a free-form vote', () => {
    const { closed } = closedRoom(fakeDeps(), freeform, [text('a')]);
    expect(displayReveal(closed).tally).toBeNull();
  });
});

describe('after the host dismisses a vote', () => {
  it('keeps the closed vote readable in its reveal order', () => {
    const deps = fakeDeps();
    const { closed, voteId, ids } = closedRoom(deps, freeform, [text('a'), text('b'), text('c')]);
    const lobby = must(dismissVote(deps, must(revealMove(deps, closed, voteId, 1)), voteId));
    expect(ballotsOf(lobby, voteId)?.map((b) => b.participantId)).toEqual([ids[2], ids[1], ids[0]]);
    expect(ballotsOf(lobby, voteId)?.map((b) => b.content)).toEqual([text('c'), text('b'), text('a')]);
  });

  it('gives the next vote a fresh reveal and a fresh order, whatever the last one ended on', () => {
    const deps = fakeDeps();
    const first = closedRoom(deps, lunch, [pick(0), pick(1), pick(2)]);
    const ended = must(setHidden(deps, must(revealMode(deps, must(revealMove(deps, first.closed, first.voteId, 2)), first.voteId, 'all')), first.voteId, true));
    const lobby = must(dismissVote(deps, ended, first.voteId));

    const open = must(startVote(deps, lobby, freeform));
    const [alice, bobby] = first.ids;
    const voteId = voteIdOf(open);
    const second = must(closeVote(deps, must(submitBallot(deps, must(submitBallot(deps, open, alice!, voteId, text('x'))), bobby!, voteId, text('y'))), voteId));

    expect(hostReveal(second)).toMatchObject({ cursor: -1, mode: 'one', hidden: false });
    expect(hostReveal(second).ballots.map((b) => b.content)).toEqual([text('y'), text('x')]);
    expect(displayReveal(second)).toMatchObject({ cursor: -1, total: 2, current: null, tally: null });
  });

  it('walks three votes in a row, each with its own order, and keeps all three readable', () => {
    const deps = fakeDeps();
    const lobby = roomWith(deps, 'Alice', 'Bobby', 'Carol');
    const ids = [...lobby.participants.keys()];
    const drafts = [freeform, lunch, { ...freeform, anonymity: 'named' as const }];
    const contents = [[text('1a'), text('1b'), text('1c')], [pick(0), pick(1), pick(2)], [text('3a'), text('3b'), text('3c')]];

    let room = lobby;
    const voteIds: string[] = [];
    drafts.forEach((draft, round) => {
      const open = must(startVote(deps, room, draft));
      const voteId = voteIdOf(open);
      voteIds.push(voteId);
      const filled = ids.reduce((r, id, i) => must(submitBallot(deps, r, id, voteId, contents[round]![i]!)), open);
      const closed = must(closeVote(deps, filled, voteId));
      expect(hostReveal(closed)).toMatchObject({ cursor: -1, mode: 'one', hidden: false });
      expect(hostReveal(closed).ballots.map((b) => b.content)).toEqual([...contents[round]!].reverse());
      room = must(dismissVote(deps, must(revealMove(deps, closed, voteId, round)), voteId));
    });

    expect(new Set(voteIds).size).toBe(3);
    voteIds.forEach((voteId, round) => {
      expect(ballotsOf(room, voteId)?.map((b) => b.content)).toEqual([...contents[round]!].reverse());
    });
  });
});

describe('the display token', () => {
  it('is made with the room, differs from the host token, and survives every stage', () => {
    const deps = fakeDeps();
    const { lobby, voting, closed, voteId } = closedRoom(deps, freeform, [text('a')]);
    const dismissed = must(dismissVote(deps, closed, voteId));
    const tokens = [lobby, voting, closed, dismissed].map((room) => viewFor(room, { kind: 'host' }, LIFETIME).displayToken);
    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).not.toBe(lobby.hostToken);
  });

  it('is accepted only exactly', () => {
    const { lobby } = closedRoom(fakeDeps(), freeform, []);
    expect(isDisplayToken(lobby, lobby.displayToken)).toBe(true);
    expect(isDisplayToken(lobby, lobby.hostToken)).toBe(false);
    expect(isDisplayToken(lobby, lobby.displayToken + 'x')).toBe(false);
    expect(isDisplayToken(lobby, '')).toBe(false);
  });
});

describe('the real shuffle', () => {
  const { shuffle } = systemDeps;

  it('returns a permutation and leaves its input alone', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(input);
    expect(out).not.toBe(input);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('handles nothing and one item', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle(['only'])).toEqual(['only']);
  });

  it('reaches every ordering of three items', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) seen.add(shuffle(['a', 'b', 'c']).join(''));
    expect(seen.size).toBe(6);
  });
});

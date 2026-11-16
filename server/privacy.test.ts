import { describe, expect, it } from 'vitest';
import type { InkStroke } from '../shared/ink.ts';
import { viewSchema } from '../shared/protocol.ts';
import type { DisplayView, HostView, ParticipantView, View } from '../shared/protocol.ts';
import type { BallotContent, Paper, VoteDraft } from '../shared/vote.ts';
import { dismissVote, revealMode, revealMove, setHidden, viewFor } from './rooms.ts';
import type { Room } from './rooms.ts';
import { NICKNAMES, closedRoom, fakeDeps, must } from './testkit.ts';

const stroke = (seed: number): InkStroke[] => [
  { w: 'thin', pts: [100 + seed, 200 + seed, 300 + seed, 400 + seed] },
  { w: 'thick', pts: [500 + seed, 600 + seed, 700 + seed, 800 + seed] },
];
const text = (t: string): BallotContent => ({ kind: 'text', text: t });
const ink = (seed: number): BallotContent => ({ kind: 'ink', strokes: stroke(seed) });
const pick = (optionIndex: number): BallotContent => ({ kind: 'choice', optionIndex });

const paperOf: Record<string, Paper> = {
  text: { kind: 'freeform' },
  ink: { kind: 'freeform' },
  choice: { kind: 'choice', options: ['김밥', '라면', '비빔밥'] },
};

const contentsOf = {
  text: [text('비밀문장-ALPHA-7731'), text('비밀문장-BRAVO-4482'), text('비밀문장-CHARLIE-9150')],
  ink: [ink(11), ink(22), ink(33)],
  choice: [pick(0), pick(1), pick(2)],
};

// Content is found by shape, so a leak under any key name is caught.
function contentObjects(node: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) contentObjects(item, found);
  } else if (node !== null && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ('optionIndex' in o || 'strokes' in o || o.kind === 'text') found.push(o);
    for (const value of Object.values(o)) contentObjects(value, found);
  }
  return found;
}

const markerOf = (content: BallotContent): string | null => {
  if (content.kind === 'text') return content.text;
  if (content.kind === 'ink') return JSON.stringify(content.strokes);
  return null;
};

const keys = (o: object) => Object.keys(o).sort();

interface Case {
  readonly name: string;
  readonly kind: keyof typeof contentsOf;
  readonly anonymity: VoteDraft['anonymity'];
}

const cases: Case[] = (['text', 'ink', 'choice'] as const).flatMap((kind) =>
  (['anonymous', 'named'] as const).map((anonymity) => ({ name: `${anonymity} ${kind}`, kind, anonymity })),
);

function walk({ kind, anonymity }: Case) {
  const deps = fakeDeps();
  const draft: VoteDraft = { title: '이번 투표', paper: paperOf[kind]!, anonymity };
  const contents = contentsOf[kind];
  const { lobby, voting, submitted, closed, voteId, ids } = closedRoom(deps, draft, contents);

  const rooms: { label: string; room: Room; revealed: number | null; hidden: boolean }[] = [
    { label: 'lobby', room: lobby, revealed: null, hidden: false },
    { label: 'voting', room: voting, revealed: null, hidden: false },
    { label: 'all submitted', room: submitted, revealed: null, hidden: false },
  ];
  // The fake shuffle reverses, so reveal position p holds submission index n-1-p.
  const n = contents.length;
  for (const hidden of [false, true]) {
    const base = must(setHidden(deps, closed, voteId, hidden));
    for (let cursor = -1; cursor < n; cursor++) {
      rooms.push({ label: `closed cursor ${cursor} hidden ${hidden}`, room: must(revealMove(deps, base, voteId, cursor)), revealed: cursor, hidden });
    }
    if (kind === 'choice') {
      const all = must(revealMode(deps, base, voteId, 'all'));
      rooms.push({ label: `closed all hidden ${hidden}`, room: all, revealed: -1, hidden });
    }
  }
  rooms.push({ label: 'dismissed', room: must(dismissVote(deps, closed, voteId)), revealed: null, hidden: false });
  return { rooms, ids, contents, n, lobby };
}

describe.each(cases)('privacy sweep, $name vote', (scenario) => {
  const { rooms, ids, contents, n, lobby } = walk(scenario);
  const named = scenario.anonymity === 'named';
  const authorNicknames = NICKNAMES.slice(0, n);
  const secretTokens = [lobby.hostToken, ...[...lobby.participants.values()].map((p) => p.token)];

  const authorIndexAt = (cursor: number) => n - 1 - cursor;

  it.each(rooms.map((r) => [r.label, r] as const))('display view at %s', (_, { room, revealed, hidden }) => {
    const view = viewFor(room, { kind: 'display' });
    const wire = JSON.stringify(view);
    expect(viewSchema.safeParse(view).success).toBe(true);

    expect(keys(view)).toEqual(['code', 'role', 'stage']);
    for (const token of [...secretTokens, room.displayToken]) expect(wire).not.toContain(token);

    const shownIndex = view.stage.kind === 'closed' && revealed !== null && revealed >= 0 && !hidden ? authorIndexAt(revealed) : null;
    expect(contentObjects(view)).toHaveLength(shownIndex === null ? 0 : 1);
    contents.forEach((content, i) => {
      const marker = markerOf(content);
      if (marker !== null) expect(wire.includes(marker)).toBe(i === shownIndex);
    });
    if (shownIndex !== null) expect(contentObjects(view)).toEqual([contents[shownIndex]]);

    if (view.stage.kind === 'lobby') {
      expect(keys(view.stage)).toEqual(['kind', 'participants']);
      for (const p of view.stage.participants) expect(keys(p)).toEqual(['connected', 'id', 'nickname']);
      return;
    }

    for (const id of ids) expect(wire).not.toContain(`"${id}"`);
    authorNicknames.forEach((nickname, i) => expect(wire.includes(nickname)).toBe(named && i === shownIndex));

    if (view.stage.kind === 'voting') {
      expect(keys(view.stage)).toEqual(['kind', 'participantCount', 'submittedCount', 'vote']);
      expect(view.stage.participantCount).toBe(n);
    } else {
      expect(keys(view.stage)).toEqual(['kind', 'reveal', 'vote']);
      expect(keys(view.stage.reveal)).toEqual(['current', 'cursor', 'hidden', 'mode', 'tally', 'total']);
      if (view.stage.reveal.current) expect(keys(view.stage.reveal.current)).toEqual(['content', 'signature']);
      if (hidden) expect(view.stage.reveal).toMatchObject({ current: null, tally: null });
      if (view.stage.reveal.current) expect(view.stage.reveal.current.signature).toBe(named ? authorNicknames[shownIndex!] : null);
    }
    expect(keys(view.stage.vote)).toEqual(['anonymity', 'id', 'paper', 'title']);
  });

  it.each(rooms.map((r) => [r.label, r] as const))('participant views at %s', (_, { room }) => {
    for (const id of ids) {
      const view = viewFor(room, { kind: 'participant', id });
      const wire = JSON.stringify(view);
      expect(viewSchema.safeParse(view).success).toBe(true);

      expect(keys(view)).toEqual(['code', 'me', 'participants', 'role', 'stage']);
      expect(keys(view.stage)).toEqual(view.stage.kind === 'lobby' ? ['kind'] : ['kind', 'submitted', 'submittedCount', 'vote']);
      expect(contentObjects(view)).toEqual([]);
      for (const content of contents) {
        const marker = markerOf(content);
        if (marker !== null) expect(wire).not.toContain(marker);
      }
      for (const token of [...secretTokens, room.displayToken]) expect(wire).not.toContain(token);
      expect(wire).not.toContain('reveal');
    }
  });

  it.each(rooms.map((r) => [r.label, r] as const))('host view at %s', (_, { room }) => {
    const view = viewFor(room, { kind: 'host' });
    const wire = JSON.stringify(view);
    expect(viewSchema.safeParse(view).success).toBe(true);

    expect(keys(view)).toEqual(['code', 'displayToken', 'participants', 'role', 'stage']);
    expect(view.displayToken).toBe(room.displayToken);
    for (const token of secretTokens) expect(wire).not.toContain(token);

    const closed = view.stage.kind === 'closed';
    expect(contentObjects(view)).toHaveLength(closed ? n : 0);
  });
});

describe('the views are typed apart', () => {
  it('has one view type per role, so a display view cannot be mistaken for a host view', () => {
    const { closed } = closedRoom(fakeDeps(), { title: 't', paper: { kind: 'freeform' }, anonymity: 'anonymous' }, [text('a')]);
    const views: View[] = [
      viewFor(closed, { kind: 'host' }) satisfies HostView,
      viewFor(closed, { kind: 'participant', id: [...closed.participants.keys()][0]! }) satisfies ParticipantView,
      viewFor(closed, { kind: 'display' }) satisfies DisplayView,
    ];
    expect(views.map((v) => v.role)).toEqual(['host', 'participant', 'display']);
  });
});

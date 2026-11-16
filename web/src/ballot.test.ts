import { describe, expect, it } from 'vitest';
import { INK_MAX_STROKES } from '../../shared/ink.ts';
import type { InkStroke } from '../../shared/ink.ts';
import type { Paper } from '../../shared/vote.ts';
import { draftContent, emptyDraft, modeContent, restoreDraft, storableDraft, storedDraftSchema } from './ballot.ts';
import type { BallotDraft } from './ballot.ts';
import { addStroke, docFrom } from './ink.ts';

const FREEFORM: Paper = { kind: 'freeform' };
const CHOICE: Paper = { kind: 'choice', options: ['가', '나'] };
const parse = (value: unknown) => {
  const parsed = storedDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};
const stroke: InkStroke = { w: 'thin', pts: [0, 0, 100, 100] };

function freeform(overrides: Partial<Extract<BallotDraft, { kind: 'freeform' }>> = {}) {
  return { ...(emptyDraft(FREEFORM) as Extract<BallotDraft, { kind: 'freeform' }>), ...overrides };
}

describe('stored drafts', () => {
  it('round-trips a free-form draft without the undo history', () => {
    const ink = addStroke(docFrom([]), 'thin', [0, 0, 400, 400])!;
    const draft = freeform({ mode: 'type', text: '안녕', ink });
    const stored = parse(JSON.parse(JSON.stringify(storableDraft(draft))));
    expect(stored).toEqual({ kind: 'freeform', mode: 'type', text: '안녕', strokes: ink.strokes });
    const restored = restoreDraft(stored, FREEFORM);
    expect(restored).toEqual({ ...draft, ink: docFrom(ink.strokes) });
  });

  it('drops damaged strokes and keeps the text and mode', () => {
    const stored = parse({ kind: 'freeform', mode: 'type', text: '남은 글', strokes: [{ w: 'thin', pts: [1, 2, 'x'] }] });
    expect(stored).toEqual({ kind: 'freeform', mode: 'type', text: '남은 글', strokes: [] });
  });

  it('falls back to write mode and empty text field by field', () => {
    expect(parse({ kind: 'freeform', mode: 'draw', text: 7, strokes: [stroke] })).toEqual({
      kind: 'freeform',
      mode: 'write',
      text: '',
      strokes: [stroke],
    });
  });

  it('drops strokes with coordinates the schema cannot hold', () => {
    const stored = parse({ kind: 'freeform', mode: 'write', text: '', strokes: [{ w: 'thin', pts: [0, 0, 5000, 1] }] });
    expect(stored).toMatchObject({ strokes: [] });
  });

  it('pulls a stored x past the paper width back onto the paper', () => {
    const stored = parse({ kind: 'freeform', mode: 'write', text: '', strokes: [{ w: 'thin', pts: [0, 0, 1200, 300] }] });
    const restored = restoreDraft(stored, FREEFORM);
    expect(draftContent(restored, FREEFORM)).toEqual({ kind: 'ink', strokes: [{ w: 'thin', pts: [0, 0, 1000, 300] }] });
  });

  it('reads a draft stored by the typing-only version as typing mode', () => {
    expect(parse({ kind: 'text', text: '예전 초안' })).toEqual({ kind: 'freeform', mode: 'type', text: '예전 초안', strokes: [] });
  });

  it('refuses garbage', () => {
    expect(parse('nope')).toBeNull();
    expect(parse({ kind: 'ink' })).toBeNull();
  });

  it('drops strokes that no tolerance could fit', () => {
    const many = Array.from({ length: INK_MAX_STROKES + 1 }, () => stroke);
    expect(restoreDraft({ kind: 'freeform', mode: 'write', text: 'x', strokes: many }, FREEFORM)).toMatchObject({
      text: 'x',
      ink: { strokes: [] },
    });
  });

  it('starts a choice paper clean when the stored draft was for another paper', () => {
    expect(restoreDraft(parse({ kind: 'freeform', mode: 'write', text: '', strokes: [] }), CHOICE)).toEqual({ kind: 'choice', optionIndex: null });
    expect(restoreDraft(parse({ kind: 'choice', optionIndex: 1 }), CHOICE)).toEqual({ kind: 'choice', optionIndex: 1 });
    expect(restoreDraft(parse({ kind: 'choice', optionIndex: 5 }), CHOICE)).toEqual({ kind: 'choice', optionIndex: null });
    expect(restoreDraft(parse({ kind: 'choice', optionIndex: 1 }), FREEFORM)).toMatchObject({ kind: 'freeform', mode: 'write' });
  });
});

describe('what a submit sends', () => {
  const ink = addStroke(docFrom([]), 'thick', [10, 10, 300, 300])!;

  it('sends only the selected mode', () => {
    const both = freeform({ text: '  글  ', ink });
    expect(draftContent({ ...both, mode: 'write' }, FREEFORM)).toEqual({ kind: 'ink', strokes: [...ink.strokes] });
    expect(draftContent({ ...both, mode: 'type' }, FREEFORM)).toEqual({ kind: 'text', text: '글' });
  });

  it('has nothing to send from an empty selected mode even when the other one has content', () => {
    expect(draftContent(freeform({ mode: 'write', text: '글' }), FREEFORM)).toBeNull();
    expect(draftContent(freeform({ mode: 'type', ink }), FREEFORM)).toBeNull();
    expect(modeContent(freeform({ mode: 'type', ink }), 'write')).not.toBeNull();
  });

  it('treats whitespace as empty typing', () => {
    expect(draftContent(freeform({ mode: 'type', text: '   \n ' }), FREEFORM)).toBeNull();
  });

  it('has nothing to send from an empty or unpicked choice paper', () => {
    expect(draftContent({ kind: 'choice', optionIndex: null }, CHOICE)).toBeNull();
    expect(draftContent({ kind: 'choice', optionIndex: 1 }, CHOICE)).toEqual({ kind: 'choice', optionIndex: 1 });
  });
});

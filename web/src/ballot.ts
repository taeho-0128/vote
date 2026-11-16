import { z } from 'zod';
import { inkSchema } from '../../shared/ink.ts';
import { normalizeBallotContent, OPTIONS_MAX, TEXT_MAX, TEXT_MAX_LINES } from '../../shared/vote.ts';
import type { BallotContent, Paper } from '../../shared/vote.ts';
import { docFrom, fitInk, normalizeStroke } from './ink.ts';
import type { InkDoc } from './ink.ts';

export type BallotMode = 'write' | 'type';

// Each field falls back on its own, so a damaged stroke list does not take the typed draft down with it.
const storedFreeformSchema = z.object({
  kind: z.literal('freeform'),
  mode: z.enum(['write', 'type']).catch('write'),
  text: z.string().max(TEXT_MAX * 2).catch(''),
  strokes: inkSchema.catch([]),
});

// Step 2 stored a typed draft as `{ kind: 'text' }`. A participant mid-vote across the upgrade keeps it.
const storedLegacyTextSchema = z
  .object({ kind: z.literal('text'), text: z.string().max(TEXT_MAX * 2) })
  .transform(({ text }) => ({ kind: 'freeform' as const, mode: 'type' as const, text, strokes: [] }));

const storedChoiceSchema = z.object({
  kind: z.literal('choice'),
  optionIndex: z.number().int().min(0).max(OPTIONS_MAX - 1).nullable(),
});

export const storedDraftSchema = z.union([storedFreeformSchema, storedLegacyTextSchema, storedChoiceSchema]);
export type StoredDraft = z.output<typeof storedDraftSchema>;

// What the participant has on the paper so far. A free-form paper keeps the typed text and the strokes side by side,
// and `mode` says which of the two a submit would send. A choice paper starts with nothing circled.
export type BallotDraft =
  | { readonly kind: 'freeform'; readonly mode: BallotMode; readonly text: string; readonly ink: InkDoc }
  | { readonly kind: 'choice'; readonly optionIndex: number | null };

export type FreeformDraft = Extract<BallotDraft, { kind: 'freeform' }>;

const FREEFORM: Paper = { kind: 'freeform' };

// What a typing paper holds: at most TEXT_MAX_LINES lines and TEXT_MAX characters. Anything longer, pasted or restored
// from a draft, is cut there, lines first. A tab becomes a space because a tab's width is not one the fit can count.
export function limitTypedText(text: string): string {
  const lines = text.replace(/\t/g, ' ').split('\n').slice(0, TEXT_MAX_LINES).join('\n');
  return [...lines].slice(0, TEXT_MAX).join('');
}

export const emptyDraft = (paper: Paper): BallotDraft =>
  paper.kind === 'freeform'
    ? { kind: 'freeform', mode: 'write', text: '', ink: docFrom([]) }
    : { kind: 'choice', optionIndex: null };

// The undo history stays in memory. Only the visible strokes are stored.
export const storableDraft = (draft: BallotDraft): StoredDraft =>
  draft.kind === 'freeform'
    ? { kind: 'freeform', mode: draft.mode, text: draft.text, strokes: [...draft.ink.strokes] }
    : draft;

// A stored draft belongs to a vote, but the paper it was written on may not be the one on screen now.
export function restoreDraft(stored: StoredDraft | null, paper: Paper): BallotDraft {
  if (stored === null) return emptyDraft(paper);
  if (paper.kind === 'freeform') {
    if (stored.kind !== 'freeform') return emptyDraft(paper);
    const clean = stored.strokes.map(normalizeStroke);
    const strokes = fitInk(clean) === null ? [] : clean;
    return { kind: 'freeform', mode: stored.mode, text: limitTypedText(stored.text), ink: docFrom(strokes) };
  }
  if (stored.kind !== 'choice') return emptyDraft(paper);
  const { optionIndex } = stored;
  return optionIndex !== null && optionIndex < paper.options.length ? stored : emptyDraft(paper);
}

// The same normalization the server applies, so a submit button that is enabled never gets refused as `bad_ballot`.
export function modeContent(draft: FreeformDraft, mode: BallotMode): BallotContent | null {
  if (mode === 'type') return normalizeBallotContent({ kind: 'text', text: draft.text }, FREEFORM);
  const strokes = fitInk(draft.ink.strokes);
  return strokes === null ? null : normalizeBallotContent({ kind: 'ink', strokes }, FREEFORM);
}

export function draftContent(draft: BallotDraft, paper: Paper): BallotContent | null {
  if (draft.kind === 'freeform') return modeContent(draft, draft.mode);
  if (draft.optionIndex === null) return null;
  return normalizeBallotContent({ kind: 'choice', optionIndex: draft.optionIndex }, paper);
}

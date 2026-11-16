import { z } from 'zod';
import { normalizeBallotContent, OPTIONS_MAX, TEXT_MAX } from '../../shared/vote.ts';
import type { BallotContent, Paper } from '../../shared/vote.ts';

export const ballotDraftSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(TEXT_MAX * 2) }),
  z.object({ kind: z.literal('choice'), optionIndex: z.number().int().min(0).max(OPTIONS_MAX - 1).nullable() }),
]);

// What the participant has on the paper so far. A choice paper starts with nothing circled.
export type BallotDraft = z.infer<typeof ballotDraftSchema>;

export const emptyDraft = (paper: Paper): BallotDraft =>
  paper.kind === 'freeform' ? { kind: 'text', text: '' } : { kind: 'choice', optionIndex: null };

// A stored draft belongs to a vote, but the paper it was written on may not be the one on screen now.
export function restoreDraft(stored: BallotDraft | null, paper: Paper): BallotDraft {
  if (stored === null) return emptyDraft(paper);
  if (paper.kind === 'freeform') return stored.kind === 'text' ? stored : emptyDraft(paper);
  if (stored.kind !== 'choice') return emptyDraft(paper);
  const { optionIndex } = stored;
  return optionIndex !== null && optionIndex < paper.options.length ? stored : emptyDraft(paper);
}

// The same normalization the server applies, so a submit button that is enabled never gets refused as `bad_ballot`.
export function draftContent(draft: BallotDraft, paper: Paper): BallotContent | null {
  if (draft.kind === 'text') return normalizeBallotContent({ kind: 'text', text: draft.text }, paper);
  if (draft.optionIndex === null) return null;
  return normalizeBallotContent({ kind: 'choice', optionIndex: draft.optionIndex }, paper);
}

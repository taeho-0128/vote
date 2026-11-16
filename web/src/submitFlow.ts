import type { BallotContent } from '../../shared/vote.ts';
import type { Refusal } from './useCommand.ts';

// Where the writing paper sat on screen when the participant confirmed, so the folding stage can start from it.
export interface PaperRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// A ballot's trip from the pen to the box. Only `folding` plays the animation, and only the server's acceptance
// (the snapshot turning `submitted` true while a command was in flight) gets there.
export type SubmitFlow =
  | { readonly phase: 'writing' }
  | { readonly phase: 'sending'; readonly content: BallotContent; readonly rect: PaperRect | null }
  | {
      readonly phase: 'folding';
      readonly content: BallotContent;
      readonly rect: PaperRect | null;
      // The box count before this ballot, which the stage counts up from.
      readonly from: number;
    }
  | { readonly phase: 'done' }
  | { readonly phase: 'static' };

export type FlowPhase = SubmitFlow['phase'];

export interface FlowFacts {
  readonly submitted: boolean;
  // The snapshot's `submittedCount`, which already holds this participant's ballot once `submitted` is true.
  readonly count: number;
  readonly busy: boolean;
  readonly refusal: Refusal | null;
}

const WRITING: SubmitFlow = { phase: 'writing' };
const DONE: SubmitFlow = { phase: 'done' };
const STATIC: SubmitFlow = { phase: 'static' };

export const initialFlow = (submitted: boolean): SubmitFlow => (submitted ? STATIC : WRITING);

export const startSending = (content: BallotContent, rect: PaperRect | null): SubmitFlow => ({
  phase: 'sending',
  content,
  rect,
});

export const finishFolding = (flow: SubmitFlow): SubmitFlow => (flow.phase === 'folding' ? DONE : flow);

// What the room and the command say about the flow right now. It returns the same object when nothing changed, so
// a caller can compare identities.
export function advance(flow: SubmitFlow, facts: FlowFacts): SubmitFlow {
  if (flow.phase === 'writing') return facts.submitted ? STATIC : flow;
  if (flow.phase !== 'sending') return flow;
  if (facts.submitted) {
    return { phase: 'folding', content: flow.content, rect: flow.rect, from: Math.max(0, facts.count - 1) };
  }
  if (facts.refusal === 'already_submitted') return STATIC;
  return facts.busy ? flow : WRITING;
}

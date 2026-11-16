import type { BallotContent } from '../../shared/vote.ts';

// What the results stage shows. A pile is the folded, unopened papers. Folded is the one current paper kept shut,
// which is what a hidden display shows. Paper is an opened one.
export type StageFace =
  | { readonly kind: 'pile' }
  | { readonly kind: 'folded' }
  | { readonly kind: 'paper'; readonly slot: number; readonly content: BallotContent; readonly signature: string | null };

export type Play = 'none' | 'unfold' | 'fade';

export interface Layer {
  readonly key: number;
  readonly face: StageFace;
  readonly play: Play;
  readonly running: boolean;
}

// The face that was on stage before. It fades out, or only stays long enough for the new layer to take the slip it
// starts from.
export interface Ghost {
  readonly key: number;
  readonly face: StageFace;
  readonly fade: boolean;
}

export interface StageState {
  readonly layer: Layer;
  readonly ghost: Ghost | null;
  readonly nextKey: number;
  // A paper just snapped in over a running play. Papers keep snapping until things go quiet, or a quick run of presses
  // would alternate between a snap and a fresh unfold.
  readonly settling: boolean;
}

export const faceId = (face: StageFace): string => (face.kind === 'paper' ? `paper:${face.slot}` : face.kind);

// A late join or a reload starts at rest, so nothing plays for what was already on the screen.
export const initialStage = (face: StageFace): StageState => ({
  layer: { key: 0, face, play: 'none', running: false },
  ghost: null,
  nextKey: 1,
  settling: false,
});

// The one place that decides what plays when the face changes. The newest face always wins: while a layer is still
// playing, the next face snaps in at rest instead of queueing behind it.
export function advance(state: StageState, face: StageFace, reduced: boolean): StageState {
  const prev = state.layer;
  if (faceId(face) === faceId(prev.face)) return state;

  const key = state.nextKey;
  const next = (play: Play, ghost: Ghost | null): StageState => ({
    layer: { key, face, play, running: play !== 'none' },
    ghost,
    nextKey: key + 1,
    settling: false,
  });
  const ghost = (fade: boolean): Ghost => ({ key: prev.key, face: prev.face, fade });

  if (prev.running || state.settling) return { ...next('none', null), settling: true };
  // A hidden display must never keep showing what it was told to cover.
  if (face.kind === 'folded') return next('none', null);
  if (reduced) return next('fade', ghost(true));
  if (face.kind === 'paper' && !(prev.face.kind === 'paper' && face.slot < prev.face.slot)) {
    return next('unfold', ghost(prev.face.kind !== 'folded'));
  }
  return next('fade', ghost(true));
}

export const finish = (state: StageState, key: number): StageState =>
  state.layer.key === key && state.layer.running ? { ...state, layer: { ...state.layer, running: false } } : state;

export const calm = (state: StageState): StageState => (state.settling ? { ...state, settling: false } : state);

export const release = (state: StageState, key: number): StageState =>
  state.ghost?.key === key ? { ...state, ghost: null } : state;

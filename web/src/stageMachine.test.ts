import { describe, expect, it } from 'vitest';
import { advance, calm, faceId, finish, initialStage, release } from './stageMachine.ts';
import type { StageFace } from './stageMachine.ts';

const paper = (slot: number): StageFace => ({ kind: 'paper', slot, content: { kind: 'text', text: `용지 ${slot}` }, signature: null });
const pile: StageFace = { kind: 'pile' };
const folded: StageFace = { kind: 'folded' };

const settled = (face: StageFace) => initialStage(face);
const played = (state: ReturnType<typeof initialStage>) => finish(state, state.layer.key);

describe('stage transitions', () => {
  it('shows a screen opened late at rest, with nothing playing', () => {
    const state = settled(paper(3));
    expect(state.layer.play).toBe('none');
    expect(state.layer.running).toBe(false);
    expect(state.ghost).toBeNull();
  });

  it('keeps the same state while the face stays the same', () => {
    const state = settled(paper(2));
    expect(advance(state, paper(2), false)).toBe(state);
  });

  it('unfolds the next paper out of the pile and fades the pile out', () => {
    const next = advance(settled(pile), paper(0), false);
    expect(next.layer).toMatchObject({ play: 'unfold', running: true });
    expect(next.ghost).toMatchObject({ fade: true });
    expect(next.ghost?.face.kind).toBe('pile');
  });

  it('unfolds each later paper and lets the old one fade', () => {
    const next = advance(played(advance(settled(pile), paper(0), false)), paper(1), false);
    expect(next.layer.play).toBe('unfold');
    expect(next.ghost?.face).toEqual(expect.objectContaining({ kind: 'paper', slot: 0 }));
    expect(next.ghost?.fade).toBe(true);
  });

  it('unfolds from the folded paper in place when a hidden display is uncovered', () => {
    const next = advance(settled(folded), paper(4), false);
    expect(next.layer.play).toBe('unfold');
    expect(next.ghost).toMatchObject({ fade: false });
  });

  it('cross-fades when going back', () => {
    const next = advance(settled(paper(5)), paper(4), false);
    expect(next.layer.play).toBe('fade');
    expect(next.ghost).toMatchObject({ fade: true });
  });

  it('snaps to the newest paper when one is still unfolding, never queueing', () => {
    const first = advance(settled(pile), paper(0), false);
    const second = advance(first, paper(1), false);
    expect(second.layer).toMatchObject({ play: 'none', running: false });
    expect(second.ghost).toBeNull();
    const third = advance(second, paper(2), false);
    expect(third.layer.play).toBe('none');
    expect(faceId(third.layer.face)).toBe('paper:2');
    expect(advance(third, paper(3), false).layer.play).toBe('none');
  });

  it('unfolds again once a run of quick presses has gone quiet', () => {
    const first = advance(settled(pile), paper(0), false);
    const burst = advance(first, paper(1), false);
    expect(advance(calm(burst), paper(2), false).layer.play).toBe('unfold');
  });

  it('plays again once the running unfold has finished', () => {
    const first = advance(settled(pile), paper(0), false);
    const next = advance(finish(first, first.layer.key), paper(1), false);
    expect(next.layer.play).toBe('unfold');
  });

  it('covers a hidden display at once, with no ghost of the paper', () => {
    const next = advance(settled(paper(2)), folded, false);
    expect(next.layer.play).toBe('none');
    expect(next.ghost).toBeNull();
  });

  it('fades instead of unfolding under reduced motion', () => {
    const next = advance(settled(pile), paper(0), true);
    expect(next.layer.play).toBe('fade');
  });

  it('ignores a finish or release for a layer that is already gone', () => {
    const first = advance(settled(pile), paper(0), false);
    const second = advance(first, paper(1), false);
    expect(finish(second, first.layer.key)).toBe(second);
    expect(release(first, 99)).toBe(first);
    expect(release(first, first.ghost?.key ?? -1).ghost).toBeNull();
  });
});

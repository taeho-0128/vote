import { describe, expect, it } from 'vitest';
import { INK_MAX_POINTS, INK_MAX_POINTS_PER_STROKE, INK_MAX_STROKES } from '../../shared/ink.ts';
import type { InkStroke } from '../../shared/ink.ts';
import { normalizeBallotContent } from '../../shared/vote.ts';
import {
  addStroke,
  canAddStroke,
  clearAll,
  commit,
  docFrom,
  ERASER_RADIUS,
  erase,
  fitInk,
  sampleSegment,
  simplify,
  strokePath,
  undo,
} from './ink.ts';
import type { InkDoc, Pt } from './ink.ts';

const FREEFORM = { kind: 'freeform' } as const;
const line = (x0: number, y0: number, x1: number, y1: number, w: InkStroke['w'] = 'thin'): InkStroke => ({
  w,
  pts: [x0, y0, x1, y1],
});
const pointsOf = (strokes: readonly InkStroke[]) => strokes.reduce((sum, s) => sum + s.pts.length / 2, 0);

// Every vertex sticks out far past the largest tolerance, so simplifying cannot thin it.
const zigzag = (count: number, y: number): number[] =>
  Array.from({ length: count }, (_, i) => [i * 2, y + (i % 2 === 0 ? 0 : 60)]).flat();

describe('simplify', () => {
  it('drops points that lie on the line between their neighbours', () => {
    expect(simplify([0, 0, 10, 0, 20, 0, 30, 0], 1.5)).toEqual([0, 0, 30, 0]);
  });

  it('keeps a corner', () => {
    expect(simplify([0, 0, 50, 0, 50, 50], 1.5)).toEqual([0, 0, 50, 0, 50, 50]);
  });

  it('rounds to integers and clamps into the paper', () => {
    expect(simplify([-5.4, 10.6, 1200.2, 1500.5], 1.5)).toEqual([0, 11, 1000, 1333]);
  });

  it('collapses repeated points into a dot', () => {
    expect(simplify([40, 40, 40, 40, 40.2, 40.1], 1.5)).toEqual([40, 40]);
  });

  it('handles a long stroke without recursing', () => {
    const pts = Array.from({ length: 40000 }, (_, i) => (i % 2 === 0 ? i / 100 : Math.sin(i / 200) * 400 + 600));
    expect(simplify(pts, 1.5).length).toBeLessThan(pts.length);
  });
});

describe('adding strokes and history', () => {
  it('adds a simplified stroke and records the step', () => {
    const doc = addStroke(docFrom([]), 'thin', [0, 0, 10, 0, 20, 0])!;
    expect(doc.strokes).toEqual([{ w: 'thin', pts: [0, 0, 20, 0] }]);
    expect(doc.history).toEqual([[]]);
  });

  it('stores a tap as a one-point stroke', () => {
    const doc = addStroke(docFrom([]), 'thick', [300, 400, 300, 400])!;
    expect(doc.strokes).toEqual([{ w: 'thick', pts: [300, 400] }]);
  });

  it('undoes one action at a time and stops at the start', () => {
    const one = addStroke(docFrom([]), 'thin', [0, 0, 10, 10])!;
    const two = addStroke(one, 'thin', [20, 20, 30, 30])!;
    const back = undo(two);
    expect(back.strokes).toEqual(one.strokes);
    expect(undo(undo(back)).strokes).toEqual([]);
    const empty = docFrom([]);
    expect(undo(empty)).toBe(empty);
  });

  it('clears everything as one undoable action', () => {
    let doc: InkDoc = docFrom([]);
    for (let i = 0; i < 5; i++) doc = addStroke(doc, 'thin', [0, i * 50, 100, i * 50])!;
    const cleared = clearAll(doc);
    expect(cleared.strokes).toEqual([]);
    expect(undo(cleared).strokes).toEqual(doc.strokes);
    expect(clearAll(cleared)).toBe(cleared);
  });

  it('keeps the history bounded', () => {
    let doc: InkDoc = docFrom([]);
    for (let i = 0; i < 150; i++) doc = addStroke(doc, 'thin', [0, 0, 10 + i, 10])!;
    expect(doc.history.length).toBe(100);
  });

  it('ignores a commit that changes nothing', () => {
    const doc = docFrom([line(0, 0, 10, 10)]);
    expect(commit(doc, doc.strokes)).toBe(doc);
  });
});

describe('erase', () => {
  const across = (x: number, y0: number, y1: number): Pt[] => [[x, y0], ...sampleSegment([x, y0], [x, y1], ERASER_RADIUS / 2)];

  it('returns the same array when the eraser misses', () => {
    const strokes = [line(0, 100, 900, 100)];
    expect(erase(strokes, [[500, 600]], ERASER_RADIUS)).toBe(strokes);
  });

  it('splits a long straight stroke at the gap even though it has no vertex there', () => {
    const [left, right] = erase([line(0, 100, 900, 100)], [[450, 100]], ERASER_RADIUS);
    expect(left!.pts).toEqual([0, 100, 422, 100]);
    expect(right!.pts).toEqual([478, 100, 900, 100]);
  });

  it('keeps no point inside the eraser radius', () => {
    const out = erase([line(0, 100, 900, 100)], across(450, 60, 140), ERASER_RADIUS);
    expect(out.length).toBe(2);
    for (const s of out) {
      for (let i = 0; i < s.pts.length; i += 2) expect(Math.abs(s.pts[i]! - 450)).toBeGreaterThanOrEqual(ERASER_RADIUS - 1);
    }
  });

  it('removes a stroke the eraser covers completely', () => {
    expect(erase([line(100, 100, 120, 100)], [[110, 100]], ERASER_RADIUS)).toEqual([]);
  });

  it('removes a tapped dot only when the eraser reaches it', () => {
    const dot: InkStroke = { w: 'thin', pts: [300, 300] };
    expect(erase([dot], [[300, 310]], ERASER_RADIUS)).toEqual([]);
    const kept = [dot];
    expect(erase(kept, [[300, 400]], ERASER_RADIUS)).toBe(kept);
  });

  it('cuts a bent stroke at every pass and leaves the other strokes alone', () => {
    const bent: InkStroke = { w: 'thick', pts: [0, 0, 400, 0, 400, 400, 0, 400] };
    const other = line(900, 900, 950, 950);
    const out = erase([bent, other], [[200, 0], [400, 200]], ERASER_RADIUS);
    expect(out.length).toBe(4);
    expect(out[3]).toBe(other);
    expect(out.slice(0, 3).every((s) => s.w === 'thick')).toBe(true);
  });

  it('keeps the corner when the eraser only grazes the straight part', () => {
    const bent: InkStroke = { w: 'thin', pts: [0, 0, 400, 0, 400, 400] };
    const out = erase([bent], [[100, 0]], ERASER_RADIUS);
    expect(out.length).toBe(2);
    expect(out[1]!.pts).toEqual([128, 0, 400, 0, 400, 400]);
  });

  it('drops specks left at the edge of the eraser', () => {
    expect(erase([line(0, 100, 29, 100)], [[29, 100]], ERASER_RADIUS)).toEqual([]);
  });

  it('is one undo step when committed once', () => {
    const doc = docFrom([line(0, 100, 900, 100)]);
    const erased = commit(doc, erase(doc.strokes, across(450, 60, 140), ERASER_RADIUS))!;
    expect(erased.strokes.length).toBe(2);
    expect(undo(erased).strokes).toEqual(doc.strokes);
  });
});

describe('limits', () => {
  it('passes a normal paper through unchanged', () => {
    const strokes = [line(0, 0, 500, 500), line(10, 10, 20, 20, 'thick')];
    expect(fitInk(strokes)).toEqual(strokes);
  });

  it('thins strokes with a coarser tolerance until the total fits', () => {
    const wavy = (y: number): InkStroke => ({
      w: 'thin',
      pts: Array.from({ length: 80 }, (_, i) => [i * 12, y + Math.round(Math.sin(i / 3) * 6)]).flat(),
    });
    const strokes = Array.from({ length: 80 }, (_, i) => wavy(10 + i * 15));
    expect(pointsOf(strokes)).toBeGreaterThan(INK_MAX_POINTS);
    const fitted = fitInk(strokes)!;
    expect(fitted.length).toBe(80);
    expect(pointsOf(fitted)).toBeLessThanOrEqual(INK_MAX_POINTS);
  });

  it('refuses a paper that no tolerance can fit', () => {
    const strokes = Array.from({ length: 20 }, (_, i) => ({ w: 'thin' as const, pts: zigzag(400, i * 50) }));
    expect(fitInk(strokes)).toBeNull();
  });

  it('stops accepting strokes at the stroke limit', () => {
    let doc: InkDoc = docFrom([]);
    for (let i = 0; i < INK_MAX_STROKES; i++) doc = addStroke(doc, 'thin', [0, 0, 5, 5 + (i % 900)])!;
    expect(doc.strokes.length).toBe(INK_MAX_STROKES);
    expect(canAddStroke(doc)).toBe(false);
    expect(addStroke(doc, 'thin', [0, 0, 50, 50])).toBeNull();
  });

  it('rejects the stroke that would push the total past the limit, and accepts one after an undo', () => {
    let doc: InkDoc = docFrom([]);
    let rejectedAt = -1;
    for (let i = 0; i < 20 && rejectedAt < 0; i++) {
      const next = addStroke(doc, 'thin', zigzag(300, (i % 16) * 80));
      if (next === null) rejectedAt = i;
      else doc = next;
    }
    expect(rejectedAt).toBeGreaterThan(10);
    expect(fitInk(doc.strokes)).not.toBeNull();
    expect(canAddStroke(undo(doc))).toBe(true);
  });

  it('never stores a stroke past the per-stroke cap', () => {
    const doc = addStroke(docFrom([]), 'thin', zigzag(2600, 100));
    expect(doc === null || doc.strokes[0]!.pts.length <= INK_MAX_POINTS_PER_STROKE * 2).toBe(true);
  });

  it('produces a ballot that the server-side normalizer accepts', () => {
    let doc: InkDoc = docFrom([]);
    doc = addStroke(doc, 'thin', [10.4, 20.6, 400.2, 410.7, 800, 1300.4])!;
    doc = addStroke(doc, 'thick', [1500, 1500, 20, 20])!;
    const strokes = fitInk(doc.strokes)!;
    expect(normalizeBallotContent({ kind: 'ink', strokes }, FREEFORM)).toEqual({ kind: 'ink', strokes });
  });
});

describe('strokePath', () => {
  it('draws two points as a straight line and a single point as nothing', () => {
    expect(strokePath([10, 20, 30, 40])).toBe('M10 20L30 40');
    expect(strokePath([10, 20])).toBe('');
  });

  it('curves through the midpoints like the canvas writer and ends on the last point', () => {
    expect(strokePath([0, 0, 100, 0, 100, 100, 200, 100])).toBe('M0 0Q100 0 100 50Q100 100 150 100L200 100');
  });
});

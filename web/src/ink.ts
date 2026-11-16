import {
  INK_HEIGHT,
  INK_MAX_POINTS,
  INK_MAX_POINTS_PER_STROKE,
  INK_MAX_STROKES,
  INK_WIDTH,
  inkPointCount,
} from '../../shared/ink.ts';
import type { InkStroke } from '../../shared/ink.ts';

export type Pt = readonly [x: number, y: number];

// Pen widths in the 1000-unit paper space, so a stroke looks the same at any screen size.
export const PEN_WIDTH: Record<InkStroke['w'], number> = { thin: 10, thick: 20 };
export const ERASER_RADIUS = 28;

// Strokes are stored at the base tolerance. Only a paper that is still too big gets the coarser ones, at submit.
const BASE_TOLERANCE = 1.5;
const COARSER_TOLERANCES = [3, 5, 8, 12] as const;
const HISTORY_MAX = 100;
// Eraser leftovers shorter than this are specks, not handwriting.
const MIN_PIECE_LENGTH = 2;

export interface InkDoc {
  readonly strokes: readonly InkStroke[];
  // Every earlier `strokes` value, newest last. One entry per action, so an erase or a clear undoes in one step.
  readonly history: readonly (readonly InkStroke[])[];
}

export const docFrom = (strokes: readonly InkStroke[]): InkDoc => ({ strokes, history: [] });

const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Ramer-Douglas-Peucker on a flat [x0, y0, x1, y1, ...] list, then rounded to the integers the contract stores.
export function simplify(pts: readonly number[], tolerance: number): number[] {
  const n = pts.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const pending: [number, number][] = [[0, n - 1]];
  while (pending.length > 0) {
    const [a, b] = pending.pop()!;
    let far = -1;
    let farDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[2 * i]!, pts[2 * i + 1]!, pts[2 * a]!, pts[2 * a + 1]!, pts[2 * b]!, pts[2 * b + 1]!);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      pending.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const x = clamp(pts[2 * i]!, INK_WIDTH);
    const y = clamp(pts[2 * i + 1]!, INK_HEIGHT);
    if (out.length >= 2 && out[out.length - 2] === x && out[out.length - 1] === y) continue;
    out.push(x, y);
  }
  return out;
}

const within = (strokes: readonly InkStroke[]) =>
  strokes.length <= INK_MAX_STROKES &&
  inkPointCount(strokes) <= INK_MAX_POINTS &&
  strokes.every((s) => s.pts.length <= INK_MAX_POINTS_PER_STROKE * 2);

// The strokes as they will be submitted, or null when no tolerance gets them inside the contract's limits.
export function fitInk(strokes: readonly InkStroke[]): InkStroke[] | null {
  if (strokes.length > INK_MAX_STROKES) return null;
  if (within(strokes)) return strokes.map((s) => ({ w: s.w, pts: [...s.pts] }));
  for (const tolerance of COARSER_TOLERANCES) {
    const next = strokes.map((s) => ({ w: s.w, pts: simplify(s.pts, tolerance) }));
    if (within(next)) return next;
  }
  return null;
}

// A stroke from outside this module (a stored draft) brought to the shape the module itself produces.
export const normalizeStroke = (s: InkStroke): InkStroke => ({ w: s.w, pts: simplify(s.pts, BASE_TOLERANCE) });

const PROBE: InkStroke = { w: 'thin', pts: [0, 0] };

// Whether one more stroke, however short, still fits.
export const canAddStroke = (doc: InkDoc): boolean => fitInk([...doc.strokes, PROBE]) !== null;

function shrinkToStrokeCap(w: InkStroke['w'], pts: readonly number[]): InkStroke | null {
  for (const tolerance of [BASE_TOLERANCE, ...COARSER_TOLERANCES]) {
    const next = simplify(pts, tolerance);
    if (next.length <= INK_MAX_POINTS_PER_STROKE * 2) return { w, pts: next };
  }
  return null;
}

// Replacing the strokes is one history step. Null means the result would not fit and nothing changed.
export function commit(doc: InkDoc, strokes: readonly InkStroke[]): InkDoc | null {
  if (strokes === doc.strokes) return doc;
  if (fitInk(strokes) === null) return null;
  return { strokes, history: [...doc.history, doc.strokes].slice(-HISTORY_MAX) };
}

export function addStroke(doc: InkDoc, w: InkStroke['w'], pts: readonly number[]): InkDoc | null {
  if (pts.length < 2) return null;
  const stroke = shrinkToStrokeCap(w, pts);
  return stroke === null ? null : commit(doc, [...doc.strokes, stroke]);
}

export function undo(doc: InkDoc): InkDoc {
  const last = doc.history.at(-1);
  return last === undefined ? doc : { strokes: last, history: doc.history.slice(0, -1) };
}

export const clearAll = (doc: InkDoc): InkDoc => (doc.strokes.length === 0 ? doc : commit(doc, [])!);

// Points between a (exclusive) and b (inclusive), at most `step` apart.
export function sampleSegment(a: Pt, b: Pt, step: number): Pt[] {
  const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / count;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const;
  });
}

// Parameter range [t0, t1] of the segment p->q that lies inside the circle, or null when it misses.
function circleCut(p: Pt, q: Pt, c: Pt, r: number): [number, number] | null {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const fx = p[0] - c[0];
  const fy = p[1] - c[1];
  const a = dx * dx + dy * dy;
  const k = fx * fx + fy * fy - r * r;
  if (a === 0) return k <= 0 ? [0, 1] : null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * k;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  return t1 < 0 || t0 > 1 ? null : [Math.max(0, t0), Math.min(1, t1)];
}

// The stretches of one segment left after removing the cut ranges, as [from, to] parameters.
function keptRanges(cuts: [number, number][]): [number, number][] {
  const kept: [number, number][] = [];
  let at = 0;
  for (const [from, to] of cuts.sort((x, y) => x[0] - y[0])) {
    if (from > at) kept.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1) kept.push([at, 1]);
  return kept;
}

// What is left of a stroke after the eraser circles pass over it: its visible runs, or null when nothing touched it.
function cutStroke(stroke: InkStroke, centers: readonly Pt[], r: number): InkStroke[] | null {
  const { pts, w } = stroke;
  const n = pts.length / 2;
  const at = (i: number): Pt => [pts[2 * i]!, pts[2 * i + 1]!];
  if (n === 1) return centers.some((c) => Math.hypot(pts[0]! - c[0], pts[1]! - c[1]) <= r) ? [] : null;

  const runs: number[][] = [];
  let open: number[] | null = null;
  let touched = false;
  for (let i = 0; i < n - 1; i++) {
    const p = at(i);
    const q = at(i + 1);
    const cuts = centers.map((c) => circleCut(p, q, c, r)).filter((cut) => cut !== null);
    if (cuts.length > 0) touched = true;
    const lerp = (t: number): Pt => (t === 1 ? q : [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    const kept = keptRanges(cuts);
    for (const [from, to] of kept) {
      if (from === 0 && open !== null) open.push(...lerp(to));
      else {
        if (open !== null) runs.push(open);
        open = [...lerp(from), ...lerp(to)];
      }
      if (to < 1) {
        runs.push(open);
        open = null;
      }
    }
    // A run still open here reached this segment's start but the eraser took the whole segment.
    if (open !== null && kept.length === 0) {
      runs.push(open);
      open = null;
    }
  }
  if (open !== null) runs.push(open);
  if (!touched) return null;

  return runs
    .map((run) => simplify(run, BASE_TOLERANCE))
    .filter((run) => run.length >= 4 && pathLength(run) >= MIN_PIECE_LENGTH)
    .map((run) => ({ w, pts: run }));
}

const pathLength = (pts: readonly number[]) => {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return total;
};

// Removes everything within `radius` of any center and splits strokes at the gaps. Returns the same array when
// nothing was touched, so callers can tell whether the erase did anything.
export function erase(strokes: readonly InkStroke[], centers: readonly Pt[], radius: number): readonly InkStroke[] {
  let changed = false;
  const next: InkStroke[] = [];
  for (const stroke of strokes) {
    const pieces = cutStroke(stroke, centers, radius);
    if (pieces === null) next.push(stroke);
    else {
      changed = true;
      next.push(...pieces);
    }
  }
  return changed ? next : strokes;
}

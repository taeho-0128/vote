import { useEffect, useLayoutEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { INK_HEIGHT, INK_WIDTH } from '../../../shared/ink.ts';
import type { InkStroke } from '../../../shared/ink.ts';
import { addStroke, canAddStroke, commit, ERASER_RADIUS, erase, fitInk, PEN_WIDTH, sampleSegment } from '../ink.ts';
import type { InkDoc, Pt } from '../ink.ts';

export type InkTool = InkStroke['w'] | 'eraser';

interface InkCanvasProps {
  doc: InkDoc;
  tool: InkTool;
  describedBy: string;
  onDoc: (doc: InkDoc) => void;
  // A stroke or an erase step was refused because the paper has no room left.
  onFull: () => void;
}

type Gesture =
  | { kind: 'pen'; id: number; type: string; w: InkStroke['w']; pts: number[] }
  | { kind: 'erase'; id: number; type: string; at: Pt; working: readonly InkStroke[] };

// A stylus is a fact about the device, so it outlives the canvas that saw it when the participant switches modes.
let penSeen = false;

function drawStroke(ctx: CanvasRenderingContext2D, pts: readonly number[], width: number) {
  const n = pts.length / 2;
  ctx.lineWidth = width;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(pts[0]!, pts[1]!, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 1; i < n - 1; i++) {
    const x = pts[2 * i]!;
    const y = pts[2 * i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + pts[2 * i + 2]!) / 2, (y + pts[2 * i + 3]!) / 2);
  }
  ctx.lineTo(pts[2 * n - 2]!, pts[2 * n - 1]!);
  ctx.stroke();
}

export function InkCanvas({ doc, tool, describedBy, onDoc, onFull }: InkCanvasProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const latest = useRef({ doc, tool, onDoc, onFull });

  useLayoutEffect(() => {
    latest.current = { doc, tool, onDoc, onFull };
  });

  const paint = () => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(cv.width / INK_WIDTH, 0, 0, cv.height / INK_HEIGHT, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'currentColor';
    ctx.fillStyle = 'currentColor';
    const g = gesture.current;
    const strokes = g?.kind === 'erase' ? g.working : latest.current.doc.strokes;
    for (const s of strokes) drawStroke(ctx, s.pts, PEN_WIDTH[s.w]);
    if (g?.kind === 'pen') drawStroke(ctx, g.pts, PEN_WIDTH[g.w]);
    if (g?.kind === 'erase') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(g.at[0], g.at[1], ERASER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  };

  const schedule = () => {
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    // Resizing clears the bitmap, so every size change repaints from the stored strokes.
    const observer = new ResizeObserver(() => {
      const ratio = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.round(cv.clientWidth * ratio));
      cv.height = Math.max(1, Math.round(cv.clientHeight * ratio));
      paint();
    });
    observer.observe(cv);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, []);

  useEffect(schedule, [doc.strokes]);

  const toPaper = (event: { clientX: number; clientY: number }): Pt => {
    const rect = canvas.current!.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * INK_WIDTH,
      ((event.clientY - rect.top) / rect.height) * INK_HEIGHT,
    ];
  };

  const eraseAlong = (g: Extract<Gesture, { kind: 'erase' }>, centers: readonly Pt[]) => {
    const next = erase(g.working, centers, ERASER_RADIUS);
    if (next === g.working) return;
    if (fitInk(next) === null) latest.current.onFull();
    else g.working = next;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') penSeen = true;
    else if (e.pointerType === 'touch' && penSeen) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gesture.current !== null) {
      // A palm that landed before the stylus came into range must not leave a stroke behind.
      if (e.pointerType !== 'pen' || gesture.current.type !== 'touch') return;
      gesture.current = null;
    }
    const { doc: current, tool: active, onFull: full } = latest.current;
    if (active !== 'eraser' && !canAddStroke(current)) {
      full();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer already ended, so the stroke below is a tap */
    }
    const at = toPaper(e);
    if (active === 'eraser') {
      const g: Gesture = { kind: 'erase', id: e.pointerId, type: e.pointerType, at, working: current.strokes };
      eraseAlong(g, [at]);
      gesture.current = g;
    } else {
      gesture.current = { kind: 'pen', id: e.pointerId, type: e.pointerType, w: active, pts: [at[0], at[1]] };
    }
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') penSeen = true;
    const g = gesture.current;
    if (g === null || e.pointerId !== g.id) return;
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const event of coalesced.length > 0 ? coalesced : [e.nativeEvent]) {
      const to = toPaper(event);
      if (g.kind === 'pen') g.pts.push(to[0], to[1]);
      else {
        eraseAlong(g, sampleSegment(g.at, to, ERASER_RADIUS / 2));
        g.at = to;
      }
    }
    schedule();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (g === null || e.pointerId !== g.id) return;
    gesture.current = null;
    const { doc: current, onDoc: change, onFull: full } = latest.current;
    if (g.kind === 'pen') {
      const to = toPaper(e);
      const next = addStroke(current, g.w, [...g.pts, to[0], to[1]]);
      if (next === null) full();
      else change(next);
    } else {
      const next = commit(current, g.working);
      if (next !== null && next !== current) change(next);
    }
    schedule();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (gesture.current?.id !== e.pointerId) return;
    gesture.current = null;
    schedule();
  };

  return (
    <canvas
      ref={canvas}
      className="ink-canvas"
      data-testid="ink-canvas"
      role="img"
      aria-label="손글씨 용지"
      aria-describedby={describedBy}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

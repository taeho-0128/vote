import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { BallotContent, Paper } from '../../../shared/vote.ts';
import { playFold } from '../foldTimeline.ts';
import type { PaperRect } from '../submitFlow.ts';
import { FoldPieces } from './FoldPieces.tsx';

export type StageMode =
  | {
      readonly kind: 'folding';
      readonly content: BallotContent;
      readonly paper: Paper;
      readonly signature: string | null;
      readonly from: number;
      readonly rect: PaperRect | null;
      readonly onDone: () => void;
    }
  | { readonly kind: 'rest' };

interface FoldStageProps {
  mode: StageMode;
  // The live box count. While folding, the stage shows its own count until the slip lands.
  count: number;
  // What the stage says once it is at rest. Mounted as a polite live region from the start, so it is announced.
  children: ReactNode;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function FoldStage({ mode, count, children }: FoldStageProps) {
  const folding = mode.kind === 'folding';
  const [landed, setLanded] = useState(false);
  const scene = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const flap = useRef<HTMLDivElement>(null);
  const slip = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const latest = useRef(mode);
  latest.current = mode;

  useLayoutEffect(() => {
    const parts = {
      scene: scene.current,
      paper: paper.current,
      top: top.current,
      flap: flap.current,
      slip: slip.current,
      box: box.current,
      count: counter.current,
    };
    if (!folding || Object.values(parts).some((part) => part === null)) return;
    const run = playFold(parts as Parameters<typeof playFold>[0], {
      reduced: reducedMotion(),
      from: latest.current.kind === 'folding' ? latest.current.rect : null,
      onLand: () => flushSync(() => setLanded(true)),
    });
    let live = true;
    void run.finished.then((played) => {
      if (played && live && latest.current.kind === 'folding') latest.current.onDone();
    });
    return () => {
      live = false;
      run.cancel();
    };
  }, [folding]);

  const resting = mode.kind === 'rest';
  useEffect(() => {
    if (resting && landed) text.current?.focus({ preventScroll: true });
  }, [resting, landed]);

  const shown = mode.kind === 'folding' ? (landed ? mode.from + 1 : mode.from) : count;

  return (
    <div className="scene" ref={scene} data-step={folding ? 'paper' : 'rest'}>
      <div className="scene-in">
        {mode.kind === 'folding' ? (
          <FoldPieces
            content={mode.content}
            paper={mode.paper}
            signature={mode.signature}
            refs={{ paper, top, flap, slip }}
          />
        ) : null}
        <div className="box" ref={box} data-testid="ballot-box" role="img" aria-label={`투표함, ${shown}장`}>
          <div className="box-lid">
            <i className="box-slot" />
          </div>
          <div className="box-front">
            <span className="box-plate">
              투표함
              <b ref={counter} data-testid="box-count">
                {shown}
              </b>
            </span>
          </div>
        </div>
      </div>
      <div className="scene-msg" role="status" aria-live="polite">
        {resting ? (
          <>
            <span className="stamp stamp--big" aria-hidden="true">
              확
            </span>
            <div className="scene-text" ref={text} tabIndex={-1}>
              {children}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

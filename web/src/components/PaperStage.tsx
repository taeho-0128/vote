import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Paper } from '../../../shared/vote.ts';
import { playFade, playUnfold } from '../foldTimeline.ts';
import type { FoldRun } from '../foldTimeline.ts';
import { advance, calm, finish, initialStage, release } from '../stageMachine.ts';
import type { Ghost, Layer, StageFace } from '../stageMachine.ts';
import { useMediaQuery } from '../useMediaQuery.ts';
import { FoldPieces } from './FoldPieces.tsx';
import { PaperFace } from './PaperFace.tsx';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export interface StageIds {
  pile: string;
  folded: string;
  paper: string;
  signature: string;
}

interface PaperStageProps {
  face: StageFace;
  paper: Paper;
  // Papers still folded in the pile, not counting the one on the stage.
  unopened: number;
  ids: StageIds;
}

const SHOWN_SLIPS = 5;
const QUIET_MS = 700;

function Pile({ count, labelled }: { count: number; labelled: boolean }) {
  const shown = Math.min(count, SHOWN_SLIPS);
  return (
    <div className="pile">
      {Array.from({ length: shown }, (_, index) => (
        <i key={index} className="slip" data-slip-origin={index === shown - 1 ? '' : undefined}>
          <i className="crease-v" />
        </i>
      ))}
      {labelled && count > 0 ? (
        <span className="pile-count">
          <span className="pile-count-long">남은 용지 </span>
          {count}장
        </span>
      ) : null}
    </div>
  );
}

interface FaceProps {
  face: StageFace;
  paper: Paper;
  unopened: number;
  ids: StageIds | null;
}

function Folded({ testId }: { testId: string | undefined }) {
  return (
    <div className="folded" data-testid={testId}>
      <i className="slip" data-slip-origin="">
        <i className="crease-v" />
        <i className="crease-h" />
      </i>
    </div>
  );
}

function StaticFace({ face, paper, unopened, ids }: FaceProps) {
  if (face.kind === 'pile') {
    return (
      <div className="rface" data-testid={ids?.pile}>
        <Pile count={unopened} labelled={false} />
      </div>
    );
  }
  if (face.kind === 'folded') {
    return (
      <div className="rface">
        <Folded testId={ids?.folded} />
      </div>
    );
  }
  return (
    <div className="unfold" data-step="rest" data-running="false">
      <div className="unfold-shadow">
        <div className="unfold-rest" data-testid={ids?.paper}>
          <PaperFace content={face.content} paper={paper} signature={face.signature} signatureId={ids?.signature} />
        </div>
      </div>
    </div>
  );
}

interface LiveLayerProps extends FaceProps {
  layer: Layer;
  findOrigin: () => { element: Element; held: boolean } | null;
  onFinish: (key: number) => void;
  onTaken: () => void;
}

function LiveLayer({ layer, face, paper, unopened, ids, findOrigin, onFinish, onTaken }: LiveLayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const unfold = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const flap = useRef<HTMLDivElement>(null);
  const slip = useRef<HTMLDivElement>(null);
  const unfolding = layer.play === 'unfold' && layer.running && face.kind === 'paper';

  useLayoutEffect(() => {
    if (layer.play === 'none') return;
    let run: FoldRun | null = null;
    if (layer.play === 'fade' && root.current) {
      run = playFade(root.current, 'in');
    } else if (unfold.current && top.current && flap.current && slip.current) {
      const origin = findOrigin();
      const from = origin?.element.getBoundingClientRect() ?? null;
      if (origin?.held && origin.element instanceof HTMLElement) origin.element.style.visibility = 'hidden';
      run = playUnfold({ root: unfold.current, top: top.current, flap: flap.current, slip: slip.current }, { from });
      onTaken();
    }
    if (run === null) return;
    const started = run;
    let live = true;
    void started.finished.then((played) => {
      if (played && live) onFinish(layer.key);
    });
    return () => {
      live = false;
      started.cancel();
    };
    // The layer is keyed, so one effect belongs to exactly one layer and re-running it for a new callback would restart the play.
  }, [layer.key]);

  if (face.kind !== 'paper') {
    return (
      <div className="rlayer" ref={root}>
        <StaticFace face={face} paper={paper} unopened={unopened} ids={ids} />
      </div>
    );
  }
  return (
    <div className="rlayer" ref={root}>
      <div className="unfold" ref={unfold} data-step={unfolding ? 'slip' : 'rest'} data-running={unfolding}>
        <div className="unfold-shadow">
          <div className="unfold-in">
            {unfolding ? (
              <FoldPieces content={face.content} paper={paper} signature={face.signature} refs={{ top, flap, slip }} />
            ) : null}
          </div>
          <div className="unfold-rest" data-testid={ids?.paper}>
            <PaperFace content={face.content} paper={paper} signature={face.signature} signatureId={ids?.signature} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface GhostLayerProps {
  ghost: Ghost;
  paper: Paper;
  unopened: number;
  rootRef: RefObject<HTMLDivElement | null>;
  onGone: (key: number) => void;
}

function GhostLayer({ ghost, paper, unopened, rootRef: root, onGone }: GhostLayerProps) {
  useLayoutEffect(() => {
    if (!ghost.fade || !root.current) return;
    const run = playFade(root.current, 'out');
    let live = true;
    void run.finished.then((played) => {
      if (played && live) onGone(ghost.key);
    });
    return () => {
      live = false;
      run.cancel();
    };
  }, [ghost.key, ghost.fade]);

  return (
    <div className="rlayer rlayer--ghost" ref={root} aria-hidden="true" inert>
      <StaticFace face={ghost.face} paper={paper} unopened={unopened} ids={null} />
    </div>
  );
}

// One stage for the host's results and the display. The face it is given is the truth: what plays on the way there
// is decided by stageMachine, and a face that arrives while another is still playing snaps in instead of queueing.
export function PaperStage({ face, paper, unopened, ids }: PaperStageProps) {
  const reduced = useMediaQuery(REDUCED_MOTION);
  const [state, setState] = useState(() => initialStage(face));
  const current = advance(state, face, reduced);
  if (current !== state) setState(current);

  const stage = useRef<HTMLDivElement>(null);
  const ghostEl = useRef<HTMLDivElement>(null);
  const { layer, ghost } = current;

  useEffect(() => {
    if (!current.settling) return;
    const timer = setTimeout(() => setState((s) => calm(s)), QUIET_MS);
    return () => clearTimeout(timer);
  }, [current.settling, layer.key]);

  const findOrigin = () => originOf(stage, ghostEl);
  const dropGhost = (key: number) => setState((s) => release(s, key));

  return (
    <div className="rstage" ref={stage} data-testid="stage" data-play={layer.running ? layer.play : 'rest'}>
      <div className="rstage-in">
        {face.kind !== 'pile' && (unopened > 0 || layer.running) ? (
          <div className="rstage-pile" aria-hidden="true">
            <Pile count={unopened} labelled />
          </div>
        ) : null}
        {ghost ? (
          <GhostLayer key={ghost.key} ghost={ghost} paper={paper} unopened={unopened} rootRef={ghostEl} onGone={dropGhost} />
        ) : null}
        <LiveLayer
          key={layer.key}
          layer={layer}
          face={face}
          paper={paper}
          unopened={unopened}
          ids={ids}
          findOrigin={findOrigin}
          onFinish={(key) => setState((s) => finish(s, key))}
          onTaken={() => {
            if (ghost && !ghost.fade) dropGhost(ghost.key);
          }}
        />
      </div>
    </div>
  );
}

// The slip a new paper is taken from: the one on the face that was just on stage, otherwise the top of the side pile.
// Only a slip on a fading ghost is held back, because the paper has replaced it. An emptied pile still answers with its own box.
function originOf(stage: RefObject<HTMLDivElement | null>, ghost: RefObject<HTMLDivElement | null>) {
  const fromGhost = ghost.current?.querySelector('[data-slip-origin]');
  if (fromGhost) return { element: fromGhost, held: true };
  const fromPile = stage.current?.querySelector('.rstage-pile [data-slip-origin], .rstage-pile .pile');
  return fromPile ? { element: fromPile, held: false } : null;
}

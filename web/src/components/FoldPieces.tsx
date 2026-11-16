import type { RefObject } from 'react';
import type { BallotContent, Paper } from '../../../shared/vote.ts';
import { PaperFace } from './PaperFace.tsx';

export interface FoldPieceRefs {
  paper?: RefObject<HTMLDivElement | null>;
  top: RefObject<HTMLDivElement | null>;
  flap: RefObject<HTMLDivElement | null>;
  slip: RefObject<HTMLDivElement | null>;
}

interface FoldPiecesProps {
  content: BallotContent;
  paper: Paper;
  signature: string | null;
  refs: FoldPieceRefs;
}

// The parts a paper folds into: the sheet in two halves, the strip the folded sheet leaves, and the slip that strip
// ends as. The submit scene plays them forward and the results stage plays them backward, over the same markup.
export function FoldPieces({ content, paper, signature, refs }: FoldPiecesProps) {
  return (
    <>
      <div className="fold-paper" ref={refs.paper} aria-hidden="true">
        <div className="fold-bot">
          <div className="fold-bot-face">
            <PaperFace content={content} paper={paper} signature={signature} />
          </div>
        </div>
        <div className="fold-top" ref={refs.top}>
          <div className="fold-face">
            <PaperFace content={content} paper={paper} signature={signature} />
          </div>
          <div className="fold-back back-side">
            <i className="crease-h" />
          </div>
        </div>
      </div>
      <div className="fold-strip" aria-hidden="true">
        <div className="fold-strip-r back-side">
          <i className="crease-v" />
        </div>
        <div className="fold-flap" ref={refs.flap}>
          <i className="back-side" />
          <i className="back-side" />
        </div>
      </div>
      <div className="fold-slip back-side" ref={refs.slip} aria-hidden="true">
        <i className="crease-v" />
      </div>
    </>
  );
}

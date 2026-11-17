import { memo, useRef } from 'react';
import { INK_HEIGHT, INK_WIDTH } from '../../../shared/ink.ts';
import type { BallotContent, Paper } from '../../../shared/vote.ts';
import { PEN_WIDTH, strokePath } from '../ink.ts';
import { useFittedStyle } from '../useFittedStyle.ts';

// Hand-drawn loop from draft A, stretched to each option's box. Its length is normalized to 1, so a dash offset of 1
// hides it and 0 draws it. The gap is wider than the dash so no round cap is left at the end.
export const RING_PATH =
  'M14 30C3 14 50 4 104 4C160 4 198 12 194 28C190 46 140 50 100 50C48 50 8 46 6 28C5 16 30 8 62 6';

interface PaperFaceProps {
  content: BallotContent;
  // The paper the vote was made with. A choice ballot needs its options to be readable.
  paper: Paper;
  // The nickname signed at the bottom of a named vote's paper.
  signature: string | null;
  signatureId?: string;
}

function Ink({ strokes }: { strokes: Extract<BallotContent, { kind: 'ink' }>['strokes'] }) {
  return (
    <svg className="pface-ink" viewBox={`0 0 ${INK_WIDTH} ${INK_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="손글씨">
      {strokes.map((stroke, index) =>
        stroke.pts.length === 2 ? (
          <circle key={index} cx={stroke.pts[0]} cy={stroke.pts[1]} r={PEN_WIDTH[stroke.w] / 2} />
        ) : (
          <path key={index} d={strokePath(stroke.pts)} strokeWidth={PEN_WIDTH[stroke.w]} />
        ),
      )}
    </svg>
  );
}

function Options({ options, chosen }: { options: readonly string[]; chosen: number }) {
  return (
    <div className="pface-opts">
      {options.map((option, index) => (
        <div key={index} className="pface-opt">
          <span>{option}</span>
          {index === chosen ? (
            <svg className="pface-ring" viewBox="0 0 200 54" preserveAspectRatio="none" aria-hidden="true">
              <path pathLength={1} d={RING_PATH} />
            </svg>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Signature({ signature, signatureId }: { signature: string; signatureId?: string }) {
  return (
    <span className="pface-sig" data-testid={signatureId}>
      — {signature}
    </span>
  );
}

// A typed paper. It is its own component so the count of drawn rows, which sets how far down the text sits, belongs to
// the paper that shows the text.
function TypedSheet({ text, signature, signatureId }: { text: string; signature: string | null; signatureId?: string }) {
  const signed = signature !== null;
  const block = useRef<HTMLParagraphElement>(null);
  const style = useFittedStyle(block, text, signed);
  return (
    <div className={signed ? 'pface-sheet signed' : 'pface-sheet'} style={style}>
      <p className="pface-text" ref={block}>
        {text}
      </p>
      {signed ? <Signature signature={signature} signatureId={signatureId} /> : null}
    </div>
  );
}

// What a ballot says, on the same 3:4 ruled paper the participant wrote it on. It fills the width of its parent and
// sizes everything from that width, so the stage, the results and a projector all use it unchanged.
// Memoized because the host's view arrives again on every reveal command, and an unchanged paper must not redraw its strokes.
export const PaperFace = memo(function PaperFace({ content, paper, signature, signatureId }: PaperFaceProps) {
  if (content.kind === 'text') {
    return (
      <div className="pface">
        <TypedSheet text={content.text} signature={signature} signatureId={signatureId} />
      </div>
    );
  }
  return (
    <div className="pface">
      <div className={signature === null ? 'pface-sheet' : 'pface-sheet signed'}>
        {content.kind === 'ink' ? <Ink strokes={content.strokes} /> : null}
        {content.kind === 'choice' && paper.kind === 'choice' ? (
          <Options options={paper.options} chosen={content.optionIndex} />
        ) : null}
        {signature === null ? null : <Signature signature={signature} signatureId={signatureId} />}
      </div>
    </div>
  );
});

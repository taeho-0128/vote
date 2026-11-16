import type { CSSProperties } from 'react';
import { INK_HEIGHT, INK_WIDTH } from '../../../shared/ink.ts';
import type { BallotContent, Paper } from '../../../shared/vote.ts';
import { PEN_WIDTH, strokePath } from '../ink.ts';
import { fitText, textFitStyle } from '../textFit.ts';

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

// What a ballot says, on the same 3:4 ruled paper the participant wrote it on. It fills the width of its parent and
// sizes everything from that width, so the stage, the results and a projector all use it unchanged.
export function PaperFace({ content, paper, signature }: PaperFaceProps) {
  const signed = signature !== null;
  const typed = content.kind === 'text' ? (textFitStyle(fitText(content.text, signed), signed) as CSSProperties) : undefined;
  return (
    <div className="pface">
      <div className={signed ? 'pface-sheet signed' : 'pface-sheet'} style={typed}>
        {content.kind === 'ink' ? <Ink strokes={content.strokes} /> : null}
        {content.kind === 'text' ? <p className="pface-text">{content.text}</p> : null}
        {content.kind === 'choice' && paper.kind === 'choice' ? (
          <Options options={paper.options} chosen={content.optionIndex} />
        ) : null}
        {signature === null ? null : <span className="pface-sig">— {signature}</span>}
      </div>
    </div>
  );
}

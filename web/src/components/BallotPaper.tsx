import { TEXT_MAX } from '../../../shared/vote.ts';
import type { VotePublic } from '../../../shared/protocol.ts';
import type { BallotDraft } from '../ballot.ts';

interface BallotPaperProps {
  vote: VotePublic;
  // The nickname signed at the bottom of a named vote's paper, null when the vote is anonymous.
  signature: string | null;
  draft: BallotDraft;
  onChange: (draft: BallotDraft) => void;
}

// Hand-drawn loop from draft A, stretched to each option's box. Its length is normalized to 1, so the stylesheet's
// dash offset of 1 hides it and 0 draws it. The gap is wider than the dash so no round cap is left at the end.
const RING_PATH =
  'M14 30C3 14 50 4 104 4C160 4 198 12 194 28C190 46 140 50 100 50C48 50 8 46 6 28C5 16 30 8 62 6';

export function BallotPaper({ vote, signature, draft, onChange }: BallotPaperProps) {
  const { paper } = vote;
  const sign = signature === null ? null : <span className="sig">— {signature}</span>;

  if (paper.kind === 'freeform' && draft.kind === 'text') {
    return (
      <div className="paper-wrap">
        <div className="paper">
          <div className={signature === null ? 'sheet' : 'sheet signed'}>
            <textarea
              data-testid="ballot-text"
              aria-label="투표 용지"
              placeholder="여기에 적어 주세요"
              maxLength={TEXT_MAX}
              value={draft.text}
              onChange={(event) => onChange({ kind: 'text', text: event.target.value })}
            />
            {sign}
          </div>
        </div>
        <p className="count" data-testid="ballot-count">
          {[...draft.text].length} / {TEXT_MAX}
        </p>
      </div>
    );
  }

  if (paper.kind === 'choice' && draft.kind === 'choice') {
    return (
      <div className="paper-wrap">
        <p className="hint">하나를 골라 동그라미를 쳐 주세요.</p>
        <div className="paper">
          <div className={signature === null ? 'sheet' : 'sheet signed'}>
            <div className="opts" role="radiogroup" aria-label="보기">
              {paper.options.map((option, index) => (
                <label key={index} className="opt">
                  <input
                    type="radio"
                    name="ballot-option"
                    data-testid={`ballot-option-${index}`}
                    checked={draft.optionIndex === index}
                    onChange={() => onChange({ kind: 'choice', optionIndex: index })}
                  />
                  <span className="opt-text">{option}</span>
                  <svg className="ring" viewBox="0 0 200 54" preserveAspectRatio="none" aria-hidden="true">
                    <path pathLength={1} d={RING_PATH} />
                  </svg>
                </label>
              ))}
            </div>
            {sign}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

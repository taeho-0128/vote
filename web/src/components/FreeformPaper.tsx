import { useId, useState } from 'react';
import type { ChangeEvent, CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { TEXT_MAX, TEXT_MAX_LINES } from '../../../shared/vote.ts';
import { limitTypedText, modeContent } from '../ballot.ts';
import type { BallotDraft, BallotMode, FreeformDraft } from '../ballot.ts';
import { clearAll, undo } from '../ink.ts';
import type { InkDoc } from '../ink.ts';
import { fitText, textFitStyle } from '../textFit.ts';
import { InkCanvas } from './InkCanvas.tsx';
import type { InkTool } from './InkCanvas.tsx';
import { InkTools } from './InkTools.tsx';

interface FreeformPaperProps {
  draft: FreeformDraft;
  signed: boolean;
  // The signature of a named vote, drawn over the paper in both modes.
  sign: ReactNode;
  onChange: (draft: BallotDraft) => void;
}

const MODES: { mode: BallotMode; testId: string; label: string }[] = [
  { mode: 'write', testId: 'mode-write', label: '쓰기' },
  { mode: 'type', testId: 'mode-type', label: '타이핑' },
];

// Shown when the selected mode is empty but the other one holds something that a submit would leave out.
const OTHER_MODE_HINT: Record<BallotMode, string> = {
  write: '타이핑한 내용은 타이핑 모드에서 낼 수 있어요.',
  type: '손으로 쓴 내용은 쓰기 모드에서 낼 수 있어요.',
};

export function FreeformPaper({ draft, signed, sign, onChange }: FreeformPaperProps) {
  const { mode, text, ink } = draft;
  const [tool, setTool] = useState<InkTool>('thin');
  const [full, setFull] = useState(false);
  const helpId = useId();
  const other: BallotMode = mode === 'write' ? 'type' : 'write';
  const showHint = modeContent(draft, mode) === null && modeContent(draft, other) !== null;

  const typedStyle = textFitStyle(fitText(text, signed), signed) as CSSProperties;

  // The cap is also enforced after the fact, so paste, drop and keyboards that send no Enter key are cut to it as well.
  const type = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const next = limitTypedText(field.value);
    if (next !== field.value) {
      const caret = Math.min(field.selectionStart, next.length);
      requestAnimationFrame(() => field.setSelectionRange(caret, caret));
    }
    onChange({ ...draft, text: next });
  };

  const holdLineCap = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const { value, selectionStart, selectionEnd } = event.currentTarget;
    const afterEnter = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
    if (afterEnter.split('\n').length > TEXT_MAX_LINES) event.preventDefault();
  };

  const setInk = (next: InkDoc) => {
    setFull(false);
    onChange({ ...draft, ink: next });
  };

  return (
    <div className="paper-wrap paper-wrap--free">
      <fieldset className="seg-field">
        <legend className="sr-only">용지에 담는 방법</legend>
        <div className="seg">
          {MODES.map((m) => (
            <label key={m.mode}>
              <input
                type="radio"
                name="ballot-mode"
                data-testid={m.testId}
                checked={mode === m.mode}
                onChange={() => {
                  setFull(false);
                  onChange({ ...draft, mode: m.mode });
                }}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="paper">
        <div className={signed ? 'sheet signed' : 'sheet'}>
          {mode === 'write' ? (
            <InkCanvas doc={ink} tool={tool} describedBy={helpId} onDoc={setInk} onFull={() => setFull(true)} />
          ) : (
            <textarea
              data-testid="ballot-text"
              aria-label="타이핑 용지"
              placeholder="여기에 적어 주세요"
              maxLength={TEXT_MAX}
              value={text}
              style={typedStyle}
              onChange={type}
              onKeyDown={holdLineCap}
            />
          )}
          {sign}
        </div>
      </div>

      {mode === 'write' ? (
        <>
          <p id={helpId} className="sr-only">
            손글씨는 손가락이나 펜으로 직접 써야 해요. 화면을 보지 않고 쓰기 어렵다면 타이핑 모드로 바꿔서 적을 수 있어요.
          </p>
          <InkTools
            tool={tool}
            canUndo={ink.history.length > 0}
            canClear={ink.strokes.length > 0}
            onTool={setTool}
            onUndo={() => setInk(undo(ink))}
            onClear={() => setInk(clearAll(ink))}
          />
          {full ? (
            <p className="ink-full" role="status" data-testid="ink-full-notice">
              용지가 가득 찼어요. 지우거나 되돌려 주세요.
            </p>
          ) : null}
        </>
      ) : (
        <p className="count" data-testid="ballot-count">
          {[...text].length} / {TEXT_MAX}
        </p>
      )}

      {showHint ? (
        <p className="hint mode-hint" role="status" data-testid="mode-hint">
          {OTHER_MODE_HINT[mode]}
        </p>
      ) : null}
    </div>
  );
}

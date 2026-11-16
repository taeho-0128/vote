import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { EXPORT_COPY, SETTINGS_COPY } from '../messages.ts';
import type { VoteExport } from '../useVoteExport.ts';
import { Icon } from './Icon.tsx';
import { Switch } from './Switch.tsx';

interface ResultsSideProps {
  wide: boolean;
  anonymous: boolean;
  hidden: boolean;
  onHidden: (hidden: boolean) => void;
  showAuthor: boolean;
  onShowAuthor: (show: boolean) => void;
  // A choice vote shown one paper at a time can still switch to the graph.
  canRevealAll: boolean;
  onRevealAll: () => void;
  exporter: VoteExport;
  fullscreenButton: ReactNode;
}

function ExportPanel({ anonymous, exporter }: { anonymous: boolean; exporter: VoteExport }) {
  return (
    <section className="panel export-panel" aria-label={EXPORT_COPY.heading}>
      <h2 className="lbl">{EXPORT_COPY.heading}</h2>
      <div className="export-actions">
        <button type="button" className="btn ghost" data-testid="export-csv" onClick={exporter.csv}>
          <Icon name="download" />
          {EXPORT_COPY.csv}
        </button>
        <button type="button" className="btn ghost" data-testid="export-pdf" disabled={exporter.printing} onClick={exporter.pdf}>
          <Icon name="print" />
          {EXPORT_COPY.pdf}
        </button>
      </div>
      <p className="hint">{anonymous ? EXPORT_COPY.hintAnonymous : EXPORT_COPY.hintNamed}</p>
      {exporter.exported ? (
        <p className="hint export-done" role="status" data-testid="export-done">
          <Icon name="check" size={16} />
          {EXPORT_COPY.done}
        </p>
      ) : null}
    </section>
  );
}

// Beside the stage on a laptop. On a phone it sits under the stage, where the switches fold into one labelled row so the
// panel is never a half-visible block at the bottom of the screen, and "전체 공개" and the export stay in plain view.
export function ResultsSide({
  wide,
  anonymous,
  hidden,
  onHidden,
  showAuthor,
  onShowAuthor,
  canRevealAll,
  onRevealAll,
  exporter,
  fullscreenButton,
}: ResultsSideProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  const switches = (
    <>
      <Switch testId="toggle-hidden" label="대화면 가리기" hint="켜면 대화면에는 접힌 용지만 보여요." checked={hidden} onChange={onHidden} />
      {anonymous ? (
        <Switch
          testId="toggle-author"
          label="작성자 보기"
          hint="이 화면에서만 보여요. 대화면에는 나오지 않아요."
          checked={showAuthor}
          onChange={onShowAuthor}
        />
      ) : null}
    </>
  );

  const revealAll = canRevealAll ? (
    <section className="panel">
      <button type="button" className="btn ghost" data-testid="reveal-all" onClick={onRevealAll}>
        전체 공개
      </button>
      <p className="hint">보기별 득표 그래프를 한꺼번에 보여줘요.</p>
    </section>
  ) : null;

  if (wide) {
    return (
      <aside className="results-side" aria-label="결과 도구">
        <section className="panel">
          <h2 className="lbl">{SETTINGS_COPY.label}</h2>
          {switches}
        </section>
        {revealAll}
        <ExportPanel anonymous={anonymous} exporter={exporter} />
      </aside>
    );
  }

  return (
    <aside className="results-side" aria-label="결과 도구">
      {revealAll}
      <section className="panel settings">
        <button
          type="button"
          className="settings-toggle"
          data-testid="settings-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <span className="settings-name">
            <b>{SETTINGS_COPY.label}</b>
            {hidden ? <small>{SETTINGS_COPY.hiddenNow}</small> : <small>대화면 가리기{anonymous ? ', 작성자 보기' : ''}</small>}
          </span>
          <Icon name="down" />
        </button>
        <div id={bodyId} className="settings-body" hidden={!open}>
          {switches}
        </div>
      </section>
      <ExportPanel anonymous={anonymous} exporter={exporter} />
      {fullscreenButton}
    </aside>
  );
}

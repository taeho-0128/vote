// The host's screen is one of these four, and each one has exactly one primary action.
export type HostMode = 'lobby' | 'composer' | 'voting' | 'closed';

interface HostActionsProps {
  mode: HostMode;
  busy: boolean;
  canStart: boolean;
  onCompose: () => void;
  onCancelCompose: () => void;
  onStart: () => void;
  onClose: () => void;
  onDismiss: () => void;
  onOpenDisplay: () => void;
}

export function HostActions({
  mode,
  busy,
  canStart,
  onCompose,
  onCancelCompose,
  onStart,
  onClose,
  onDismiss,
  onOpenDisplay,
}: HostActionsProps) {
  if (mode === 'composer') {
    return (
      <div className="actions">
        <div className="actions-row">
          <button type="button" className="btn ghost" data-testid="cancel-composer" onClick={onCancelCompose}>
            취소
          </button>
          <button type="button" className="btn" data-testid="start-vote" disabled={!canStart || busy} onClick={onStart}>
            투표 시작
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="actions">
      <div className="actions-row">
        <button type="button" className="btn ghost" data-testid="open-display" onClick={onOpenDisplay}>
          대화면 열기
        </button>
        {mode === 'lobby' ? (
          <button type="button" className="btn" data-testid="open-composer" onClick={onCompose}>
            투표 만들기
          </button>
        ) : mode === 'voting' ? (
          <button type="button" className="btn" data-testid="close-vote" disabled={busy} onClick={onClose}>
            마감하기
          </button>
        ) : (
          <button type="button" className="btn ghost" data-testid="dismiss-vote" disabled={busy} onClick={onDismiss}>
            새 투표 만들기
          </button>
        )}
      </div>
    </div>
  );
}

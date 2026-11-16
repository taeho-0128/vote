import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  cancelTestId: string;
  confirmTestId: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// The native modal gives focus trapping, inert background and Escape for free. "Cancel" comes first in the DOM so
// it takes the initial focus: these confirms guard actions that cannot be undone.
export function ConfirmDialog({
  open,
  title,
  children,
  cancelLabel,
  confirmLabel,
  cancelTestId,
  confirmTestId,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm" aria-labelledby={titleId} onClose={() => open && onCancel()}>
      {open ? (
        <>
          <h2 id={titleId} className="confirm-title">
            {title}
          </h2>
          {children}
          <div className="confirm-actions">
            <button type="button" className="btn ghost" data-testid={cancelTestId} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="btn" data-testid={confirmTestId} onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

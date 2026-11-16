import { useEffect, useId, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

interface ConfirmShellProps {
  open: boolean;
  title: string;
  children?: ReactNode;
  // Put on the content, which exists only while the dialog is open, so a page can tell whether it is being asked.
  testId?: string;
  // Escape and the backdrop end the dialog the same way "cancel" does.
  onCancel: () => void;
}

interface TwoChoices {
  cancelLabel: string;
  confirmLabel: string;
  cancelTestId: string;
  confirmTestId: string;
  onConfirm: () => void;
  actions?: undefined;
}

interface OwnActions {
  // Buttons of the caller's own, in focus order: the first one takes the initial focus, so it must be the safe one.
  actions: ReactElement;
}

export type ConfirmDialogProps = ConfirmShellProps & (TwoChoices | OwnActions);

// The native modal gives focus trapping, inert background and Escape for free. "Cancel" comes first in the DOM so
// it takes the initial focus: these confirms guard actions that cannot be undone.
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, title, children, testId, onCancel } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby={titleId}
      onClose={() => open && onCancel()}
      onClick={(event) => {
        // A tap on the dimmed page behind the box lands on the dialog itself, outside its own rectangle.
        const box = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
        if (event.target === event.currentTarget && outside) onCancel();
      }}
    >
      {open ? (
        <div data-testid={testId}>
          <h2 id={titleId} className="confirm-title">
            {title}
          </h2>
          {children}
          {props.actions !== undefined ? (
            <div className="confirm-actions confirm-actions--stack">{props.actions}</div>
          ) : (
            <div className="confirm-actions">
              <button type="button" className="btn ghost" data-testid={props.cancelTestId} onClick={onCancel}>
                {props.cancelLabel}
              </button>
              <button type="button" className="btn" data-testid={props.confirmTestId} onClick={props.onConfirm}>
                {props.confirmLabel}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </dialog>
  );
}

import { useId } from 'react';

interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}

export function Switch({ label, hint, checked, onChange, testId }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      className="sw"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="sw-text">
        <b id={`${id}-label`}>{label}</b>
        {hint ? <small id={`${id}-hint`}>{hint}</small> : null}
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

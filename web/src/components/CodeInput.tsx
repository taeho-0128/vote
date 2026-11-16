import { useRef } from 'react';
import type { ClipboardEvent, ChangeEvent, KeyboardEvent } from 'react';

export const CODE_LENGTH = 4;

interface CodeInputProps {
  digits: readonly string[];
  onChange: (digits: string[]) => void;
}

const onlyDigits = (text: string): string[] => text.replace(/\D/g, '').split('');

export function CodeInput({ digits, onChange }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focusBox = (index: number) => {
    const box = refs.current[Math.max(0, Math.min(index, CODE_LENGTH - 1))];
    box?.focus();
  };

  // Typing, autofill and paste all land here as a run of digits written from `start`.
  const fill = (start: number, typed: string[]) => {
    if (typed.length === 0) return;
    const next = [...digits];
    typed.slice(0, CODE_LENGTH - start).forEach((digit, i) => {
      next[start + i] = digit;
    });
    onChange(next);
    focusBox(Math.min(start + typed.length, CODE_LENGTH - 1));
  };

  const handleChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const typed = onlyDigits(event.target.value);
    if (typed.length === 0) {
      const next = [...digits];
      next[index] = '';
      onChange(next);
      return;
    }
    fill(index, typed);
  };

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next);
      focusBox(index - 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const handlePaste = (index: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const typed = onlyDigits(event.clipboardData.getData('text'));
    fill(typed.length >= CODE_LENGTH ? 0 : index, typed);
  };

  return (
    <div className="code" role="group" aria-label="방 코드 4자리">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          data-testid={`home-code-${i}`}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`${i + 1}번째 숫자`}
          value={digits[i] ?? ''}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onPaste={handlePaste(i)}
          onFocus={(event) => event.target.select()}
        />
      ))}
    </div>
  );
}

import { useEffect, useId, useRef } from 'react';
import { OPTIONS_MAX, OPTIONS_MIN } from '../../../shared/vote.ts';
import type { Anonymity } from '../../../shared/vote.ts';
import { edit, parseForm } from '../composer.ts';
import type { DraftForm, PaperKind } from '../composer.ts';
import { DRAFT_ERROR_COPY } from '../messages.ts';
import { Icon } from './Icon.tsx';

interface SegmentedProps<T extends string> {
  legend: string;
  value: T;
  choices: readonly { value: T; label: string; testId: string }[];
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ legend, value, choices, onChange }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="seg-field">
      <legend className="lbl">{legend}</legend>
      <div className="seg">
        {choices.map((choice) => (
          <label key={choice.value}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              data-testid={choice.testId}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const PAPER_CHOICES = [
  { value: 'freeform', label: '자유 기재', testId: 'paper-freeform' },
  { value: 'choice', label: '객관식', testId: 'paper-choice' },
] as const satisfies readonly { value: PaperKind; label: string; testId: string }[];

const ANONYMITY_CHOICES = [
  { value: 'anonymous', label: '익명', testId: 'anon-anonymous' },
  { value: 'named', label: '기명', testId: 'anon-named' },
] as const satisfies readonly { value: Anonymity; label: string; testId: string }[];

interface ComposerProps {
  form: DraftForm;
  onChange: (form: DraftForm) => void;
}

export function Composer({ form, onChange }: ComposerProps) {
  const titleId = useId();
  const errorId = useId();
  const optionsRef = useRef<HTMLUListElement>(null);
  const focusLastOption = useRef(false);

  const parsed = parseForm(form);
  const error = form.touched && !parsed.ok ? parsed.error : null;

  const { options } = form;
  useEffect(() => {
    if (!focusLastOption.current) return;
    focusLastOption.current = false;
    optionsRef.current?.querySelectorAll('input')[options.length - 1]?.focus();
  }, [options.length]);

  const setOption = (index: number, text: string) =>
    onChange(edit(form, { options: options.map((o, i) => (i === index ? text : o)) }));

  return (
    <section className="composer panel" aria-labelledby="composer-title">
      <h2 id="composer-title" className="composer-title">
        새 투표 만들기
      </h2>

      <div className="field">
        <label htmlFor={titleId}>투표 제목</label>
        <input
          id={titleId}
          className="input"
          data-testid="vote-title"
          value={form.title}
          placeholder="예: 오늘 점심은 뭐가 좋을까요?"
          autoComplete="off"
          aria-invalid={error === 'title'}
          aria-describedby={error === 'title' ? errorId : undefined}
          onChange={(event) => onChange(edit(form, { title: event.target.value }))}
        />
      </div>

      <Segmented
        legend="용지 유형"
        value={form.kind}
        choices={PAPER_CHOICES}
        onChange={(kind) => onChange(edit(form, { kind }))}
      />

      <div>
        <Segmented
          legend="공개 방식"
          value={form.anonymity}
          choices={ANONYMITY_CHOICES}
          onChange={(anonymity) => onChange(edit(form, { anonymity }))}
        />
        <p className="hint seg-hint">익명이면 공개 화면에 이름이 나오지 않아요. 운영자는 작성자를 볼 수 있어요.</p>
      </div>

      {form.kind === 'choice' ? (
        <fieldset className="options">
          <legend className="lbl">
            보기 ({OPTIONS_MIN}~{OPTIONS_MAX}개)
          </legend>
          <ul ref={optionsRef}>
            {options.map((text, index) => (
              <li key={index} className="option-row">
                <input
                  className="input"
                  data-testid={`option-input-${index}`}
                  value={text}
                  aria-label={`보기 ${index + 1}`}
                  autoComplete="off"
                  onChange={(event) => setOption(index, event.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  data-testid={`option-remove-${index}`}
                  aria-label={`보기 ${index + 1} 삭제`}
                  disabled={options.length <= OPTIONS_MIN}
                  onClick={() => onChange(edit(form, { options: options.filter((_, i) => i !== index) }))}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn ghost sm"
            data-testid="option-add"
            disabled={options.length >= OPTIONS_MAX}
            onClick={() => {
              focusLastOption.current = true;
              onChange(edit(form, { options: [...options, ''] }));
            }}
          >
            <Icon name="plus" />
            보기 추가
          </button>
        </fieldset>
      ) : null}

      <div aria-live="polite">
        {error ? (
          <p id={errorId} className="form-error" data-testid="composer-error">
            {DRAFT_ERROR_COPY[error]}
          </p>
        ) : null}
      </div>
    </section>
  );
}

import { normalizeVoteDraft } from '../../shared/vote.ts';
import type { Anonymity, NormalizedDraft, VoteDraft } from '../../shared/vote.ts';

export type PaperKind = 'freeform' | 'choice';

// What the host is typing. `options` outlives a switch back to free-form so toggling the paper type loses nothing.
export interface DraftForm {
  readonly title: string;
  readonly kind: PaperKind;
  readonly anonymity: Anonymity;
  readonly options: readonly string[];
  // Errors stay quiet until the host has changed something, so a fresh form does not open red.
  readonly touched: boolean;
}

export const emptyForm = (): DraftForm => ({
  title: '',
  kind: 'freeform',
  anonymity: 'anonymous',
  options: ['', ''],
  touched: false,
});

export const edit = (form: DraftForm, patch: Partial<Omit<DraftForm, 'touched'>>): DraftForm => ({
  ...form,
  ...patch,
  touched: true,
});

export function parseForm(form: DraftForm): NormalizedDraft {
  const draft: VoteDraft = {
    title: form.title,
    anonymity: form.anonymity,
    paper: form.kind === 'freeform' ? { kind: 'freeform' } : { kind: 'choice', options: [...form.options] },
  };
  return normalizeVoteDraft(draft);
}

import { z } from 'zod';
import { nicknameKey } from './nickname.ts';

export const TITLE_MAX = 60;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 8;
export const OPTION_MAX = 30;
export const TEXT_MAX = 200;

export const anonymitySchema = z.enum(['anonymous', 'named']);

export const paperSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('freeform') }),
  z.object({ kind: z.literal('choice'), options: z.array(z.string().max(200)).max(OPTIONS_MAX) }),
]);

export const voteDraftSchema = z.object({
  title: z.string().max(400),
  paper: paperSchema,
  anonymity: anonymitySchema,
});

export const ballotContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string().max(2000) }),
  z.object({ kind: z.literal('choice'), optionIndex: z.number().int().min(0).max(OPTIONS_MAX - 1) }),
]);

export type Anonymity = z.infer<typeof anonymitySchema>;
export type Paper = z.infer<typeof paperSchema>;
export type VoteDraft = z.infer<typeof voteDraftSchema>;
export type BallotContent = z.infer<typeof ballotContentSchema>;

export type VoteDraftError = 'title' | 'options_count' | 'option_empty' | 'option_long' | 'option_duplicate';

export type NormalizedDraft =
  | { readonly ok: true; readonly draft: VoteDraft }
  | { readonly ok: false; readonly error: VoteDraftError };

const clean = (raw: string) => raw.normalize('NFC').replace(/\p{Cc}/gu, ' ').trim();
const length = (s: string) => [...s].length;

export function normalizeVoteDraft(draft: VoteDraft): NormalizedDraft {
  const title = clean(draft.title);
  if (length(title) < 1 || length(title) > TITLE_MAX) return { ok: false, error: 'title' };
  if (draft.paper.kind === 'freeform') return { ok: true, draft: { ...draft, title } };

  const options = draft.paper.options.map(clean);
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) return { ok: false, error: 'options_count' };
  if (options.some((o) => length(o) < 1)) return { ok: false, error: 'option_empty' };
  if (options.some((o) => length(o) > OPTION_MAX)) return { ok: false, error: 'option_long' };
  if (new Set(options.map(nicknameKey)).size !== options.length) return { ok: false, error: 'option_duplicate' };
  return { ok: true, draft: { ...draft, title, paper: { kind: 'choice', options } } };
}

export function normalizeBallotContent(content: BallotContent, paper: Paper): BallotContent | null {
  if (paper.kind === 'freeform') {
    if (content.kind !== 'text') return null;
    const text = content.text
      .normalize('NFC')
      .replace(/[^\S\n]+/gu, ' ')
      .replace(/\p{Cc}/gu, (c) => (c === '\n' ? c : ''))
      .trim();
    if (length(text) < 1 || length(text) > TEXT_MAX) return null;
    return { kind: 'text', text };
  }
  if (content.kind !== 'choice') return null;
  if (content.optionIndex >= paper.options.length) return null;
  return content;
}

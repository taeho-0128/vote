import { describe, expect, it } from 'vitest';
import { normalizeBallotContent, normalizeVoteDraft, type Paper, type VoteDraft } from './vote.ts';

const choice = (options: string[]): VoteDraft => ({ title: '점심', paper: { kind: 'choice', options }, anonymity: 'anonymous' });

describe('normalizeVoteDraft', () => {
  it('trims the title and accepts a free-form vote', () => {
    const r = normalizeVoteDraft({ title: '  이번 달 MVP는?  ', paper: { kind: 'freeform' }, anonymity: 'named' });
    expect(r).toEqual({ ok: true, draft: { title: '이번 달 MVP는?', paper: { kind: 'freeform' }, anonymity: 'named' } });
  });

  it('rejects an empty or over-long title', () => {
    expect(normalizeVoteDraft({ ...choice(['a', 'b']), title: '   ' })).toEqual({ ok: false, error: 'title' });
    expect(normalizeVoteDraft({ ...choice(['a', 'b']), title: '가'.repeat(61) })).toEqual({ ok: false, error: 'title' });
  });

  it('needs two to eight options', () => {
    expect(normalizeVoteDraft(choice(['하나']))).toEqual({ ok: false, error: 'options_count' });
    expect(normalizeVoteDraft(choice(Array.from({ length: 9 }, (_, i) => `보기${i}`)))).toEqual({ ok: false, error: 'options_count' });
    expect(normalizeVoteDraft(choice(Array.from({ length: 8 }, (_, i) => `보기${i}`))).ok).toBe(true);
  });

  it('rejects blank, long, and duplicate options', () => {
    expect(normalizeVoteDraft(choice(['돈가스', '  ']))).toEqual({ ok: false, error: 'option_empty' });
    expect(normalizeVoteDraft(choice(['돈가스', '가'.repeat(31)]))).toEqual({ ok: false, error: 'option_long' });
    expect(normalizeVoteDraft(choice(['돈가스', ' 돈가스 ']))).toEqual({ ok: false, error: 'option_duplicate' });
  });

  it('trims options', () => {
    const r = normalizeVoteDraft(choice([' 김치찜 ', '돈가스']));
    expect(r.ok && r.draft.paper).toEqual({ kind: 'choice', options: ['김치찜', '돈가스'] });
  });
});

describe('normalizeBallotContent', () => {
  const free: Paper = { kind: 'freeform' };
  const pick: Paper = { kind: 'choice', options: ['a', 'b', 'c'] };

  it('keeps line breaks but trims and collapses spaces in typed text', () => {
    expect(normalizeBallotContent({ kind: 'text', text: '  서연이요!\n  고마웠어요  ' }, free)).toEqual({ kind: 'text', text: '서연이요!\n 고마웠어요' });
  });

  it('rejects empty text and text over 200 characters', () => {
    expect(normalizeBallotContent({ kind: 'text', text: ' \n ' }, free)).toBeNull();
    expect(normalizeBallotContent({ kind: 'text', text: '가'.repeat(201) }, free)).toBeNull();
    expect(normalizeBallotContent({ kind: 'text', text: '가'.repeat(200) }, free)).not.toBeNull();
  });

  it('rejects content that does not match the paper', () => {
    expect(normalizeBallotContent({ kind: 'choice', optionIndex: 0 }, free)).toBeNull();
    expect(normalizeBallotContent({ kind: 'text', text: 'x' }, pick)).toBeNull();
  });

  it('checks the option index against the options', () => {
    expect(normalizeBallotContent({ kind: 'choice', optionIndex: 2 }, pick)).toEqual({ kind: 'choice', optionIndex: 2 });
    expect(normalizeBallotContent({ kind: 'choice', optionIndex: 3 }, pick)).toBeNull();
  });
});

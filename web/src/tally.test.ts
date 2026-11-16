import { describe, expect, it } from 'vitest';
import type { HostBallot } from '../../shared/protocol.ts';
import { leadersOf, tallyOf } from './tally.ts';

const choice = (optionIndex: number, id = String(Math.random())): HostBallot => ({
  id,
  content: { kind: 'choice', optionIndex },
  author: { id: `a${id}`, nickname: '하늘' },
});

describe('tallyOf', () => {
  it('counts per option and keeps the options in order', () => {
    expect(tallyOf([choice(2), choice(0), choice(2), choice(2)], 4)).toEqual([1, 0, 3, 0]);
  });

  it('shows an option nobody picked as zero', () => {
    expect(tallyOf([], 3)).toEqual([0, 0, 0]);
  });

  it('ignores ballots that are not a choice or point past the options', () => {
    const text: HostBallot = { id: 't', content: { kind: 'text', text: '안녕' }, author: { id: 'a', nickname: '하늘' } };
    expect(tallyOf([text, choice(5), choice(1)], 2)).toEqual([0, 1]);
  });
});

describe('leadersOf', () => {
  it('marks the single leader', () => {
    expect([...leadersOf([1, 4, 2])]).toEqual([1]);
  });

  it('marks every option of a tie', () => {
    expect([...leadersOf([3, 1, 3, 0])]).toEqual([0, 2]);
  });

  it('marks nobody when every count is zero', () => {
    expect(leadersOf([0, 0, 0]).size).toBe(0);
  });
});

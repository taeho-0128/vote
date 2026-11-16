import { describe, expect, it } from 'vitest';
import type { BallotContent } from '../../shared/vote.ts';
import { advance, finishFolding, initialFlow, startSending } from './submitFlow.ts';
import type { FlowFacts } from './submitFlow.ts';

const content: BallotContent = { kind: 'text', text: '서연이요!' };
const rect = { left: 10, top: 20, width: 300, height: 400 };
const facts = (over: Partial<FlowFacts> = {}): FlowFacts => ({
  submitted: false,
  count: 0,
  busy: false,
  refusal: null,
  ...over,
});

describe('submit flow', () => {
  it('starts static when the snapshot already said submitted, and writing otherwise', () => {
    expect(initialFlow(true).phase).toBe('static');
    expect(initialFlow(false).phase).toBe('writing');
  });

  it('plays the animation only after a command in flight is accepted', () => {
    const sending = startSending(content, rect);
    expect(advance(sending, facts({ busy: true }))).toBe(sending);
    const folding = advance(sending, facts({ submitted: true, count: 5 }));
    expect(folding).toEqual({ phase: 'folding', content, rect, from: 4 });
  });

  it('counts up from zero when the ballot is the first in the box', () => {
    const folding = advance(startSending(content, null), facts({ submitted: true, count: 1 }));
    expect(folding.phase === 'folding' && folding.from).toBe(0);
  });

  it('goes back to writing when the command was refused or lost, so nothing animates', () => {
    const sending = startSending(content, rect);
    expect(advance(sending, facts({ refusal: 'bad_ballot' })).phase).toBe('writing');
    expect(advance(sending, facts({ refusal: 'offline' })).phase).toBe('writing');
    expect(advance(sending, facts()).phase).toBe('writing');
  });

  it('shows the box without the animation when the server says the ballot was already in', () => {
    expect(advance(startSending(content, rect), facts({ refusal: 'already_submitted', busy: false })).phase).toBe('static');
  });

  it('never animates a ballot this screen did not send', () => {
    expect(advance(initialFlow(false), facts({ submitted: true, count: 3 })).phase).toBe('static');
  });

  it('keeps folding until the stage reports it is done, then rests', () => {
    const folding = advance(startSending(content, rect), facts({ submitted: true, count: 2 }));
    expect(advance(folding, facts({ submitted: true, count: 3 }))).toBe(folding);
    const done = finishFolding(folding);
    expect(done.phase).toBe('done');
    expect(advance(done, facts({ submitted: true }))).toBe(done);
    expect(finishFolding(initialFlow(false)).phase).toBe('writing');
  });
});

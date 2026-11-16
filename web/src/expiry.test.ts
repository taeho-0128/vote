import { describe, expect, it } from 'vitest';
import { EXPIRY_WARNING_MS, msUntilLabelChanges, remainingOf } from './expiry.ts';
import { waitSecondsFrom } from './rateLimit.ts';

describe('remainingOf', () => {
  it('counts whole minutes rounded down', () => {
    expect(remainingOf(29 * 60_000 + 59_000)).toEqual({ unit: 'minutes', value: 29 });
    expect(remainingOf(60_000)).toEqual({ unit: 'minutes', value: 1 });
  });

  it('switches to seconds in the last minute', () => {
    expect(remainingOf(59_999)).toEqual({ unit: 'seconds', value: 60 });
    expect(remainingOf(1_001)).toEqual({ unit: 'seconds', value: 2 });
    expect(remainingOf(1)).toEqual({ unit: 'seconds', value: 1 });
  });

  it('says now when the time is up', () => {
    expect(remainingOf(0)).toEqual({ unit: 'now' });
    expect(remainingOf(-5)).toEqual({ unit: 'now' });
  });

  it('warns under half an hour', () => {
    expect(EXPIRY_WARNING_MS).toBe(1_800_000);
  });
});

describe('msUntilLabelChanges', () => {
  it('lands just after the next minute boundary', () => {
    expect(msUntilLabelChanges(5 * 60_000 + 20_000)).toBe(20_001);
    expect(remainingOf(5 * 60_000 + 20_000 - 20_001)).toEqual({ unit: 'minutes', value: 4 });
  });

  it('lands on the next second in the last minute', () => {
    const wait = msUntilLabelChanges(30_400);
    expect(wait).toBe(400);
    expect(remainingOf(30_400 - wait)).toEqual({ unit: 'seconds', value: 30 });
  });
});

describe('waitSecondsFrom', () => {
  it('uses the seconds the server names', () => {
    expect(waitSecondsFrom('Too many attempts, retry in 45 seconds')).toBe(45);
    expect(waitSecondsFrom('잠시 뒤 다시 시도: 30초')).toBe(30);
    expect(waitSecondsFrom('wait 12s')).toBe(12);
  });

  it('falls back to 60 when the message gives none', () => {
    expect(waitSecondsFrom('rate_limited')).toBe(60);
    expect(waitSecondsFrom('')).toBe(60);
    expect(waitSecondsFrom('0초')).toBe(60);
  });

  it('caps a wait that would lock the form for good', () => {
    expect(waitSecondsFrom('99999초')).toBe(900);
  });
});

import type { HostBallot } from '../../shared/protocol.ts';

// One count per option, in the options' own order. A ballot that is not a choice, or points past the options, adds nothing.
export function tallyOf(ballots: readonly HostBallot[], optionCount: number): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const { content } of ballots) {
    if (content.kind !== 'choice' || content.optionIndex >= optionCount) continue;
    counts[content.optionIndex] = (counts[content.optionIndex] ?? 0) + 1;
  }
  return counts;
}

// Every option that shares the top count, so a tie highlights all of them. Nobody leads while every count is zero.
export function leadersOf(tally: readonly number[]): ReadonlySet<number> {
  const top = Math.max(0, ...tally);
  if (top === 0) return new Set();
  return new Set(tally.flatMap((count, index) => (count === top ? [index] : [])));
}

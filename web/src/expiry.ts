export const EXPIRY_WARNING_MS = 30 * 60 * 1000;

const MINUTE_MS = 60 * 1000;

export type Remaining =
  | { readonly unit: 'minutes'; readonly value: number }
  | { readonly unit: 'seconds'; readonly value: number }
  | { readonly unit: 'now' };

// Whole minutes rounded down, so the count never promises more time than is left, then seconds for the last minute.
export function remainingOf(ms: number): Remaining {
  if (ms <= 0) return { unit: 'now' };
  if (ms >= MINUTE_MS) return { unit: 'minutes', value: Math.floor(ms / MINUTE_MS) };
  return { unit: 'seconds', value: Math.ceil(ms / 1000) };
}

// How long until the label above would read differently, so a banner wakes once a minute and then once a second.
export function msUntilLabelChanges(ms: number): number {
  if (ms <= 0) return MINUTE_MS;
  if (ms >= MINUTE_MS) return (ms % MINUTE_MS) + 1;
  return ((ms - 1) % 1000) + 1;
}

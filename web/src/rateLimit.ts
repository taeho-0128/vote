import { RATE_LIMIT_DEFAULT_SECONDS } from './messages.ts';

const MAX_WAIT_SECONDS = 15 * 60;

// The server's message may say how long to wait ("60초 뒤", "retry in 45 seconds"). When it does not, or says something
// unusable, the wait is the documented 60 seconds.
export function waitSecondsFrom(message: string): number {
  const found = /(\d{1,5})\s*(?:초|seconds?|secs?|s\b)/i.exec(message);
  const seconds = found ? Number.parseInt(found[1] as string, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 1) return RATE_LIMIT_DEFAULT_SECONDS;
  return Math.min(seconds, MAX_WAIT_SECONDS);
}

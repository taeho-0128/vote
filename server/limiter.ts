export interface LimiterOptions {
  now(): number;
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  maxAddresses?: number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
  lastFailureAt: number;
}

// Counts failed room-code and token guesses per client address (D-40). A success is never reported here,
// so a guesser cannot buy fresh attempts by interleaving successes. It is keyed by address, never by room.
export class AttemptLimiter {
  // Re-inserted on every failure, so the map is ordered by lastFailureAt and expired entries sit at the front.
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #lockMs: number;
  readonly #maxAddresses: number;

  constructor({ now, maxFailures = 8, windowMs = 60_000, lockMs = 60_000, maxAddresses = 10_000 }: LimiterOptions) {
    this.#now = now;
    this.#maxFailures = maxFailures;
    this.#windowMs = windowMs;
    this.#lockMs = lockMs;
    this.#maxAddresses = maxAddresses;
  }

  get size(): number {
    return this.#entries.size;
  }

  // Milliseconds left on the address's lock, or 0 when it may try.
  retryAfterMs(address: string): number {
    const now = this.#now();
    this.#prune(now);
    const entry = this.#entries.get(address);
    return entry ? Math.max(0, entry.lockedUntil - now) : 0;
  }

  recordFailure(address: string): void {
    const now = this.#now();
    this.#prune(now);
    const previous = this.#entries.get(address);
    const failures = (previous?.failures ?? []).filter((at) => now - at < this.#windowMs);
    failures.push(now);
    const locking = failures.length >= this.#maxFailures;
    this.#entries.delete(address);
    this.#entries.set(address, {
      failures: locking ? [] : failures,
      lockedUntil: locking ? now + this.#lockMs : (previous?.lockedUntil ?? 0),
      lastFailureAt: now,
    });
    while (this.#entries.size > this.#maxAddresses) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }

  #prune(now: number): void {
    const keepFor = Math.max(this.#windowMs, this.#lockMs);
    for (const [address, entry] of this.#entries) {
      if (now - entry.lastFailureAt < keepFor) break;
      this.#entries.delete(address);
    }
  }
}

/**
 * In-memory sliding-window limiter, one window per key (design § Security: single process).
 * `tryHit` records a hit and returns false once `limit` hits fall within `windowMs`.
 *
 * Bounded against floods of distinct keys: idle keys are pruned at most once per
 * `windowMs / 10` (so a request never pays a full scan), and once `maxKeys` keys are
 * tracked, unseen keys share one overflow bucket with `overflowLimit` hits per window.
 * So memory stays bounded, a flood cannot reset other clients' windows (nothing is
 * evicted), and it cannot lock every new client out either: they keep a shared allowance.
 */
/** Shared bucket for unseen keys while the table is full; cannot collide with an IP key. */
const OVERFLOW_KEY = "\u0000overflow";

export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #pruneIntervalMs: number;
  #lastPrune: number;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    readonly maxKeys = 10_000,
    readonly overflowLimit = limit * 10,
  ) {
    this.#pruneIntervalMs = Math.max(1, Math.floor(windowMs / 10));
    this.#lastPrune = now();
  }

  tryHit(key: string): boolean {
    const now = this.now();
    if (now - this.#lastPrune >= this.#pruneIntervalMs) {
      this.#prune(now);
    }
    const overflow = !this.#hits.has(key) && this.#hits.size >= this.maxKeys;
    const bucket = overflow ? OVERFLOW_KEY : key;
    const limit = overflow ? this.overflowLimit : this.limit;
    const recent = (this.#hits.get(bucket) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= limit) {
      this.#hits.set(bucket, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(bucket, recent);
    return true;
  }

  get trackedKeys(): number {
    return this.#hits.size;
  }

  /** Drops keys whose hits have all left the window. */
  #prune(now: number): void {
    this.#lastPrune = now;
    for (const [key, times] of this.#hits) {
      if (times.every((time) => now - time >= this.windowMs)) {
        this.#hits.delete(key);
      }
    }
  }
}

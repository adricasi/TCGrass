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
    const { bucket, limit, recent } = this.#window(key, now);
    if (recent.length >= limit) {
      this.#hits.set(bucket, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(bucket, recent);
    return true;
  }

  /** True if `key` has used up its window, without recording a hit. */
  blocked(key: string): boolean {
    const { limit, recent } = this.#window(key, this.now());
    return recent.length >= limit;
  }

  /** The bucket a key counts against (its own, or the shared overflow) and its live hits. */
  #window(key: string, now: number): { bucket: string; limit: number; recent: number[] } {
    const overflow = !this.#hits.has(key) && this.#hits.size >= this.maxKeys;
    const bucket = overflow ? OVERFLOW_KEY : key;
    return {
      bucket,
      limit: overflow ? this.overflowLimit : this.limit,
      recent: (this.#hits.get(bucket) ?? []).filter((time) => now - time < this.windowMs),
    };
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

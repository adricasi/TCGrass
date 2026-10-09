/**
 * In-memory sliding-window limiter, one window per key (design § Security: single process).
 * `tryHit` records a hit and returns false once `limit` hits fall within `windowMs`.
 *
 * Bounded against floods of distinct keys: idle keys are pruned at most once per
 * `windowMs / 10` (so a request never pays a full scan), and once `maxKeys` keys are
 * tracked, hits from unseen keys are refused until pruning frees room. Refusing (rather
 * than evicting old keys) means a flood cannot reset other clients' windows.
 */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #pruneIntervalMs: number;
  #lastPrune: number;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    readonly maxKeys = 10_000,
  ) {
    this.#pruneIntervalMs = Math.max(1, Math.floor(windowMs / 10));
    this.#lastPrune = now();
  }

  tryHit(key: string): boolean {
    const now = this.now();
    if (now - this.#lastPrune >= this.#pruneIntervalMs) {
      this.#prune(now);
    }
    const previous = this.#hits.get(key);
    if (previous === undefined && this.#hits.size >= this.maxKeys) {
      return false;
    }
    const recent = (previous ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
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

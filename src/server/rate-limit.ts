/**
 * In-memory sliding-window limiter, one window per key (design § Security: single process).
 * `tryHit` records a hit and returns false once `limit` hits fall within `windowMs`.
 */
export class SlidingWindowLimiter {
  readonly #hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  tryHit(key: string): boolean {
    const now = this.now();
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    this.#prune(now);
    return true;
  }

  /** Drops keys with no recent hits so memory stays bounded by active clients. */
  #prune(now: number): void {
    if (this.#hits.size < 1000) {
      return;
    }
    for (const [key, times] of this.#hits) {
      if (times.every((time) => now - time >= this.windowMs)) {
        this.#hits.delete(key);
      }
    }
  }
}

/** Counts identification calls in progress so the server can cap them (AC-003.12). */
export class InFlightLimiter {
  #active = 0;

  constructor(readonly max: number) {}

  /** Takes a slot if one is free; the caller must `release()` it in `finally`. */
  tryAcquire(): boolean {
    if (this.#active >= this.max) {
      return false;
    }
    this.#active += 1;
    return true;
  }

  release(): void {
    if (this.#active === 0) {
      throw new Error("release() without a matching tryAcquire()");
    }
    this.#active -= 1;
  }
}

import { describe, expect, it } from "vitest";

import { InFlightLimiter } from "../../src/server/inflight.js";

describe("InFlightLimiter", () => {
  it("AC-003.12 hands out at most `max` slots and reuses released ones", () => {
    const limiter = new InFlightLimiter(2);
    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([
      true,
      true,
      false,
    ]);
    limiter.release();
    expect(limiter.tryAcquire()).toBe(true);
  });

  it("AC-003.12 fails loudly on a release without an acquire", () => {
    expect(() => {
      new InFlightLimiter(1).release();
    }).toThrow(/without a matching tryAcquire/);
  });
});

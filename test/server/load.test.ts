import { describe, expect, it } from "vitest";

import { runLoad } from "../../scripts/load-captures.js";

describe("load script (NFR-005)", () => {
  it("NFR-005 5 parallel captures against a stub model all succeed, with no 5xx", async () => {
    const report = await runLoad({ parallel: 5, delayMs: 50 });

    expect(report.statuses).toEqual({ 200: 5 });
    expect(report.serverErrors).toBe(0);
  });

  it("AC-003.12 a 6th parallel capture is rejected as busy, the other 5 succeed", async () => {
    const report = await runLoad({ parallel: 6, delayMs: 50 });

    expect(report.statuses).toEqual({ 200: 5, 503: 1 });
    expect(report.busy).toBe(1);
  });
});

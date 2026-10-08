import { describe, expect, it } from "vitest";

import { readExpansionFile } from "../../src/server/expansion/parse.js";

describe("everyday-nature expansion file", () => {
  it("validates against the expansion schema with 15 cards and odds summing to 100", async () => {
    const exp = await readExpansionFile("expansions/everyday-nature");
    expect(exp.id).toBe("everyday-nature");
    expect(exp.cards).toHaveLength(15);
    const o = exp.rarity_odds;
    expect(o.common + o.rare + o.epic + o.legendary).toBe(100);
  });
});

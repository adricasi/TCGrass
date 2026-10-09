import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RARITIES } from "../../src/shared/expansion.js";
import { rarityPresentation } from "../../web/src/rarity.js";

describe("rarityPresentation", () => {
  it("AC-006.2 uses animated foil only for Epic and Legendary", () => {
    expect(RARITIES.map((rarity) => rarityPresentation(rarity).foil)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("AC-006.2 gives each rarity its own frame and a text label, not colour alone", () => {
    const all = (["common", "rare", "epic", "legendary"] as const).map(rarityPresentation);
    expect(new Set(all.map((presentation) => presentation.frameClass)).size).toBe(4);
    expect(all.map((presentation) => presentation.label)).toEqual([
      "Common",
      "Rare",
      "Epic",
      "Legendary",
    ]);
  });
});

describe("plain-text rendering", () => {
  it("AC-006.4 no PWA component renders markup from data (no dangerouslySetInnerHTML or innerHTML)", () => {
    const dir = fileURLToPath(new URL("../../web/src/", import.meta.url));
    const sources = readdirSync(dir)
      .filter((name) => /\.(tsx?|jsx?)$/.test(name))
      .map((name) => readFileSync(`${dir}${name}`, "utf8"));
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/);
    }
  });
});

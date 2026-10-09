import { describe, expect, it } from "vitest";

import { RARITIES } from "../../src/shared/expansion.js";
import { FLAVOR_LINE_MAX, mintCard, truncateFlavorLine } from "../../src/server/game/mint.js";
import { rollRarity } from "../../src/server/game/rarity.js";
import { playerAuth, seededDb } from "./helpers.js";

const odds = { common: 70, rare: 22, epic: 7, legendary: 1 };

describe("rollRarity", () => {
  it("AC-005.2 matches the published odds within ±1 point over 100,000 crypto draws", () => {
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const draws = 100_000;
    for (let index = 0; index < draws; index += 1) {
      counts[rollRarity(odds)] += 1;
    }
    for (const rarity of RARITIES) {
      expect(Math.abs((100 * counts[rarity]) / draws - odds[rarity])).toBeLessThanOrEqual(1);
    }
  });

  it("AC-005.1 maps each of the 100 slots to the rarity its odds give it", () => {
    const slots = Array.from({ length: 100 }, (_unused, slot) => rollRarity(odds, () => slot));
    expect(slots.filter((rarity) => rarity === "common")).toHaveLength(70);
    expect(slots.filter((rarity) => rarity === "rare")).toHaveLength(22);
    expect(slots.filter((rarity) => rarity === "epic")).toHaveLength(7);
    expect(slots.filter((rarity) => rarity === "legendary")).toHaveLength(1);
    expect(slots[99]).toBe("legendary");
  });

  it("AC-005.1 never rolls a rarity whose odds are 0", () => {
    const noLegendary = { common: 80, rare: 15, epic: 5, legendary: 0 };
    for (let slot = 0; slot < 100; slot += 1) {
      expect(rollRarity(noLegendary, () => slot)).not.toBe("legendary");
    }
  });

  it("AC-005.1 refuses odds that do not sum to 100 instead of minting a wrong rarity", () => {
    expect(() => rollRarity({ common: 50, rare: 0, epic: 0, legendary: 0 }, () => 99)).toThrow(
      RangeError,
    );
  });
});

describe("mintCard", () => {
  it("AC-004.3 stores only card, rarity, owner, capture time and flavor line", () => {
    const { db } = seededDb();
    playerAuth(db);
    const minted = mintCard(db, {
      ownerId: 1,
      expansionId: "fixture-a",
      cardId: "oak",
      rarity: "epic",
      flavorLine: "Acorns everywhere.",
      now: new Date("2026-10-10T09:00:00.000Z"),
    });
    expect(db.prepare("SELECT * FROM card_instances WHERE id = ?").get(minted.id)).toEqual({
      id: minted.id,
      expansion_id: "fixture-a",
      card_id: "oak",
      rarity: "epic",
      owner_id: 1,
      flavor_line: "Acorns everywhere.",
      captured_at: "2026-10-10T09:00:00.000Z",
    });
  });

  it("AC-006.3 truncates flavor lines to 140 characters before storing, without splitting emoji", () => {
    const { db } = seededDb();
    playerAuth(db);
    const minted = mintCard(db, {
      ownerId: 1,
      expansionId: "fixture-a",
      cardId: "oak",
      rarity: "common",
      flavorLine: "🌳".repeat(200),
    });
    expect(minted.flavorLine).toBe("🌳".repeat(FLAVOR_LINE_MAX));
  });

  it("AC-006.3 stores a missing or blank flavor line as null", () => {
    expect(truncateFlavorLine(null)).toBeNull();
    expect(truncateFlavorLine("   ")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  catalogueNumber,
  countBadges,
  formatCaptureDate,
  oddsRows,
  progressLabel,
  rarestOwned,
} from "../../web/src/binder-view.js";

describe("binder view helpers", () => {
  it("AC-007.3 shows distinct cards owned out of the total", () => {
    expect(progressLabel({ owned: 7, total: 15 })).toBe("7 / 15");
    expect(progressLabel({ owned: 0, total: 15 })).toBe("0 / 15");
  });

  it("AC-007.1 shows the number owned per rarity, rarest last, skipping zeros", () => {
    expect(countBadges({ common: 2, rare: 0, epic: 1, legendary: 0 })).toEqual([
      { rarity: "common", label: "Common", count: 2 },
      { rarity: "epic", label: "Epic", count: 1 },
    ]);
    expect(countBadges({ common: 0, rare: 0, epic: 0, legendary: 0 })).toEqual([]);
  });

  it("AC-005.4 shows the odds exactly as loaded, in rarity order", () => {
    expect(oddsRows({ common: 70, rare: 22, epic: 7, legendary: 1 })).toEqual([
      { rarity: "common", label: "Common", percent: 70 },
      { rarity: "rare", label: "Rare", percent: 22 },
      { rarity: "epic", label: "Epic", percent: 7 },
      { rarity: "legendary", label: "Legendary", percent: 1 },
    ]);
  });

  it("AC-007.2 shows the capture date", () => {
    expect(formatCaptureDate("2026-10-10T09:00:00.000Z", "en-GB")).toBe("10 Oct 2026");
  });
});

describe("binder tile helpers (T-024)", () => {
  it("AC-007.1 numbers catalogue cards from 01 in file order", () => {
    expect(catalogueNumber(0)).toBe("Nº 01");
    expect(catalogueNumber(14)).toBe("Nº 15");
  });

  it("AC-007.1 frames an owned card by its rarest copy; a missing card has none", () => {
    expect(rarestOwned({ common: 2, rare: 0, epic: 1, legendary: 0 })).toBe("epic");
    expect(rarestOwned({ common: 1, rare: 0, epic: 0, legendary: 0 })).toBe("common");
    expect(rarestOwned({ common: 0, rare: 0, epic: 0, legendary: 0 })).toBeNull();
  });
});

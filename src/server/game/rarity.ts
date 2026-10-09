import { randomInt } from "node:crypto";

import { RARITIES, type Rarity } from "../../shared/expansion.js";

export interface RarityOdds {
  common: number;
  rare: number;
  epic: number;
  legendary: number;
}

/**
 * Rolls a rarity from the expansion's odds (integers summing to 100, validated at seed) with a
 * cryptographically secure source (AC-005.1). Never takes input from the client or the model
 * (AC-005.3).
 */
export function rollRarity(odds: RarityOdds, random: (max: number) => number = randomInt): Rarity {
  let roll = random(100);
  for (const rarity of RARITIES) {
    if (roll < odds[rarity]) {
      return rarity;
    }
    roll -= odds[rarity];
  }
  // Unreachable for odds that sum to 100; fail loudly rather than mint a wrong rarity.
  throw new RangeError("Rarity odds do not sum to 100");
}

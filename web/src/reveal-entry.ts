import { rarityPresentation, type Rarity } from "./rarity.js";

/**
 * Ends the entry even if `animationend` never fires (tab hidden, styles not loaded). Equals
 * the longest entry animation in style.css; AC-006.6 caps it at 2,000 ms.
 */
export const ENTRY_FALLBACK_MS = 1400;

const ENTRY_PREFIX = "entry-";

/**
 * Class that plays the reveal's entry animation (AC-006.6): foil rarities (Epic, Legendary)
 * get their own keyframes; `null` under reduced motion, so the reveal opens fully shown.
 */
export function entryAnimation(rarity: Rarity, reducedMotion: boolean): string | null {
  if (reducedMotion) return null;
  return `${ENTRY_PREFIX}${rarityPresentation(rarity).foil ? "foil" : "standard"}`;
}

/** True for the entry keyframes, not the foil sweep. */
export function isEntryAnimation(animationName: string): boolean {
  return animationName.startsWith(ENTRY_PREFIX);
}

/**
 * The overlay's class. Entry animations only run under `reveal-entering`, so removing it (on a
 * tap, at `animationend` or at the fallback) jumps the card to its final frame (AC-006.6).
 */
export function revealClass(entering: boolean): string {
  return entering ? "reveal reveal-entering" : "reveal";
}

export function cardClass(rarity: Rarity, entry: string | null): string {
  const presentation = rarityPresentation(rarity);
  return ["card", presentation.frameClass, presentation.foil ? "foil" : null, entry]
    .filter((name) => name !== null)
    .join(" ");
}

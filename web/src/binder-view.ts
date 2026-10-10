import { RARITIES, type Rarity } from "../../src/shared/expansion.js";
import type { BinderResponse } from "../../src/shared/schemas/binder.js";
import { rarityPresentation } from "./rarity.js";

/** "7 / 15": distinct cards owned out of the catalogue (AC-007.3). */
export function progressLabel(binder: Pick<BinderResponse, "owned" | "total">): string {
  return `${binder.owned} / ${binder.total}`;
}

export interface CountBadge {
  rarity: Rarity;
  label: string;
  count: number;
}

/** Owned copies per rarity, rarest last, skipping rarities the player has none of (AC-007.1). */
export function countBadges(counts: Record<Rarity, number>): CountBadge[] {
  return RARITIES.filter((rarity) => counts[rarity] > 0).map((rarity) => ({
    rarity,
    label: rarityPresentation(rarity).label,
    count: counts[rarity],
  }));
}

export interface OddsRow {
  rarity: Rarity;
  label: string;
  /** The integer from the expansion file, unchanged (AC-005.4). */
  percent: number;
}

export function oddsRows(odds: Record<Rarity, number>): OddsRow[] {
  return RARITIES.map((rarity) => ({
    rarity,
    label: rarityPresentation(rarity).label,
    percent: odds[rarity],
  }));
}

/** Capture date for the card detail, in the player's locale (AC-007.2). */
export function formatCaptureDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

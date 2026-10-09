import type { CapturedCard } from "../../src/shared/schemas/captures.js";

export type Rarity = CapturedCard["rarity"];

export interface RarityPresentation {
  /** Always shown as text, so rarity never depends on colour alone (AC-006.2). */
  label: string;
  /** CSS class for the frame colour. */
  frameClass: string;
  /** Animated foil only for Epic and Legendary (AC-006.2). */
  foil: boolean;
}

const PRESENTATION: Record<Rarity, RarityPresentation> = {
  common: { label: "Common", frameClass: "frame-common", foil: false },
  rare: { label: "Rare", frameClass: "frame-rare", foil: false },
  epic: { label: "Epic", frameClass: "frame-epic", foil: true },
  legendary: { label: "Legendary", frameClass: "frame-legendary", foil: true },
};

export function rarityPresentation(rarity: Rarity): RarityPresentation {
  return PRESENTATION[rarity];
}

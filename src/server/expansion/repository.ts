import { type Expansion, expansionSchema } from "../../shared/expansion.js";
import type { Db } from "../db/connection.js";

export interface StoredCard {
  id: string;
  name: string;
  category: string;
  imagePath: string;
  isPlaceholder: boolean;
}

export interface StoredExpansion {
  expansion: Expansion;
  cards: StoredCard[];
}

interface ExpansionRow {
  id: string;
  name: string;
  version: string;
  style_prompt: string;
  identification_instructions: string;
  rarity_odds: string;
  license_data: string;
  license_images: string;
}

interface CardRow {
  id: string;
  name: string;
  category: string;
  identify_hint: string;
  art_prompt: string;
  image_path: string;
  is_placeholder: number;
}

/** Reads a loaded expansion back from the DB, in file order; undefined if not loaded. */
export function findExpansion(db: Db, expansionId: string): StoredExpansion | undefined {
  const row = db
    .prepare<[string], ExpansionRow>("SELECT * FROM expansions WHERE id = ?")
    .get(expansionId);
  if (row === undefined) {
    return undefined;
  }
  const cardRows = db
    .prepare<[string], CardRow>(
      "SELECT * FROM catalogue_cards WHERE expansion_id = ? ORDER BY position",
    )
    .all(expansionId);

  // Re-validated so the rest of the app can trust the shape, as when it came from the file.
  const expansion = expansionSchema.parse({
    id: row.id,
    name: row.name,
    version: row.version,
    license: { data: row.license_data, images: row.license_images },
    rarity_odds: JSON.parse(row.rarity_odds) as unknown,
    style_prompt: row.style_prompt,
    identification: { instructions: row.identification_instructions },
    cards: cardRows.map((card) => ({
      id: card.id,
      name: card.name,
      category: card.category,
      identify_hint: card.identify_hint,
      art_prompt: card.art_prompt,
    })),
  });
  return {
    expansion,
    cards: cardRows.map((card) => ({
      id: card.id,
      name: card.name,
      category: card.category,
      imagePath: card.image_path,
      isPlaceholder: card.is_placeholder === 1,
    })),
  };
}

/** One card's image info, looked up by ids; undefined if the card does not exist. */
export function findCardImage(
  db: Db,
  expansionId: string,
  cardId: string,
): Pick<StoredCard, "category" | "imagePath" | "isPlaceholder"> | undefined {
  const row = db
    .prepare<[string, string], Pick<CardRow, "category" | "image_path" | "is_placeholder">>(
      "SELECT category, image_path, is_placeholder FROM catalogue_cards WHERE expansion_id = ? AND id = ?",
    )
    .get(expansionId, cardId);
  return row === undefined
    ? undefined
    : {
        category: row.category,
        imagePath: row.image_path,
        isPlaceholder: row.is_placeholder === 1,
      };
}

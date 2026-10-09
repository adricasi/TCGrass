import type { Db } from "../db/connection.js";
import type { LoadedExpansion } from "./load.js";
import { ExpansionError } from "./parse.js";

export interface SeedResult {
  expansionId: string;
  cardsLoaded: number;
  cardsRemoved: string[];
}

/**
 * Stores a validated expansion in one IMMEDIATE transaction (AC-001.1, AC-001.5, AC-001.6).
 * Re-seeding updates rows in place, so card instances are never touched; removing a card
 * that a player owns rejects the whole reload.
 */
export function seedExpansion(db: Db, loaded: LoadedExpansion, now = new Date()): SeedResult {
  const { expansion, images } = loaded;
  const loadedAt = now.toISOString();
  const cardIds = new Set(expansion.cards.map((card) => card.id));

  return db
    .transaction((): SeedResult => {
      const existing = db
        .prepare<[string], { id: string }>("SELECT id FROM catalogue_cards WHERE expansion_id = ?")
        .all(expansion.id)
        .map((row) => row.id);
      const removed = existing.filter((id) => !cardIds.has(id));

      const countOwned = db.prepare<[string, string], { n: number }>(
        "SELECT COUNT(*) AS n FROM card_instances WHERE expansion_id = ? AND card_id = ?",
      );
      const ownedRemoved = removed.filter((id) => countOwned.get(expansion.id, id)?.n !== 0);
      if (ownedRemoved.length > 0) {
        throw new ExpansionError(
          `Reload rejected: players own ${ownedRemoved.map((id) => `"${id}"`).join(", ")}, ` +
            "which the new file removes. Keep those cards in the file.",
        );
      }

      db.prepare(
        `INSERT INTO expansions (id, name, version, style_prompt, identification_instructions,
           rarity_odds, license_data, license_images, loaded_at)
         VALUES (@id, @name, @version, @stylePrompt, @instructions, @odds, @licenseData,
           @licenseImages, @loadedAt)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, version = excluded.version,
           style_prompt = excluded.style_prompt,
           identification_instructions = excluded.identification_instructions,
           rarity_odds = excluded.rarity_odds, license_data = excluded.license_data,
           license_images = excluded.license_images, loaded_at = excluded.loaded_at`,
      ).run({
        id: expansion.id,
        name: expansion.name,
        version: expansion.version,
        stylePrompt: expansion.style_prompt,
        instructions: expansion.identification.instructions,
        odds: JSON.stringify(expansion.rarity_odds),
        licenseData: expansion.license.data,
        licenseImages: expansion.license.images,
        loadedAt,
      });

      const deleteCard = db.prepare(
        "DELETE FROM catalogue_cards WHERE expansion_id = ? AND id = ?",
      );
      for (const id of removed) {
        deleteCard.run(expansion.id, id);
      }

      const upsertCard = db.prepare(
        `INSERT INTO catalogue_cards (expansion_id, id, position, name, category, identify_hint,
           art_prompt, image_path, is_placeholder)
         VALUES (@expansionId, @id, @position, @name, @category, @hint, @artPrompt, @imagePath,
           @isPlaceholder)
         ON CONFLICT (expansion_id, id) DO UPDATE SET position = excluded.position,
           name = excluded.name, category = excluded.category,
           identify_hint = excluded.identify_hint, art_prompt = excluded.art_prompt,
           image_path = excluded.image_path, is_placeholder = excluded.is_placeholder`,
      );
      expansion.cards.forEach((card, position) => {
        const image = images.get(card.id);
        if (image === undefined) {
          throw new ExpansionError(`cards.${card.id}: no image resolved`);
        }
        upsertCard.run({
          expansionId: expansion.id,
          id: card.id,
          position,
          name: card.name,
          category: card.category,
          hint: card.identify_hint,
          artPrompt: card.art_prompt,
          imagePath: image.imagePath,
          isPlaceholder: image.isPlaceholder ? 1 : 0,
        });
      });

      return {
        expansionId: expansion.id,
        cardsLoaded: expansion.cards.length,
        cardsRemoved: removed,
      };
    })
    .immediate();
}

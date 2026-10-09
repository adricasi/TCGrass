import type { Rarity } from "../../shared/expansion.js";
import type { BinderResponse } from "../../shared/schemas/binder.js";
import { cardImageUrl } from "../../shared/schemas/expansion.js";
import type { Db } from "../db/connection.js";
import type { StoredExpansion } from "../expansion/repository.js";

interface InstanceRow {
  id: number;
  card_id: string;
  rarity: Rarity;
  captured_at: string;
  flavor_line: string | null;
  locked: number;
}

/**
 * The player's binder for the active expansion: every catalogue card in file order, owned
 * ones with counts per rarity and their instances (REQ-007). Only the caller's own cards.
 */
export function readBinder(db: Db, expansion: StoredExpansion, ownerId: number): BinderResponse {
  const rows = db
    .prepare<[string, number], InstanceRow>(
      `SELECT i.id, i.card_id, i.rarity, i.captured_at, i.flavor_line,
              EXISTS (
                SELECT 1 FROM trade_offers o
                WHERE o.offered_instance_id = i.id AND o.status = 'pending'
              ) AS locked
         FROM card_instances i
        WHERE i.expansion_id = ? AND i.owner_id = ?
        ORDER BY i.captured_at DESC, i.id DESC`,
    )
    .all(expansion.expansion.id, ownerId);

  const byCard = new Map<string, InstanceRow[]>();
  for (const row of rows) {
    const list = byCard.get(row.card_id);
    if (list === undefined) {
      byCard.set(row.card_id, [row]);
    } else {
      list.push(row);
    }
  }

  const cards = expansion.cards.map((card) => {
    const instances = byCard.get(card.id) ?? [];
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    for (const instance of instances) {
      counts[instance.rarity] += 1;
    }
    return {
      id: card.id,
      name: card.name,
      category: card.category,
      imageUrl: cardImageUrl(expansion.expansion.id, card.id),
      owned: instances.length > 0,
      counts,
      instances: instances.map((instance) => ({
        id: instance.id,
        rarity: instance.rarity,
        capturedAt: instance.captured_at,
        locked: instance.locked === 1,
        flavorLine: instance.flavor_line,
      })),
    };
  });
  return { owned: cards.filter((card) => card.owned).length, total: cards.length, cards };
}

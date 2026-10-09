import type { Rarity } from "../../shared/expansion.js";
import type { Db } from "../db/connection.js";
import { FLAVOR_LINE_MAX_CHARS } from "../identify/client.js";

/** Same limit as the identifier's cleaning and the DB CHECK (AC-006.3). */
export const FLAVOR_LINE_MAX = FLAVOR_LINE_MAX_CHARS;

export interface MintRequest {
  ownerId: number;
  expansionId: string;
  cardId: string;
  rarity: Rarity;
  flavorLine: string | null;
  now?: Date;
}

export interface MintedCard {
  id: number;
  rarity: Rarity;
  flavorLine: string | null;
  capturedAt: string;
}

/** Cuts to 140 code points so emoji are never split (AC-006.3); empty becomes null. */
export function truncateFlavorLine(line: string | null): string | null {
  if (line === null) {
    return null;
  }
  const truncated = Array.from(line).slice(0, FLAVOR_LINE_MAX).join("").trimEnd();
  return truncated === "" ? null : truncated;
}

/**
 * Creates one card instance for its owner in an IMMEDIATE transaction. Captures are the only
 * way instances come into existence (NFR-009). Stores only the catalogue card, rarity, owner,
 * capture time and flavor line, never image data (AC-004.3).
 */
export function mintCard(db: Db, request: MintRequest): MintedCard {
  const flavorLine = truncateFlavorLine(request.flavorLine);
  const capturedAt = (request.now ?? new Date()).toISOString();
  return db
    .transaction((): MintedCard => {
      const result = db
        .prepare(
          `INSERT INTO card_instances (expansion_id, card_id, rarity, owner_id, flavor_line, captured_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.expansionId,
          request.cardId,
          request.rarity,
          request.ownerId,
          flavorLine,
          capturedAt,
        );
      return { id: Number(result.lastInsertRowid), rarity: request.rarity, flavorLine, capturedAt };
    })
    .immediate();
}

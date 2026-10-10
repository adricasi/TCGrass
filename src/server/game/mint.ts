import type { Rarity } from "../../shared/expansion.js";
import type { Db } from "../db/connection.js";
import { FLAVOR_LINE_MAX_CHARS } from "../identify/client.js";

/** Same limit as the identifier's cleaning and the DB CHECK (AC-006.3). */
export const FLAVOR_LINE_MAX = FLAVOR_LINE_MAX_CHARS;

/** Hours before a player can capture the same card again (REQ-014, ADR 0007). */
export const DEFAULT_CAPTURE_COOLDOWN_HOURS = 5;

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

export interface CaptureMintRequest extends Omit<MintRequest, "rarity" | "now"> {
  /** Rolled only when the card is minted, never for a capture refused by the cooldown. */
  rollRarity: () => Rarity;
  /** 0 turns the cooldown off (AC-014.4). */
  cooldownMs: number;
  now: Date;
}

export type CaptureMintResult =
  { kind: "minted"; card: MintedCard } | { kind: "cooldown"; availableAt: string };

/** Must run inside a transaction. Stores no image data or metadata (AC-004.3). */
function insertInstance(db: Db, request: MintRequest): MintedCard {
  const flavorLine = truncateFlavorLine(request.flavorLine);
  const capturedAt = (request.now ?? new Date()).toISOString();
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
}

/**
 * Creates one card instance for its owner in an IMMEDIATE transaction, without the capture
 * cooldown: for test fixtures only. Captures go through `mintCapture`. Captures are the only
 * way instances come into existence (NFR-009). Stores only the catalogue card, rarity, owner,
 * capture time and flavor line, never image data (AC-004.3).
 */
export function mintCard(db: Db, request: MintRequest): MintedCard {
  return db.transaction(() => insertInstance(db, request)).immediate();
}

/**
 * Mints a captured card unless the player captured the same card less than the cooldown ago
 * (AC-014.1). The check, the rarity roll, the mint and the new capture time are one IMMEDIATE
 * transaction, so concurrent captures of one card mint at most one (AC-014.6). The capture time
 * is recorded even with the cooldown off, so turning it on later counts from real captures.
 */
export function mintCapture(db: Db, request: CaptureMintRequest): CaptureMintResult {
  const { rollRarity, cooldownMs, now, ...card } = request;
  return db
    .transaction((): CaptureMintResult => {
      const last = db
        .prepare<[number, string, string], { last_captured_at: string }>(
          `SELECT last_captured_at FROM capture_cooldowns
           WHERE player_id = ? AND expansion_id = ? AND card_id = ?`,
        )
        .get(card.ownerId, card.expansionId, card.cardId);
      if (last !== undefined && cooldownMs > 0) {
        const lastCapturedAt = Date.parse(last.last_captured_at);
        if (Number.isNaN(lastCapturedAt)) {
          // Only toISOString() writes this column; fail closed rather than mint silently.
          throw new Error("capture_cooldowns.last_captured_at is not a valid time");
        }
        const availableAt = lastCapturedAt + cooldownMs;
        if (now.getTime() < availableAt) {
          return { kind: "cooldown", availableAt: new Date(availableAt).toISOString() };
        }
      }
      const minted = insertInstance(db, { ...card, rarity: rollRarity(), now });
      db.prepare(
        `INSERT INTO capture_cooldowns (player_id, expansion_id, card_id, last_captured_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (player_id, expansion_id, card_id)
         DO UPDATE SET last_captured_at = excluded.last_captured_at`,
      ).run(card.ownerId, card.expansionId, card.cardId, minted.capturedAt);
      return { kind: "minted", card: minted };
    })
    .immediate();
}

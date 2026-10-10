import type { Rarity } from "../../shared/expansion.js";
import { cardImageUrl } from "../../shared/schemas/expansion.js";
import type {
  IncomingOffer,
  SentOffer,
  TradeCard,
  TradeStatus,
} from "../../shared/schemas/trades.js";
import type { Db } from "../db/connection.js";
import { areFriends } from "./friends.js";

/** A REQ-009/REQ-010 rule was broken; `status` and `code` follow design.md § Interfaces. */
export class TradeError extends Error {
  override name = "TradeError";

  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface InstanceRow {
  id: number;
  owner_id: number;
}

function findInstance(db: Db, id: number): InstanceRow | undefined {
  return db
    .prepare<[number], InstanceRow>("SELECT id, owner_id FROM card_instances WHERE id = ?")
    .get(id);
}

/** Pending offers one sender may have with the same recipient (AC-009.8). */
export const MAX_PENDING_OFFERS_PER_RECIPIENT = 10;

/** Locked = the offered card of a pending offer (design § Data model). */
export function isLocked(db: Db, instanceId: number): boolean {
  return (
    db
      .prepare("SELECT 1 FROM trade_offers WHERE offered_instance_id = ? AND status = 'pending'")
      .get(instanceId) !== undefined
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE";
}

/**
 * Creates a `pending` offer of the sender's card for a friend's card (AC-009.1–009.4). Every
 * rule is checked inside one IMMEDIATE transaction; the partial unique index on pending
 * offers backs up the lock (AC-009.2). The source is decided here, never by the client.
 */
export function createOffer(
  db: Db,
  senderId: number,
  offeredInstanceId: number,
  requestedInstanceId: number,
  now = new Date(),
): number {
  return db
    .transaction((): number => {
      const offered = findInstance(db, offeredInstanceId);
      if (offered === undefined || offered.owner_id !== senderId) {
        // Same answer for "no such card" and "someone else's card": ids can't be probed.
        throw new TradeError(404, "instance_not_found", "That card isn't in your binder.");
      }
      const requested = findInstance(db, requestedInstanceId);
      if (requested === undefined) {
        throw new TradeError(404, "instance_not_found", "That card doesn't exist any more.");
      }
      if (requested.owner_id === senderId) {
        throw new TradeError(400, "own_card", "You already own that card.");
      }
      // Daily-pack trades (source "daily_pack") arrive with T-010; for now friends only.
      if (!areFriends(db, senderId, requested.owner_id)) {
        throw new TradeError(403, "not_friends", "You can only trade with your friends.");
      }
      if (isLocked(db, offered.id)) {
        throw new TradeError(409, "card_locked", "Your card is already in another pending offer.");
      }
      if (isLocked(db, requested.id)) {
        throw new TradeError(409, "card_locked", "That card is in one of their pending offers.");
      }
      const pendingToThem = db
        .prepare<[number, number], { n: number }>(
          "SELECT COUNT(*) AS n FROM trade_offers WHERE from_player_id = ? AND to_player_id = ? AND status = 'pending'",
        )
        .get(senderId, requested.owner_id);
      if ((pendingToThem?.n ?? 0) >= MAX_PENDING_OFFERS_PER_RECIPIENT) {
        throw new TradeError(
          409,
          "too_many_offers",
          `You already have ${MAX_PENDING_OFFERS_PER_RECIPIENT} offers waiting with this friend. ` +
            "Wait for an answer or cancel one.",
        );
      }
      try {
        const result = db
          .prepare(
            `INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id,
               requested_instance_id, source, status, created_at)
             VALUES (?, ?, ?, ?, 'friend', 'pending', ?)`,
          )
          .run(senderId, requested.owner_id, offered.id, requested.id, now.toISOString());
        return Number(result.lastInsertRowid);
      } catch (error) {
        // Backstop only: the IMMEDIATE transaction and isLocked above already serialise and
        // refuse this; the partial unique index guards the rule if a later change breaks them.
        if (isUniqueViolation(error)) {
          throw new TradeError(
            409,
            "card_locked",
            "Your card is already in another pending offer.",
          );
        }
        throw error;
      }
    })
    .immediate();
}

/** The sender withdraws a pending offer, which unlocks the offered card (AC-009.5, AC-010.7). */
export function cancelOffer(db: Db, senderId: number, offerId: number, now = new Date()): void {
  db.transaction(() => {
    const offer = db
      .prepare<[number], { from_player_id: number; status: TradeStatus }>(
        "SELECT from_player_id, status FROM trade_offers WHERE id = ?",
      )
      .get(offerId);
    if (offer === undefined) {
      throw new TradeError(404, "offer_not_found", "No such offer.");
    }
    if (offer.from_player_id !== senderId) {
      throw new TradeError(403, "not_sender", "Only the sender can cancel this offer.");
    }
    if (offer.status !== "pending") {
      throw new TradeError(409, "not_pending", "This offer is no longer pending.");
    }
    db.prepare("UPDATE trade_offers SET status = 'cancelled', resolved_at = ? WHERE id = ?").run(
      now.toISOString(),
      offerId,
    );
  }).immediate();
}

interface OfferRow {
  id: number;
  status: TradeStatus;
  source: "friend" | "daily_pack";
  created_at: string;
  resolved_at: string | null;
  from_name: string;
  from_code: string;
  to_name: string;
  to_code: string;
  o_id: number;
  o_expansion: string;
  o_card: string;
  o_name: string;
  o_rarity: Rarity;
  r_id: number;
  r_expansion: string;
  r_card: string;
  r_name: string;
  r_rarity: Rarity;
}

function tradeCard(
  instanceId: number,
  expansionId: string,
  cardId: string,
  name: string,
  rarity: Rarity,
): TradeCard {
  return { instanceId, cardId, name, rarity, imageUrl: cardImageUrl(expansionId, cardId) };
}

/** The only filters `queryOffers` accepts: fixed SQL, so no caller can inject any. */
const OFFER_FILTERS = {
  /** Params: sender id, offer id or null, offer id or null. */
  sent: "t.from_player_id = ? AND (? IS NULL OR t.id = ?)",
  /** Params: recipient id. */
  incoming: "t.to_player_id = ? AND t.status = 'pending'",
} as const;

/** Received offers listed in one inbox at most (the oldest are shown first). */
const MAX_INCOMING_OFFERS = 100;

/** Offers matching a fixed filter with both cards and both players, newest first. */
function queryOffers(
  db: Db,
  filter: keyof typeof OFFER_FILTERS,
  params: (number | null)[],
): OfferRow[] {
  const where = OFFER_FILTERS[filter];
  return db
    .prepare<(number | null)[], OfferRow>(
      `SELECT t.id, t.status, t.source, t.created_at, t.resolved_at,
              f.display_name AS from_name, f.friend_code AS from_code,
              p.display_name AS to_name, p.friend_code AS to_code,
              o.id AS o_id, o.expansion_id AS o_expansion, o.card_id AS o_card,
              oc.name AS o_name, o.rarity AS o_rarity,
              r.id AS r_id, r.expansion_id AS r_expansion, r.card_id AS r_card,
              rc.name AS r_name, r.rarity AS r_rarity
         FROM trade_offers t
         JOIN players f ON f.id = t.from_player_id
         JOIN players p ON p.id = t.to_player_id
         JOIN card_instances o ON o.id = t.offered_instance_id
         JOIN catalogue_cards oc ON oc.expansion_id = o.expansion_id AND oc.id = o.card_id
         JOIN card_instances r ON r.id = t.requested_instance_id
         JOIN catalogue_cards rc ON rc.expansion_id = r.expansion_id AND rc.id = r.card_id
        WHERE ${where}
        ORDER BY t.created_at DESC, t.id DESC`,
    )
    .all(...params);
}

function offeredCard(row: OfferRow): TradeCard {
  return tradeCard(row.o_id, row.o_expansion, row.o_card, row.o_name, row.o_rarity);
}

function requestedCard(row: OfferRow): TradeCard {
  return tradeCard(row.r_id, row.r_expansion, row.r_card, row.r_name, row.r_rarity);
}

/** The sender's offers, newest first, with both cards and the recipient (AC-009.6). */
export function listSentOffers(db: Db, senderId: number, offerId?: number): SentOffer[] {
  return queryOffers(db, "sent", [senderId, offerId ?? null, offerId ?? null]).map((row) => ({
    id: row.id,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    to: { displayName: row.to_name, friendCode: row.to_code },
    offered: offeredCard(row),
    requested: requestedCard(row),
  }));
}

/** Received pending offers, oldest first, with both cards and the sender (AC-010.2). */
export function incomingOffers(db: Db, recipientId: number): IncomingOffer[] {
  return queryOffers(db, "incoming", [recipientId])
    .reverse()
    .slice(0, MAX_INCOMING_OFFERS)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      from: { displayName: row.from_name, friendCode: row.from_code },
      offered: offeredCard(row),
      requested: requestedCard(row),
    }));
}

interface OfferStateRow {
  from_player_id: number;
  to_player_id: number;
  offered_instance_id: number;
  requested_instance_id: number;
  status: TradeStatus;
}

/** Loads an offer and checks the caller is its recipient and it is pending (AC-010.7). */
function pendingOfferForRecipient(db: Db, recipientId: number, offerId: number): OfferStateRow {
  const offer = db
    .prepare<[number], OfferStateRow>(
      `SELECT from_player_id, to_player_id, offered_instance_id, requested_instance_id, status
         FROM trade_offers WHERE id = ?`,
    )
    .get(offerId);
  if (offer === undefined) {
    throw new TradeError(404, "offer_not_found", "No such offer.");
  }
  if (offer.to_player_id !== recipientId) {
    throw new TradeError(403, "not_recipient", "Only the recipient can answer this offer.");
  }
  if (offer.status !== "pending") {
    throw new TradeError(409, "not_pending", "This offer is no longer pending.");
  }
  return offer;
}

/**
 * Accepts a pending offer in one IMMEDIATE transaction (AC-010.3–010.5, AC-010.8): re-checks
 * that both cards are still owned as expected, swaps their owners, marks the offer accepted
 * and fails every other pending offer involving either card, which unlocks their cards. If a
 * card changed hands meanwhile the offer becomes `failed` and nothing moves. Card instances
 * are never created or destroyed here (NFR-009).
 */
export function acceptOffer(
  db: Db,
  recipientId: number,
  offerId: number,
  now = new Date(),
): "accepted" | "failed" {
  return db
    .transaction((): "accepted" | "failed" => {
      const offer = pendingOfferForRecipient(db, recipientId, offerId);
      const resolvedAt = now.toISOString();
      const offered = findInstance(db, offer.offered_instance_id);
      const requested = findInstance(db, offer.requested_instance_id);
      if (
        offered?.owner_id !== offer.from_player_id ||
        requested?.owner_id !== offer.to_player_id
      ) {
        db.prepare("UPDATE trade_offers SET status = 'failed', resolved_at = ? WHERE id = ?").run(
          resolvedAt,
          offerId,
        );
        return "failed";
      }
      const setOwner = db.prepare("UPDATE card_instances SET owner_id = ? WHERE id = ?");
      setOwner.run(offer.to_player_id, offer.offered_instance_id);
      setOwner.run(offer.from_player_id, offer.requested_instance_id);
      db.prepare("UPDATE trade_offers SET status = 'accepted', resolved_at = ? WHERE id = ?").run(
        resolvedAt,
        offerId,
      );
      db.prepare(
        `UPDATE trade_offers SET status = 'failed', resolved_at = ?
          WHERE status = 'pending' AND id <> ?
            AND (offered_instance_id IN (?, ?) OR requested_instance_id IN (?, ?))`,
      ).run(
        resolvedAt,
        offerId,
        offer.offered_instance_id,
        offer.requested_instance_id,
        offer.offered_instance_id,
        offer.requested_instance_id,
      );
      return "accepted";
    })
    .immediate();
}

/** The recipient declines a pending offer, which unlocks the offered card (AC-010.6). */
export function declineOffer(db: Db, recipientId: number, offerId: number, now = new Date()): void {
  db.transaction(() => {
    pendingOfferForRecipient(db, recipientId, offerId);
    db.prepare("UPDATE trade_offers SET status = 'declined', resolved_at = ? WHERE id = ?").run(
      now.toISOString(),
      offerId,
    );
  }).immediate();
}

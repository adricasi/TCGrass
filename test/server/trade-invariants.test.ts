import { describe, expect, it } from "vitest";

import type { Db } from "../../src/server/db/connection.js";
import { respondToFriendRequest, sendFriendRequest } from "../../src/server/game/friends.js";
import { mintCard } from "../../src/server/game/mint.js";
import {
  acceptOffer,
  cancelOffer,
  createOffer,
  declineOffer,
  TradeError,
} from "../../src/server/game/trades.js";
import { createPlayer, type CreatedPlayer } from "../../src/server/players/service.js";
import { seededDb } from "./helpers.js";

/** Small deterministic PRNG (mulberry32), so a failing run can be replayed from its seed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Snapshot {
  instances: Map<number, number>;
  /** Cards per player at the start: 1:1 swaps keep each exactly. */
  perPlayer: Map<number, number>;
}

interface ResolvedOffer {
  status: string;
  resolved_at: string | null;
}

function cardsPerPlayer(db: Db): Map<number, number> {
  const rows = db
    .prepare("SELECT owner_id, COUNT(*) AS n FROM card_instances GROUP BY owner_id")
    .all() as {
    owner_id: number;
    n: number;
  }[];
  return new Map(rows.map((row) => [row.owner_id, row.n]));
}

function resolvedOffers(db: Db): Map<number, ResolvedOffer> {
  const rows = db
    .prepare("SELECT id, status, resolved_at FROM trade_offers WHERE status <> 'pending'")
    .all() as (ResolvedOffer & { id: number })[];
  return new Map(rows.map((row) => [row.id, { status: row.status, resolved_at: row.resolved_at }]));
}

function owners(db: Db): Map<number, number> {
  const rows = db.prepare("SELECT id, owner_id FROM card_instances").all() as {
    id: number;
    owner_id: number;
  }[];
  return new Map(rows.map((row) => [row.id, row.owner_id]));
}

/** NFR-009 invariants, checked after every action. */
function checkInvariants(
  db: Db,
  start: Snapshot,
  playerIds: Set<number>,
  before: Map<number, ResolvedOffer>,
  step: string,
): void {
  const now = owners(db);
  // Instances are never created or destroyed by trades.
  expect(
    [...now.keys()].sort((a, b) => a - b),
    step,
  ).toEqual([...start.instances.keys()].sort((a, b) => a - b));
  // Every instance has exactly one owner, and it is a player of the game.
  for (const [id, owner] of now) {
    expect(playerIds.has(owner), `${step}: instance ${id} owner ${owner}`).toBe(true);
  }
  // No instance is the offered card of two pending offers (the lock).
  const doubleLocked = db
    .prepare(
      "SELECT offered_instance_id FROM trade_offers WHERE status = 'pending' GROUP BY offered_instance_id HAVING COUNT(*) > 1",
    )
    .all();
  expect(doubleLocked, step).toEqual([]);
  // Every pending offer still matches its owners (AC-010.4 failed the stale ones).
  const stale = db
    .prepare(
      `SELECT t.id FROM trade_offers t
         JOIN card_instances o ON o.id = t.offered_instance_id
         JOIN card_instances r ON r.id = t.requested_instance_id
        WHERE t.status = 'pending' AND (o.owner_id <> t.from_player_id OR r.owner_id <> t.to_player_id)`,
    )
    .all();
  expect(stale, step).toEqual([]);
  // 1:1 swaps keep every player's card count exactly.
  expect(cardsPerPlayer(db), step).toEqual(start.perPlayer);
  // The state machine: terminal states never change again, and resolved_at is set exactly
  // when an offer is no longer pending.
  const after = resolvedOffers(db);
  for (const [id, offer] of before) {
    expect(after.get(id), `${step}: offer ${id} left a terminal state`).toEqual(offer);
  }
  const badResolution = db
    .prepare("SELECT id FROM trade_offers WHERE (status = 'pending') <> (resolved_at IS NULL)")
    .all();
  expect(badResolution, step).toEqual([]);
}

function runSeededTrades(
  seed: number,
  actions: number,
): { accepted: number; failedOrRejected: number } {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error("empty pick");
    }
    return item;
  };

  const { db } = seededDb();
  const players: CreatedPlayer[] = Array.from({ length: 5 }, (_unused, index) =>
    createPlayer(db, `P${index}`),
  );
  for (const [index, a] of players.entries()) {
    for (const b of players.slice(index + 1)) {
      respondToFriendRequest(db, b.id, sendFriendRequest(db, a.id, b.friendCode).id, true);
    }
  }
  for (const player of players) {
    for (let card = 0; card < 6; card += 1) {
      mintCard(db, {
        ownerId: player.id,
        expansionId: "fixture-a",
        cardId: pick(["oak", "rose", "fox"]),
        rarity: pick(["common", "rare", "epic", "legendary"]),
        flavorLine: null,
      });
    }
  }
  const start: Snapshot = { instances: owners(db), perPlayer: cardsPerPlayer(db) };
  const playerIds = new Set(players.map((player) => player.id));
  let accepted = 0;
  let failedOrRejected = 0;

  const pendingOffers = () =>
    db
      .prepare("SELECT id, from_player_id, to_player_id FROM trade_offers WHERE status = 'pending'")
      .all() as {
      id: number;
      from_player_id: number;
      to_player_id: number;
    }[];

  for (let step = 0; step < actions; step += 1) {
    const before = resolvedOffers(db);
    const kind = pick(["create", "create", "accept", "decline", "cancel", "stranger"] as const);
    const pending = pendingOffers();
    try {
      if (kind === "create" || pending.length === 0) {
        const from = pick(players);
        const mine = [...owners(db)].filter(([, owner]) => owner === from.id).map(([id]) => id);
        const theirs = [...owners(db)].filter(([, owner]) => owner !== from.id).map(([id]) => id);
        if (mine.length > 0 && theirs.length > 0) {
          createOffer(db, from.id, pick(mine), pick(theirs));
        }
      } else {
        const offer = pick(pending);
        if (kind === "accept") {
          const cards = db
            .prepare(
              "SELECT offered_instance_id AS o, requested_instance_id AS r FROM trade_offers WHERE id = ?",
            )
            .get(offer.id) as { o: number; r: number };
          // "failed" can't happen here: stale offers are failed eagerly (AC-010.4) and the
          // invariants assert none remain; AC-010.5 has its own test in accept-decline.test.ts.
          expect(acceptOffer(db, offer.to_player_id, offer.id)).toBe("accepted");
          accepted += 1;
          const now = owners(db);
          expect(now.get(cards.o)).toBe(offer.to_player_id);
          expect(now.get(cards.r)).toBe(offer.from_player_id);
        } else if (kind === "decline") {
          declineOffer(db, offer.to_player_id, offer.id);
        } else if (kind === "cancel") {
          cancelOffer(db, offer.from_player_id, offer.id);
        } else {
          // Someone who is neither side tries to answer: must be rejected and change nothing.
          const stranger = players.find(
            (player) => player.id !== offer.from_player_id && player.id !== offer.to_player_id,
          );
          if (stranger !== undefined) {
            acceptOffer(db, stranger.id, offer.id);
          }
        }
      }
    } catch (error) {
      // Rule violations when creating offers (locked card, own card, too many offers…) are
      // expected and must leave the data valid; anything else is a bug.
      if (!(error instanceof TradeError)) {
        throw error;
      }
      failedOrRejected += 1;
    }
    checkInvariants(db, start, playerIds, before, `seed ${seed}, step ${step} (${kind})`);
  }
  return { accepted, failedOrRejected };
}

describe("NFR-009 trade invariants", () => {
  it.each([1, 7, 42])(
    "NFR-009 500 seeded interleaved create/accept/decline/cancel actions keep every invariant (seed %i)",
    (seed) => {
      const result = runSeededTrades(seed, 500);
      // The run must actually exercise trades, not only rejections.
      expect(result.accepted).toBeGreaterThan(10);
      expect(result.failedOrRejected).toBeGreaterThan(10);
    },
  );
});

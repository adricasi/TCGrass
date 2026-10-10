import type {
  Friend,
  FriendRequestResult,
  IncomingFriendRequest,
} from "../../shared/schemas/friends.js";
import type { PublicPlayer } from "../../shared/schemas/players.js";
import type { Db } from "../db/connection.js";

/** A rule of REQ-008 was broken; `status` and `code` follow design.md § Interfaces. */
export class FriendError extends Error {
  override name = "FriendError";

  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface PlayerRow {
  id: number;
  display_name: string;
  friend_code: string;
}

function toPublic(row: PlayerRow): PublicPlayer {
  return { displayName: row.display_name, friendCode: row.friend_code };
}

export function findPlayerByFriendCode(db: Db, friendCode: string): PlayerRow | undefined {
  return db
    .prepare<[string], PlayerRow>(
      "SELECT id, display_name, friend_code FROM players WHERE friend_code = ?",
    )
    .get(friendCode);
}

function playerById(db: Db, id: number): PlayerRow {
  const row = db
    .prepare<[number], PlayerRow>("SELECT id, display_name, friend_code FROM players WHERE id = ?")
    .get(id);
  if (row === undefined) {
    throw new Error(`player ${id} vanished`);
  }
  return row;
}

/** Friendships are stored once per pair with the lower id first (design § Data model). */
function orderedPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function areFriends(db: Db, a: number, b: number): boolean {
  return (
    db
      .prepare("SELECT 1 FROM friendships WHERE player_a_id = ? AND player_b_id = ?")
      .get(...orderedPair(a, b)) !== undefined
  );
}

/**
 * Sends a friend request to the player with `friendCode` (already normalised), checking
 * every AC-008.3 rule inside one IMMEDIATE transaction.
 */
export function sendFriendRequest(
  db: Db,
  fromId: number,
  friendCode: string,
  now = new Date(),
): FriendRequestResult {
  return db
    .transaction((): FriendRequestResult => {
      const target = findPlayerByFriendCode(db, friendCode);
      if (target === undefined) {
        throw new FriendError(404, "player_not_found", "No player with that code");
      }
      if (target.id === fromId) {
        throw new FriendError(400, "own_code", "That's your own friend code.");
      }
      if (areFriends(db, fromId, target.id)) {
        throw new FriendError(409, "already_friends", "You're already friends.");
      }
      const pending = db
        .prepare(
          `SELECT 1 FROM friend_requests WHERE status = 'pending'
             AND ((from_player_id = ? AND to_player_id = ?) OR (from_player_id = ? AND to_player_id = ?))`,
        )
        .get(fromId, target.id, target.id, fromId);
      if (pending !== undefined) {
        throw new FriendError(
          409,
          "request_pending",
          "A friend request between you is already waiting for an answer.",
        );
      }
      const result = db
        .prepare(
          "INSERT INTO friend_requests (from_player_id, to_player_id, status, created_at) VALUES (?, ?, 'pending', ?)",
        )
        .run(fromId, target.id, now.toISOString());
      return { id: Number(result.lastInsertRowid), status: "pending", player: toPublic(target) };
    })
    .immediate();
}

/**
 * Accepts or declines a request. Only its recipient may, and only while it is pending
 * (AC-008.7, AC-008.8); everything is re-checked inside the transaction.
 */
export function respondToFriendRequest(
  db: Db,
  callerId: number,
  requestId: number,
  accept: boolean,
  now = new Date(),
): FriendRequestResult {
  return db
    .transaction((): FriendRequestResult => {
      const request = db
        .prepare<[number], { from_player_id: number; to_player_id: number; status: string }>(
          "SELECT from_player_id, to_player_id, status FROM friend_requests WHERE id = ?",
        )
        .get(requestId);
      if (request === undefined) {
        throw new FriendError(404, "request_not_found", "No such friend request.");
      }
      if (request.to_player_id !== callerId) {
        throw new FriendError(403, "not_recipient", "Only the recipient can answer this request.");
      }
      if (request.status !== "pending") {
        throw new FriendError(409, "not_pending", "This request was already answered.");
      }
      const status = accept ? "accepted" : "declined";
      db.prepare("UPDATE friend_requests SET status = ?, resolved_at = ? WHERE id = ?").run(
        status,
        now.toISOString(),
        requestId,
      );
      if (accept) {
        db.prepare(
          // Plain INSERT: the pending/already-friends rules make a duplicate impossible, so one
          // would be a bug and should surface rather than be ignored.
          "INSERT INTO friendships (player_a_id, player_b_id, created_at) VALUES (?, ?, ?)",
        ).run(...orderedPair(callerId, request.from_player_id), now.toISOString());
      }
      return { id: requestId, status, player: toPublic(playerById(db, request.from_player_id)) };
    })
    .immediate();
}

export function listFriends(db: Db, playerId: number): Friend[] {
  return db
    .prepare<[number, number, number], PlayerRow & { since: string }>(
      `SELECT p.id, p.display_name, p.friend_code, f.created_at AS since
         FROM friendships f
         JOIN players p ON p.id = CASE WHEN f.player_a_id = ? THEN f.player_b_id ELSE f.player_a_id END
        WHERE f.player_a_id = ? OR f.player_b_id = ?
        ORDER BY p.display_name COLLATE NOCASE, p.id`,
    )
    .all(playerId, playerId, playerId)
    .map((row) => ({ ...toPublic(row), since: row.since }));
}

/** Received pending requests, oldest first (AC-008.6). */
export function incomingFriendRequests(db: Db, playerId: number): IncomingFriendRequest[] {
  return db
    .prepare<[number], PlayerRow & { request_id: number; created_at: string }>(
      `SELECT r.id AS request_id, r.created_at, p.id, p.display_name, p.friend_code
         FROM friend_requests r JOIN players p ON p.id = r.from_player_id
        WHERE r.to_player_id = ? AND r.status = 'pending'
        ORDER BY r.created_at, r.id`,
    )
    .all(playerId)
    .map((row) => ({ id: row.request_id, from: toPublic(row), createdAt: row.created_at }));
}

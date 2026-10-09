import type { Db } from "../db/connection.js";
import { generateFriendCode } from "./friend-code.js";
import { generateSecret, hashSecret } from "./secret.js";

export interface Player {
  id: number;
  displayName: string;
  friendCode: string;
}

export interface CreatedPlayer extends Player {
  /** Returned to the client once and never stored (AC-002.9, AC-002.10). */
  secret: string;
}

const MAX_FRIEND_CODE_ATTEMPTS = 5;

function isFriendCodeClash(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "SQLITE_CONSTRAINT_UNIQUE" &&
    error.message.includes("players.friend_code")
  );
}

/** Creates a player, generating a new friend code if one already exists (AC-002.2). */
export function createPlayer(
  db: Db,
  displayName: string,
  options: { friendCode?: () => string; now?: Date } = {},
): CreatedPlayer {
  const nextFriendCode = options.friendCode ?? (() => generateFriendCode());
  const secret = generateSecret();
  const insert = db.prepare<[string, string, string, string]>(
    "INSERT INTO players (secret_hash, display_name, friend_code, created_at) VALUES (?, ?, ?, ?)",
  );
  for (let attempt = 1; ; attempt += 1) {
    const friendCode = nextFriendCode();
    try {
      const result = insert.run(
        hashSecret(secret),
        displayName,
        friendCode,
        (options.now ?? new Date()).toISOString(),
      );
      return { id: Number(result.lastInsertRowid), displayName, friendCode, secret };
    } catch (error) {
      if (!isFriendCodeClash(error) || attempt >= MAX_FRIEND_CODE_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/** The player whose secret this is, or undefined (callers must not say which case). */
export function findPlayerBySecret(db: Db, secret: string): Player | undefined {
  const row = db
    .prepare<[string], { id: number; display_name: string; friend_code: string }>(
      "SELECT id, display_name, friend_code FROM players WHERE secret_hash = ?",
    )
    .get(hashSecret(secret));
  return row === undefined
    ? undefined
    : { id: row.id, displayName: row.display_name, friendCode: row.friend_code };
}

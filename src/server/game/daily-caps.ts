import type { Db } from "../db/connection.js";

export interface DailyCaps {
  /** Model calls per UTC day across all players (AC-003.13). */
  global: number;
  /** Model calls per UTC day for one player (AC-003.14). */
  perPlayer: number;
}

export const DEFAULT_DAILY_CAPS: DailyCaps = { global: 3000, perPlayer: 30 };

/** Days of counts kept before pruning. */
const KEEP_DAYS = 7;

export type Reservation = { ok: true } | { ok: false; cap: "global" | "player"; resumesAt: string };

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** 00:00 UTC of the next day, when the counts start again. */
export function nextUtcMidnight(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

/**
 * Reserves one model call for `playerId` against both daily caps, in one IMMEDIATE
 * transaction: both counts are checked and incremented together, so concurrent captures
 * can't overshoot and a refused call uses neither cap (NFR-012).
 */
export function reserveModelCall(
  db: Db,
  playerId: number,
  caps: DailyCaps,
  now = new Date(),
): Reservation {
  const day = utcDay(now);
  const playerScope = `player:${playerId}`;
  return db
    .transaction((): Reservation => {
      // Old days are no longer needed: keep a week for the field-test metrics.
      db.prepare("DELETE FROM daily_call_counts WHERE day < ?").run(
        utcDay(new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000)),
      );
      const ensure = db.prepare(
        "INSERT OR IGNORE INTO daily_call_counts (day, scope, n) VALUES (?, ?, 0)",
      );
      ensure.run(day, "all");
      ensure.run(day, playerScope);
      const count = db.prepare<[string, string], { n: number }>(
        "SELECT n FROM daily_call_counts WHERE day = ? AND scope = ?",
      );
      const playerCount = count.get(day, playerScope)?.n ?? 0;
      const globalCount = count.get(day, "all")?.n ?? 0;
      if (playerCount >= caps.perPlayer) {
        return { ok: false, cap: "player", resumesAt: nextUtcMidnight(now) };
      }
      if (globalCount >= caps.global) {
        return { ok: false, cap: "global", resumesAt: nextUtcMidnight(now) };
      }
      const increment = db.prepare(
        "UPDATE daily_call_counts SET n = n + 1 WHERE day = ? AND scope = ?",
      );
      increment.run(day, "all");
      increment.run(day, playerScope);
      return { ok: true };
    })
    .immediate();
}

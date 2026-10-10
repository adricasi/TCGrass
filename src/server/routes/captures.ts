import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { CaptureResponse } from "../../shared/schemas/captures.js";
import { cardImageUrl } from "../../shared/schemas/expansion.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import type { StoredExpansion } from "../expansion/repository.js";
import { mintCapture } from "../game/mint.js";
import { type DailyCaps, reserveModelCall } from "../game/daily-caps.js";
import { rollRarity } from "../game/rarity.js";
import type { Identification, Identifier } from "../identify/client.js";
import type { InFlightLimiter } from "../inflight.js";
import type { Logger } from "../logger.js";
import { detectPhotoType, MAX_PHOTO_BYTES } from "../photo.js";
import type { SlidingWindowLimiter } from "../rate-limit.js";

function isDatabaseBusy(error: unknown): boolean {
  return error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_BUSY");
}

/**
 * Token counts the endpoint reported, logged so the daily cost can be computed (NFR-012).
 * Logged as `usage.prompt` / `usage.completion`: the log scrubber blanks any key containing
 * "token", which must stay strict for secrets.
 */
function usageFields(identification: Identification): {
  usage?: { prompt: number; completion: number };
} {
  return identification.usage === undefined
    ? {}
    : {
        usage: {
          prompt: identification.usage.promptTokens,
          completion: identification.usage.completionTokens,
        },
      };
}

/** Room for the multipart boundary and part headers around a 5 MB photo. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export interface CaptureRouteDeps {
  db: Db;
  expansion: StoredExpansion;
  identify: Identifier;
  /** Photos per player that passed the type and size checks: 10 per 60 s (AC-003.11). */
  perPlayer: SlidingWindowLimiter;
  /** Random source for the rarity roll; `crypto.randomInt` unless a test injects one. */
  random?: (max: number) => number;
  /** Daily model-call caps, counted in the DB (AC-003.13, AC-003.14, NFR-012). */
  dailyCaps: DailyCaps;
  /** Wait before a player can capture the same card again; 0 = off (REQ-014). */
  cooldownMs: number;
  now: () => Date;
  /** Identification calls in progress (AC-003.12). */
  inFlight: InFlightLimiter;
  /** Uploads being received; each buffers up to 5 MB in memory before the in-flight cap. */
  uploads: InFlightLimiter;
  logger: Logger;
}

/**
 * Reads the multipart `photo` field into memory. The photo lives only for this request (Hono
 * also caches the parsed body on the request): nothing outlives the response, and nothing is
 * written to disk or logged (AC-004.1).
 */
async function readPhoto(c: Context<AppEnv>): Promise<Uint8Array | Response> {
  const form = await c.req.parseBody().catch(() => undefined);
  const file = form?.photo;
  if (!(file instanceof File)) {
    return errorJson(c, 400, "photo_missing", "Send the photo as the multipart field 'photo'.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return errorJson(c, 413, "photo_too_large", "The photo must be 5 MB or smaller.");
  }
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * `POST /api/captures`: identifies the photo and, on a match, rolls the rarity on the server
 * and mints the card for the caller (REQ-003, REQ-005). The photo is kept in memory only,
 * sent only to the identifier and never logged or stored (REQ-004).
 */
export function captureRoutes({
  db,
  expansion,
  identify,
  perPlayer,
  random,
  dailyCaps,
  cooldownMs,
  now,
  inFlight,
  uploads,
  logger,
}: CaptureRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  // Each cap is logged once per UTC day when first reached (NFR-012): the global cap, and each
  // player's, which is the signal for spotting many players run by one person.
  let loggedDay = "";
  const loggedCaps = new Set<string>();
  const logCapReached = (cap: "global" | "player", playerId: number) => {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== loggedDay) {
      loggedDay = day;
      loggedCaps.clear();
    }
    const key = cap === "global" ? "global" : `player:${playerId}`;
    if (!loggedCaps.has(key)) {
      loggedCaps.add(key);
      logger.warn({
        event: "daily_cap_reached",
        cap,
        ...(cap === "player" ? { playerId } : {}),
      });
    }
  };
  const cardsById = new Map(expansion.cards.map((card) => [card.id, card]));

  routes.post(
    "/",
    // Checked before the body is read, so parallel uploads cannot exhaust memory.
    async (c, next) => {
      if (!uploads.tryAcquire()) {
        return errorJson(c, 503, "busy", "Too many captures right now. Try again in a moment.");
      }
      try {
        await next();
      } finally {
        uploads.release();
      }
    },
    bodyLimit({
      maxSize: MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES,
      onError: (c) => errorJson(c, 413, "photo_too_large", "The photo must be 5 MB or smaller."),
    }),
    async (c) => {
      const player = c.get("player");
      // Only the photo is read from the request: a rarity, card id or any other field the
      // client sends is ignored (AC-005.3).
      const read = await readPhoto(c);
      if (read instanceof Response) {
        return read;
      }
      let bytes: Uint8Array | undefined = read;
      try {
        const mimeType = detectPhotoType(bytes);
        if (mimeType === undefined) {
          return errorJson(c, 415, "photo_type", "The photo must be a JPEG, PNG or WebP image.");
        }
        // In-flight cap first, so a "busy" rejection does not use up the player's allowance.
        if (!inFlight.tryAcquire()) {
          return errorJson(c, 503, "busy", "Too many captures right now. Try again in a moment.");
        }
        let identification: Identification;
        const started = performance.now();
        try {
          if (!perPlayer.tryHit(String(player.id))) {
            return errorJson(
              c,
              429,
              "rate_limited",
              "That's a lot of photos! Wait a minute and try again.",
            );
          }
          // Last check before the call, so rejected photos never use a daily cap (AC-003.13).
          // A refusal here (cap reached, or a rare SQLITE_BUSY) has already used one of the
          // player's per-minute hits; accepted, since both are rare and the limit resets in 60 s.
          let reservation;
          try {
            reservation = reserveModelCall(db, player.id, dailyCaps);
          } catch (error) {
            if (isDatabaseBusy(error)) {
              return errorJson(
                c,
                503,
                "busy",
                "Too many captures right now. Try again in a moment.",
              );
            }
            throw error;
          }
          if (!reservation.ok) {
            logCapReached(reservation.cap, player.id);
            return errorJson(
              c,
              503,
              "daily_limit",
              reservation.cap === "player"
                ? "You've used today's captures. They come back at midnight UTC."
                : "Today's captures for everyone are used up. They come back at midnight UTC.",
              { resumesAt: reservation.resumesAt },
            );
          }
          try {
            identification = await identify({ bytes, mimeType });
          } catch (error) {
            // Any identifier failure is a "try again", never a 500 (AC-003.9). Name only: the
            // message could carry model or request data.
            logger.warn({
              requestId: c.get("requestId"),
              event: "identify_error",
              error: error instanceof Error ? error.name : "unknown",
            });
            identification = { outcome: "retry", reason: "network-error" };
          }
        } finally {
          inFlight.release();
          bytes = undefined;
        }
        const modelLatencyMs = Math.round(performance.now() - started);

        if (identification.outcome !== "card") {
          logger.info({
            requestId: c.get("requestId"),
            event: "capture",
            outcome: identification.outcome,
            reason: "reason" in identification ? identification.reason : undefined,
            modelLatencyMs,
            ...usageFields(identification),
          });
          const body: CaptureResponse = { outcome: identification.outcome };
          return c.json(body);
        }

        const card = cardsById.get(identification.cardId);
        if (card === undefined) {
          // The identifier only returns catalogue ids; treat anything else as no match.
          logger.info({
            requestId: c.get("requestId"),
            event: "capture",
            outcome: "none",
            reason: "unknown-card",
            modelLatencyMs,
          });
          const body: CaptureResponse = { outcome: "none" };
          return c.json(body);
        }
        let result;
        try {
          result = mintCapture(db, {
            ownerId: player.id,
            expansionId: expansion.expansion.id,
            cardId: card.id,
            rollRarity: () => rollRarity(expansion.expansion.rarity_odds, random),
            flavorLine: identification.flavorLine,
            cooldownMs,
            now: now(),
          });
        } catch (error) {
          if (isDatabaseBusy(error)) {
            // busy_timeout (5 s) ran out: design § Interfaces answers 503, not 500.
            return errorJson(c, 503, "busy", "Too many captures right now. Try again in a moment.");
          }
          throw error;
        }
        if (result.kind === "cooldown") {
          // The model call already happened and counts toward the daily caps (AC-014.5).
          logger.info({
            requestId: c.get("requestId"),
            event: "capture",
            outcome: "cooldown",
            cardId: card.id,
            modelLatencyMs,
            ...usageFields(identification),
          });
          const body: CaptureResponse = {
            outcome: "cooldown",
            cooldown: { cardId: card.id, name: card.name, availableAt: result.availableAt },
          };
          return c.json(body);
        }
        const minted = result.card;
        logger.info({
          requestId: c.get("requestId"),
          event: "capture",
          outcome: "card",
          cardId: card.id,
          rarity: minted.rarity,
          modelLatencyMs,
          ...usageFields(identification),
        });
        const body: CaptureResponse = {
          outcome: "card",
          card: {
            id: minted.id,
            cardId: card.id,
            name: card.name,
            category: card.category,
            rarity: minted.rarity,
            flavorLine: minted.flavorLine,
            imageUrl: cardImageUrl(expansion.expansion.id, card.id),
          },
        };
        return c.json(body);
      } finally {
        bytes = undefined;
      }
    },
  );

  return routes;
}

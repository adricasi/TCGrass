import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { CaptureResponse } from "../../shared/schemas/captures.js";
import { cardImageUrl } from "../../shared/schemas/expansion.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import type { StoredExpansion } from "../expansion/repository.js";
import { mintCard } from "../game/mint.js";
import { rollRarity } from "../game/rarity.js";
import type { Identification, Identifier } from "../identify/client.js";
import type { InFlightLimiter } from "../inflight.js";
import type { Logger } from "../logger.js";
import { detectPhotoType, MAX_PHOTO_BYTES } from "../photo.js";
import type { SlidingWindowLimiter } from "../rate-limit.js";

function isDatabaseBusy(error: unknown): boolean {
  return error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_BUSY");
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
  inFlight,
  uploads,
  logger,
}: CaptureRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
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
        let minted;
        try {
          minted = mintCard(db, {
            ownerId: player.id,
            expansionId: expansion.expansion.id,
            cardId: card.id,
            rarity: rollRarity(expansion.expansion.rarity_odds, random),
            flavorLine: identification.flavorLine,
          });
        } catch (error) {
          if (isDatabaseBusy(error)) {
            // busy_timeout (5 s) ran out: design § Interfaces answers 503, not 500.
            return errorJson(c, 503, "busy", "Too many captures right now. Try again in a moment.");
          }
          throw error;
        }
        logger.info({
          requestId: c.get("requestId"),
          event: "capture",
          outcome: "card",
          cardId: card.id,
          rarity: minted.rarity,
          modelLatencyMs,
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

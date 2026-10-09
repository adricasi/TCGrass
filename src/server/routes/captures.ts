import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { CaptureResponse } from "../../shared/schemas/captures.js";
import type { AppEnv } from "../app.js";
import { errorJson } from "../errors.js";
import type { Identification, Identifier } from "../identify/client.js";
import type { InFlightLimiter } from "../inflight.js";
import type { Logger } from "../logger.js";
import { detectPhotoType, MAX_PHOTO_BYTES } from "../photo.js";

/** Room for the multipart boundary and part headers around a 5 MB photo. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export interface CaptureRouteDeps {
  identify: Identifier;
  /** Identification calls in progress (AC-003.12). */
  inFlight: InFlightLimiter;
  /** Uploads being received; each buffers up to 5 MB in memory before the in-flight cap. */
  uploads: InFlightLimiter;
  logger: Logger;
}

/**
 * Reads the multipart `photo` field into memory. The form and File objects stay inside this
 * function, so once the caller drops the returned bytes nothing references the photo.
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

function toResponse(identification: Identification): CaptureResponse {
  return identification.outcome === "card"
    ? { outcome: "card", cardId: identification.cardId }
    : { outcome: identification.outcome };
}

/**
 * `POST /api/captures`, temporary T-002a version: identifies the photo and returns the
 * outcome. No auth, DB or minting yet (T-004, T-005). The photo stays in memory only and is
 * never logged (REQ-004).
 */
export function captureRoutes({
  identify,
  inFlight,
  uploads,
  logger,
}: CaptureRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

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
        if (!inFlight.tryAcquire()) {
          return errorJson(c, 503, "busy", "Too many captures right now. Try again in a moment.");
        }
        try {
          const started = performance.now();
          const identification = await identify({ bytes, mimeType });
          logger.info({
            requestId: c.get("requestId"),
            event: "capture",
            outcome: identification.outcome,
            cardId: identification.outcome === "card" ? identification.cardId : undefined,
            reason: "reason" in identification ? identification.reason : undefined,
            modelLatencyMs: Math.round(performance.now() - started),
          });
          return c.json(toResponse(identification));
        } finally {
          inFlight.release();
        }
      } finally {
        // The last reference to the photo: drop it so it can be garbage-collected (AC-004.1).
        bytes = undefined;
      }
    },
  );

  return routes;
}

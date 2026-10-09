import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  type CreatePlayerResponse,
  DISPLAY_NAME_RULE,
  createPlayerRequestSchema,
  type MeResponse,
} from "../../shared/schemas/players.js";
import type { AppEnv } from "../app.js";
import { clientIp } from "../client-ip.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import { createPlayer } from "../players/service.js";
import type { SlidingWindowLimiter } from "../rate-limit.js";

export interface PlayerRouteDeps {
  db: Db;
  creations: SlidingWindowLimiter;
  trustProxy: boolean;
}

/** A display name is at most 20 characters; anything near this size is not a valid request. */
const MAX_BODY_BYTES = 1024;

/** `POST /api/players` (public): creates an anonymous player (REQ-002). */
export function playerRoutes({ db, creations, trustProxy }: PlayerRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post(
    "/",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => errorJson(c, 413, "body_too_large", "Request body too large."),
    }),
    async (c) => {
      // JSON only: a cross-site form or no-cors fetch cannot send it without a CORS
      // preflight, which fails (no CORS), so other sites cannot create players.
      const contentType = c.req.header("content-type") ?? "";
      if (!/^application\/json(;|$)/i.test(contentType)) {
        return errorJson(c, 415, "unsupported_media_type", "Send JSON.");
      }
      const json: unknown = await c.req.json().catch(() => undefined);
      const request = createPlayerRequestSchema.safeParse(json);
      if (!request.success) {
        return errorJson(c, 400, "invalid_display_name", DISPLAY_NAME_RULE);
      }
      // Counted only for valid requests, so typos do not use up the allowance (AC-002.8).
      if (!creations.tryHit(clientIp(c, trustProxy))) {
        return errorJson(
          c,
          429,
          "rate_limited",
          "Too many new players from here. Try again later.",
        );
      }
      const player = createPlayer(db, request.data.displayName);
      const body: CreatePlayerResponse = {
        secret: player.secret,
        displayName: player.displayName,
        friendCode: player.friendCode,
      };
      return c.json(body, 201);
    },
  );
  return routes;
}

/** `GET /api/me`: the authenticated player's public profile (AC-002.3). */
export function meRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => {
    const player = c.get("player");
    const body: MeResponse = { displayName: player.displayName, friendCode: player.friendCode };
    return c.json(body);
  });
  return routes;
}

import type { MiddlewareHandler } from "hono";

import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import { findPlayerBySecret } from "./service.js";
import { isWellFormedSecret } from "./secret.js";

/** The scheme name is case-insensitive (RFC 7235). */
const BEARER = /^Bearer +(\S+)$/i;

export interface PublicRoute {
  method: string;
  path: string;
}

/**
 * Requires `Authorization: Bearer <player secret>` on every request except `publicRoutes`.
 * Missing, malformed and unknown secrets get the same 401, so the response never reveals
 * whether a player exists (AC-002.5).
 */
export function requirePlayer(
  db: Db,
  publicRoutes: readonly PublicRoute[] = [],
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (publicRoutes.some((route) => route.method === c.req.method && route.path === c.req.path)) {
      await next();
      return;
    }
    const secret = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const player =
      secret !== undefined && isWellFormedSecret(secret)
        ? findPlayerBySecret(db, secret)
        : undefined;
    if (player === undefined) {
      return errorJson(c, 401, "unauthenticated", "Player not found. Create a new player.");
    }
    c.set("player", player);
    await next();
  };
}

import { randomUUID } from "node:crypto";

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { Db } from "./db/connection.js";
import { errorJson } from "./errors.js";
import type { StoredExpansion } from "./expansion/repository.js";
import { type DailyCaps, DEFAULT_DAILY_CAPS } from "./game/daily-caps.js";
import type { Identifier } from "./identify/client.js";
import { InFlightLimiter } from "./inflight.js";
import type { Logger } from "./logger.js";
import { requirePlayer } from "./players/auth.js";
import type { Player } from "./players/service.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { binderRoutes } from "./routes/binder.js";
import { cardRoutes, SVG_CSP } from "./routes/cards.js";
import { friendRequestRoutes, friendRoutes, UNKNOWN_FRIEND_CODES } from "./routes/friends.js";
import { inboxRoutes } from "./routes/inbox.js";
import { tradeRoutes } from "./routes/trades.js";
import { captureRoutes } from "./routes/captures.js";
import { expansionRoutes } from "./routes/expansion.js";
import { meRoutes, playerRoutes } from "./routes/players.js";

export const MAX_IDENTIFICATIONS_IN_FLIGHT = 5;
/** Photos being uploaded at once; bounds upload memory to about 10 × 5 MB (NFR-005). */
export const MAX_UPLOADS_IN_FLIGHT = 10;

export interface AppEnv {
  /** `player` is set by `requirePlayer` on authenticated routes only. */
  Variables: { requestId: string; player: Player };
}

/** The only /api routes reachable without a player secret (design.md § Interfaces). */
export const PUBLIC_API_ROUTES = [
  { method: "POST", path: "/api/players" },
  { method: "GET", path: "/api/expansion" },
] as const;

/** Photos per player that pass the type and size checks: 10 per 60 s (AC-003.11). */
export const CAPTURES_PER_PLAYER = { limit: 10, windowMs: 60 * 1000 };

/** Player creations per client IP: 10 per 60 minutes (AC-002.8). */
export const PLAYER_CREATIONS_PER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };

export interface AppDeps {
  db: Db;
  /** The active expansion, loaded from the DB at startup. */
  expansion: StoredExpansion;
  identify: Identifier;
  logger: Logger;
  maxInFlight?: number;
  maxUploads?: number;
  /** Replaces the per-IP creation limiter (tests use a fake clock). */
  playerCreations?: SlidingWindowLimiter;
  /** Read the client IP from X-Forwarded-For (only behind Caddy, TRUST_PROXY=true). */
  trustProxy?: boolean;
  /** Replaces the unknown-friend-code limiter (tests use a fake clock). */
  unknownFriendCodes?: SlidingWindowLimiter;
  /** Replaces the per-player capture limiter (tests use a fake clock). */
  capturesPerPlayer?: SlidingWindowLimiter;
  /** Daily model-call caps (NFR-012); defaults to 3,000 overall and 30 per player. */
  dailyCaps?: DailyCaps;
  /** Random source for rarity rolls (tests); `crypto.randomInt` otherwise. */
  random?: (max: number) => number;
  /** Absolute path of the built PWA (`dist/web`); unset serves the API only. */
  webRoot?: string;
}

/** Builds the API. Dependencies are injected so tests run it with a fake model. */
export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { logger } = deps;
  const app = new Hono<AppEnv>();

  // Always our own id: a client-supplied X-Request-Id would let callers forge log lines.
  app.use(async (c, next) => {
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await next();
  });

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    // Method, path and status only: never headers, query strings or bodies (NFR-007).
    logger.info({
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      latencyMs: Math.round(performance.now() - started),
    });
  });

  // Registered before secureHeaders so it runs after it and can tighten the CSP for SVG art.
  app.use("/cards/*", async (c, next) => {
    await next();
    if (c.res.headers.get("content-type") === "image/svg+xml") {
      c.header("Content-Security-Policy", SVG_CSP);
    }
  });
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "blob:", "data:"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
    }),
  );
  app.use(async (c, next) => {
    await next();
    c.header("Permissions-Policy", "camera=(self), geolocation=()");
  });

  // Reports DB reachability only (NFR-007).
  app.get("/healthz", (c) => {
    try {
      deps.db.prepare("SELECT 1").get();
      return c.json({ status: "ok" });
    } catch (error) {
      logger.warn({
        requestId: c.get("requestId"),
        event: "healthz_db_error",
        error: error instanceof Error ? error.name : "unknown",
      });
      return errorJson(c, 503, "db_unavailable", "Database unavailable.");
    }
  });

  // Default deny: every /api route needs a player except the public ones (design.md
  // § Interfaces), so a route added later cannot be public by accident (AC-002.5).
  app.use("/api/*", requirePlayer(deps.db, PUBLIC_API_ROUTES));
  // API answers are per player and some carry the secret: never cache them (AC-002.10).
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.route("/api/expansion", expansionRoutes(deps.expansion));
  app.route(
    "/api/players",
    playerRoutes({
      db: deps.db,
      creations:
        deps.playerCreations ??
        new SlidingWindowLimiter(PLAYER_CREATIONS_PER_IP.limit, PLAYER_CREATIONS_PER_IP.windowMs),
      trustProxy: deps.trustProxy ?? false,
    }),
  );
  app.route("/api/me", meRoutes());
  app.route("/api/binder", binderRoutes(deps.db, deps.expansion));
  const friendDeps = {
    db: deps.db,
    expansion: deps.expansion,
    unknownCodes:
      deps.unknownFriendCodes ??
      new SlidingWindowLimiter(UNKNOWN_FRIEND_CODES.limit, UNKNOWN_FRIEND_CODES.windowMs),
  };
  app.route("/api/friend-requests", friendRequestRoutes(friendDeps));
  app.route("/api/friends", friendRoutes(friendDeps));
  app.route("/api/inbox", inboxRoutes(deps.db));
  app.route("/api/trades", tradeRoutes(deps.db));
  app.route("/cards", cardRoutes(deps.db, logger));

  app.route(
    "/api/captures",
    captureRoutes({
      db: deps.db,
      expansion: deps.expansion,
      identify: deps.identify,
      perPlayer:
        deps.capturesPerPlayer ??
        new SlidingWindowLimiter(CAPTURES_PER_PLAYER.limit, CAPTURES_PER_PLAYER.windowMs),
      ...(deps.random === undefined ? {} : { random: deps.random }),
      dailyCaps: deps.dailyCaps ?? DEFAULT_DAILY_CAPS,
      inFlight: new InFlightLimiter(deps.maxInFlight ?? MAX_IDENTIFICATIONS_IN_FLIGHT),
      uploads: new InFlightLimiter(deps.maxUploads ?? MAX_UPLOADS_IN_FLIGHT),
      logger,
    }),
  );

  if (deps.webRoot !== undefined) {
    const serveWeb = serveStatic({ root: deps.webRoot });
    app.get("*", async (c, next) => {
      // The API and card art have their own routes; never fall through to files for them.
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/cards/")) {
        return next();
      }
      const response = await serveWeb(c, next);
      if (c.res.ok) {
        // Vite fingerprints everything under /assets; the shell must revalidate so a redeploy
        // never leaves it pointing at assets that no longer exist.
        c.header(
          "Cache-Control",
          c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      }
      return response;
    });
  }

  app.notFound((c) => errorJson(c, 404, "not_found", "Not found."));
  app.onError((error, c) => {
    // Error name only: messages can carry request data.
    logger.error({ requestId: c.get("requestId"), event: "unhandled_error", error: error.name });
    return errorJson(c, 500, "internal", "Something went wrong.");
  });

  return app;
}

import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";

import type { Db } from "./db/connection.js";
import { errorJson } from "./errors.js";
import type { StoredExpansion } from "./expansion/repository.js";
import type { Identifier } from "./identify/client.js";
import { InFlightLimiter } from "./inflight.js";
import type { Logger } from "./logger.js";
import { cardRoutes, SVG_CSP } from "./routes/cards.js";
import { captureRoutes } from "./routes/captures.js";
import { expansionRoutes } from "./routes/expansion.js";

export const MAX_IDENTIFICATIONS_IN_FLIGHT = 5;
/** Photos being uploaded at once; bounds upload memory to about 10 × 5 MB (NFR-005). */
export const MAX_UPLOADS_IN_FLIGHT = 10;

export interface AppEnv {
  Variables: { requestId: string };
}

export interface AppDeps {
  db: Db;
  /** The active expansion, loaded from the DB at startup. */
  expansion: StoredExpansion;
  identify: Identifier;
  logger: Logger;
  maxInFlight?: number;
  maxUploads?: number;
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

  app.route("/api/expansion", expansionRoutes(deps.expansion));
  app.route("/cards", cardRoutes(deps.db, logger));

  app.route(
    "/api/captures",
    captureRoutes({
      identify: deps.identify,
      inFlight: new InFlightLimiter(deps.maxInFlight ?? MAX_IDENTIFICATIONS_IN_FLIGHT),
      uploads: new InFlightLimiter(deps.maxUploads ?? MAX_UPLOADS_IN_FLIGHT),
      logger,
    }),
  );

  app.notFound((c) => errorJson(c, 404, "not_found", "Not found."));
  app.onError((error, c) => {
    // Error name only: messages can carry request data.
    logger.error({ requestId: c.get("requestId"), event: "unhandled_error", error: error.name });
    return errorJson(c, 500, "internal", "Something went wrong.");
  });

  return app;
}

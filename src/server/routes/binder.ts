import { Hono } from "hono";

import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import type { StoredExpansion } from "../expansion/repository.js";
import { readBinder } from "../game/binder.js";

/** `GET /api/binder`: the caller's own cards (auth by the default-deny middleware). */
export function binderRoutes(db: Db, expansion: StoredExpansion): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => c.json(readBinder(db, expansion, c.get("player").id)));
  return routes;
}

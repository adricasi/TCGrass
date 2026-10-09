import { readFile } from "node:fs/promises";

import { Hono } from "hono";

import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import { placeholderSvg } from "../expansion/placeholder.js";
import { findCardImage } from "../expansion/repository.js";
import type { Logger } from "../logger.js";

const CACHE_CONTROL = "public, max-age=3600";

/** CSP for the placeholder SVG: no scripts or loads, even if the template ever changes. */
export const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * `GET /cards/:expansionId/:cardId`: card art. The ids are looked up in the DB and the file
 * path comes from that row, never from the URL (design.md § Interfaces).
 */
export function cardRoutes(db: Db, logger: Logger): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/:expansionId/:cardId", async (c) => {
    const expansionId = c.req.param("expansionId");
    const cardId = c.req.param("cardId");
    const card = findCardImage(db, expansionId, cardId);
    if (card === undefined) {
      return errorJson(c, 404, "not_found", "No such card.");
    }
    if (card.isPlaceholder) {
      c.header("Content-Type", "image/svg+xml");
      c.header("Cache-Control", CACHE_CONTROL);
      return c.body(placeholderSvg(card.category));
    }
    const image = await readFile(card.imagePath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (image === undefined) {
      // The ids matched a DB row, so they are catalogue ids and safe to log.
      logger.warn({
        requestId: c.get("requestId"),
        event: "card_image_missing",
        expansionId,
        cardId,
      });
      return errorJson(c, 404, "not_found", "No such card.");
    }
    c.header("Content-Type", "image/png");
    c.header("Cache-Control", CACHE_CONTROL);
    return c.body(image);
  });
  return routes;
}

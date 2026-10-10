import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { createTradeRequestSchema, type SentOffersResponse } from "../../shared/schemas/trades.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import { cancelOffer, createOffer, listSentOffers, TradeError } from "../game/trades.js";

function tradeErrorJson(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof TradeError) {
    return errorJson(c, error.status, error.code, error.message);
  }
  throw error;
}

function sentOffer(db: Db, senderId: number, offerId: number) {
  const [offer] = listSentOffers(db, senderId, offerId);
  if (offer === undefined) {
    throw new Error(`offer ${offerId} vanished`);
  }
  return offer;
}

/** `/api/trades`: create, cancel and list sent offers (REQ-009). Auth by the default-deny middleware. */
export function tradeRoutes(db: Db): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post(
    "/",
    bodyLimit({
      maxSize: 1024,
      onError: (c) => errorJson(c, 413, "body_too_large", "Request body too large."),
    }),
    async (c) => {
      const json: unknown = await c.req.json().catch(() => undefined);
      const request = createTradeRequestSchema.safeParse(json);
      if (!request.success) {
        return errorJson(
          c,
          400,
          "invalid_offer",
          "Send { offeredInstanceId, requestedInstanceId }.",
        );
      }
      const senderId = c.get("player").id;
      try {
        const id = createOffer(
          db,
          senderId,
          request.data.offeredInstanceId,
          request.data.requestedInstanceId,
        );
        return c.json(sentOffer(db, senderId, id), 201);
      } catch (error) {
        return tradeErrorJson(c, error);
      }
    },
  );

  routes.post("/:id/cancel", (c) => {
    const offerId = Number(c.req.param("id"));
    if (!Number.isSafeInteger(offerId) || offerId <= 0) {
      return errorJson(c, 404, "offer_not_found", "No such offer.");
    }
    const senderId = c.get("player").id;
    try {
      cancelOffer(db, senderId, offerId);
      return c.json(sentOffer(db, senderId, offerId));
    } catch (error) {
      return tradeErrorJson(c, error);
    }
  });

  routes.get("/sent", (c) => {
    const body: SentOffersResponse = { offers: listSentOffers(db, c.get("player").id) };
    return c.json(body);
  });

  return routes;
}

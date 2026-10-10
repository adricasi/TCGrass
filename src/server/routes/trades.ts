import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  createTradeRequestSchema,
  type OfferAnswer,
  type SentOffersResponse,
} from "../../shared/schemas/trades.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import {
  acceptOffer,
  cancelOffer,
  createOffer,
  declineOffer,
  listSentOffers,
  TradeError,
} from "../game/trades.js";

/** A positive integer id from the URL, strictly digits (no "0x10", "1e2" or "+5"). */
function parseOfferId(raw: string): number | undefined {
  return /^[1-9]\d{0,15}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
}

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

/**
 * `/api/trades`: create, cancel and list sent offers (REQ-009); accept and decline received
 * ones (REQ-010). Auth by the default-deny middleware.
 */
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
    const offerId = parseOfferId(c.req.param("id"));
    if (offerId === undefined) {
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

  for (const [action, accept] of [
    ["accept", true],
    ["decline", false],
  ] as const) {
    routes.post(`/:id/${action}`, (c) => {
      const offerId = parseOfferId(c.req.param("id"));
      if (offerId === undefined) {
        return errorJson(c, 404, "offer_not_found", "No such offer.");
      }
      const recipientId = c.get("player").id;
      try {
        if (!accept) {
          declineOffer(db, recipientId, offerId);
          const body: OfferAnswer = { id: offerId, status: "declined" };
          return c.json(body);
        }
        if (acceptOffer(db, recipientId, offerId) === "failed") {
          // The failed status is saved; the answer explains why nothing moved (AC-010.5).
          return errorJson(
            c,
            409,
            "offer_failed",
            "One of the cards changed hands, so this offer failed.",
          );
        }
        const body: OfferAnswer = { id: offerId, status: "accepted" };
        return c.json(body);
      } catch (error) {
        return tradeErrorJson(c, error);
      }
    });
  }

  routes.get("/sent", (c) => {
    const body: SentOffersResponse = { offers: listSentOffers(db, c.get("player").id) };
    return c.json(body);
  });

  return routes;
}

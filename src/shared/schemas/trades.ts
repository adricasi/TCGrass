import { z } from "zod";

import { raritySchema } from "./captures.js";
import { publicPlayerSchema } from "./players.js";

const instanceId = z.number().int().positive();

/** Request of `POST /api/trades` (REQ-009). Only ids: the server decides everything else. */
export const createTradeRequestSchema = z
  .object({ offeredInstanceId: instanceId, requestedInstanceId: instanceId })
  .strict();
export type CreateTradeRequest = z.infer<typeof createTradeRequestSchema>;

export const tradeStatusSchema = z.enum(["pending", "accepted", "declined", "cancelled", "failed"]);
export type TradeStatus = z.infer<typeof tradeStatusSchema>;

export const tradeSourceSchema = z.enum(["friend", "daily_pack"]);

/** One side of an offer: a card instance with what the player needs to recognise it. */
export const tradeCardSchema = z
  .object({
    instanceId: z.number().int(),
    cardId: z.string(),
    name: z.string(),
    rarity: raritySchema,
    imageUrl: z.string(),
  })
  .strict();
export type TradeCard = z.infer<typeof tradeCardSchema>;

/** An offer the player sent (AC-009.6). */
export const sentOfferSchema = z
  .object({
    id: z.number().int(),
    status: tradeStatusSchema,
    source: tradeSourceSchema,
    createdAt: z.string(),
    resolvedAt: z.string().nullable(),
    to: publicPlayerSchema,
    offered: tradeCardSchema,
    requested: tradeCardSchema,
  })
  .strict();
export type SentOffer = z.infer<typeof sentOfferSchema>;

export const sentOffersResponseSchema = z.object({ offers: z.array(sentOfferSchema) }).strict();
export type SentOffersResponse = z.infer<typeof sentOffersResponseSchema>;

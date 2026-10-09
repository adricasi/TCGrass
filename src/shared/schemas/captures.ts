import { z } from "zod";

import { RARITIES } from "../expansion.js";

export const raritySchema = z.enum(RARITIES);

/** A minted card as returned by a capture (design.md § Interfaces). */
export const capturedCardSchema = z
  .object({
    id: z.number().int(),
    cardId: z.string(),
    name: z.string(),
    category: z.string(),
    rarity: raritySchema,
    flavorLine: z.string().nullable(),
    imageUrl: z.string(),
  })
  .strict();
export type CapturedCard = z.infer<typeof capturedCardSchema>;

/** Response of `POST /api/captures`: `card` is present only when a card was minted. */
export const captureResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("card"), card: capturedCardSchema }).strict(),
  z.object({ outcome: z.enum(["none", "screen", "retry"]) }).strict(),
]);
export type CaptureResponse = z.infer<typeof captureResponseSchema>;
export type CaptureOutcome = CaptureResponse["outcome"];

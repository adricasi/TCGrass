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

/** A capture refused because the player captured this card recently (AC-014.1). */
export const captureCooldownSchema = z
  .object({
    cardId: z.string(),
    name: z.string(),
    /** When the player can capture this card again (ISO 8601, UTC). */
    availableAt: z.iso.datetime(),
  })
  .strict();
export type CaptureCooldown = z.infer<typeof captureCooldownSchema>;

/**
 * Response of `POST /api/captures`: `card` is present only when a card was minted, `cooldown`
 * only when the card is on cooldown.
 */
export const captureResponseSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("card"), card: capturedCardSchema }).strict(),
  z.object({ outcome: z.literal("cooldown"), cooldown: captureCooldownSchema }).strict(),
  z.object({ outcome: z.enum(["none", "screen", "retry"]) }).strict(),
]);
export type CaptureResponse = z.infer<typeof captureResponseSchema>;
export type CaptureOutcome = CaptureResponse["outcome"];

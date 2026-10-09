import { z } from "zod";

import { raritySchema } from "./captures.js";

const rarityCountsSchema = z
  .object({
    common: z.number().int().nonnegative(),
    rare: z.number().int().nonnegative(),
    epic: z.number().int().nonnegative(),
    legendary: z.number().int().nonnegative(),
  })
  .strict();

export const binderInstanceSchema = z
  .object({
    id: z.number().int(),
    rarity: raritySchema,
    capturedAt: z.string(),
    /** True while this instance is the offered card of a pending offer (AC-007.2). */
    locked: z.boolean(),
    flavorLine: z.string().nullable(),
  })
  .strict();
export type BinderInstance = z.infer<typeof binderInstanceSchema>;

export const binderCardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
    imageUrl: z.string(),
    owned: z.boolean(),
    counts: rarityCountsSchema,
    /** Newest first; empty for a missing card. */
    instances: z.array(binderInstanceSchema),
  })
  .strict();
export type BinderCard = z.infer<typeof binderCardSchema>;

/** Response of `GET /api/binder`: every catalogue card, in file order (REQ-007). */
export const binderResponseSchema = z
  .object({
    /** Distinct catalogue cards the player owns (AC-007.3). */
    owned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    cards: z.array(binderCardSchema),
  })
  .strict();
export type BinderResponse = z.infer<typeof binderResponseSchema>;

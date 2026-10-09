import { z } from "zod";

export const rarityOddsResponseSchema = z
  .object({
    common: z.number().int(),
    rare: z.number().int(),
    epic: z.number().int(),
    legendary: z.number().int(),
  })
  .strict();

/** Response of `GET /api/expansion`: the active expansion's cards, art URLs and odds. */
export const expansionResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    rarityOdds: rarityOddsResponseSchema,
    cards: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          category: z.string(),
          imageUrl: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type ExpansionResponse = z.infer<typeof expansionResponseSchema>;

export function cardImageUrl(expansionId: string, cardId: string): string {
  return `/cards/${encodeURIComponent(expansionId)}/${encodeURIComponent(cardId)}`;
}

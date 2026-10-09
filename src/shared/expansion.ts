import { z } from "zod";

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

const CARD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const requiredText = z.string().trim().min(1, "must not be empty");

const oddsValue = z.number().int("must be an integer").nonnegative("must not be negative");

export const rarityOddsSchema = z
  .object({
    common: oddsValue,
    rare: oddsValue,
    epic: oddsValue,
    legendary: oddsValue,
  })
  .refine((odds) => odds.common + odds.rare + odds.epic + odds.legendary === 100, {
    message: "rarity odds must sum to exactly 100",
  });

export const catalogueCardSchema = z.object({
  id: z
    .string()
    .regex(CARD_ID_PATTERN, "must be lowercase letters, digits and hyphens")
    // "none" and "screen" are identification outcomes, so they can't be card ids.
    .refine((id) => id !== "none" && id !== "screen", "is reserved"),
  name: requiredText,
  category: requiredText,
  identify_hint: requiredText,
  art_prompt: requiredText,
});
export type CatalogueCard = z.infer<typeof catalogueCardSchema>;

export const expansionSchema = z
  .object({
    id: z.string().regex(CARD_ID_PATTERN, "must be lowercase letters, digits and hyphens"),
    name: requiredText,
    version: requiredText,
    license: z.object({ data: requiredText, images: requiredText }),
    rarity_odds: rarityOddsSchema,
    style_prompt: requiredText,
    identification: z.object({ instructions: requiredText }),
    cards: z.array(catalogueCardSchema).min(1, "must contain at least one card"),
  })
  .superRefine((expansion, ctx) => {
    const seen = new Set<string>();
    expansion.cards.forEach((card, index) => {
      if (seen.has(card.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cards", index, "id"],
          message: `duplicate card id "${card.id}"`,
        });
      }
      seen.add(card.id);
    });
  });
export type Expansion = z.infer<typeof expansionSchema>;

import { z } from "zod";

/** Card and expansion ids: lowercase letters, digits and hyphens (AC-001.3). */
export const ID_PATTERN = /^[a-z0-9-]+$/;

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export const RaritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof RaritySchema>;

const requiredText = z.string().trim().min(1, "must not be empty");

const oddsValue = z
  .number({ error: "must be a number" })
  .int("must be an integer")
  .nonnegative("must not be negative");

export const RarityOddsSchema = z
  .object({
    common: oddsValue,
    rare: oddsValue,
    epic: oddsValue,
    legendary: oddsValue,
  })
  .refine((o) => o.common + o.rare + o.epic + o.legendary === 100, {
    message: "must sum to exactly 100",
  });
export type RarityOdds = z.infer<typeof RarityOddsSchema>;

export const CatalogueCardSchema = z.object({
  id: z.string().regex(ID_PATTERN, "must be lowercase letters, digits and hyphens"),
  name: requiredText,
  category: requiredText,
  identify_hint: requiredText,
  art_prompt: requiredText,
});
export type CatalogueCardFile = z.infer<typeof CatalogueCardSchema>;

/** `expansions/<id>/expansion.yaml` (design.md "Expansion file"). */
export const ExpansionFileSchema = z
  .object({
    id: z.string().regex(ID_PATTERN, "must be lowercase letters, digits and hyphens"),
    name: requiredText,
    version: requiredText,
    license: z.object({ data: requiredText, images: requiredText }),
    rarity_odds: RarityOddsSchema,
    style_prompt: requiredText,
    identification: z.object({ instructions: requiredText }),
    cards: z.array(CatalogueCardSchema).min(1, "must list at least one card"),
  })
  .superRefine((exp, ctx) => {
    const seen = new Set<string>();
    exp.cards.forEach((card, index) => {
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
export type ExpansionFile = z.infer<typeof ExpansionFileSchema>;

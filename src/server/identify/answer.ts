import { z } from "zod";

export const NO_MATCH = "none";

/**
 * Schema for the model's identification answer. The model output is untrusted, so
 * `card_id` is restricted to the given catalogue ids (AC-003.8).
 */
export function modelAnswerSchema(catalogueIds: readonly string[]) {
  return z.object({
    card_id: z.enum([NO_MATCH, ...catalogueIds]),
    confidence: z.number().min(0).max(1),
    is_photo_of_screen: z.boolean(),
    // Missing or empty flavor lines are allowed: the reveal is shown without one (AC-006.3).
    flavor_line: z.string().nullish(),
  });
}
export type ModelAnswer = z.infer<ReturnType<typeof modelAnswerSchema>>;

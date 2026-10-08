import { z } from "zod";

/**
 * The JSON answer the model must return (design.md "Identification call").
 * Model output is untrusted: it is validated against this schema and the catalogue ids.
 */
export const ModelAnswerSchema = z.object({
  card_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  is_photo_of_screen: z.boolean(),
  flavor_line: z.string(),
});
export type ModelAnswer = z.infer<typeof ModelAnswerSchema>;

export const CAPTURE_OUTCOMES = ["card", "none", "screen", "retry"] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

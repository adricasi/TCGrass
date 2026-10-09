import { z } from "zod";

export const captureOutcomeSchema = z.enum(["card", "none", "screen", "retry"]);
export type CaptureOutcome = z.infer<typeof captureOutcomeSchema>;

/**
 * Response of `POST /api/captures`. Temporary T-002a shape: there is no DB yet, so a match
 * returns only the catalogue `cardId`. T-005 replaces it with the minted `card` object from
 * design.md § Interfaces.
 */
export const captureResponseSchema = z
  .object({
    outcome: captureOutcomeSchema,
    cardId: z.string().optional(),
  })
  .strict();
export type CaptureResponse = z.infer<typeof captureResponseSchema>;

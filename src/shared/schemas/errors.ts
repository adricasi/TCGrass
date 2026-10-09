import { z } from "zod";

/** Error body of every non-2xx API response (design.md § Interfaces). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

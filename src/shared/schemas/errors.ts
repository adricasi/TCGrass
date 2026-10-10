import { z } from "zod";

/** Error body of every non-2xx API response (design.md § Interfaces). */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** For `daily_limit`: when captures resume (ISO, UTC midnight), shown in local time. */
    resumesAt: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

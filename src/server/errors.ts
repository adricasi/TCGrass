import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ErrorResponse } from "../shared/schemas/errors.js";

/** Sends the design's error body `{ error: { code, message } }`. */
export function errorJson(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  extra: { resumesAt?: string } = {},
): Response {
  const body: ErrorResponse = { error: { code, message, ...extra } };
  return c.json(body, status);
}

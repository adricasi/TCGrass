import type { z } from "zod";

import { type BinderResponse, binderResponseSchema } from "../../src/shared/schemas/binder.js";
import { type CaptureResponse, captureResponseSchema } from "../../src/shared/schemas/captures.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import {
  type ExpansionResponse,
  expansionResponseSchema,
} from "../../src/shared/schemas/expansion.js";
import {
  type CreatePlayerResponse,
  createPlayerResponseSchema,
  type MeResponse,
  meResponseSchema,
} from "../../src/shared/schemas/players.js";

export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function authHeader(secret: string): Record<string, string> {
  // Header only, never in a URL (NFR-001).
  return { authorization: `Bearer ${secret}` };
}

async function request<T extends z.ZodType>(
  path: string,
  init: RequestInit,
  schema: T,
): Promise<z.output<T>> {
  const response = await fetch(path, init);
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(json);
    throw error.success
      ? new ApiError(response.status, error.data.error.code, error.data.error.message)
      : new ApiError(response.status, "unknown", "Something went wrong. Try again.");
  }
  return schema.parse(json);
}

/** `POST /api/players`: the response is the only time the secret is sent (AC-002.10). */
export function createPlayer(displayName: string): Promise<CreatePlayerResponse> {
  return request(
    "/api/players",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    },
    createPlayerResponseSchema,
  );
}

/** `GET /api/me`. */
export function getMe(secret: string): Promise<MeResponse> {
  return request("/api/me", { headers: authHeader(secret) }, meResponseSchema);
}

/** `POST /api/captures`: sends a photo for identification. */
export function postCapture(secret: string, photo: Blob): Promise<CaptureResponse> {
  const body = new FormData();
  body.append("photo", photo, "photo.jpg");
  return request(
    "/api/captures",
    { method: "POST", headers: authHeader(secret), body },
    captureResponseSchema,
  );
}

/** `GET /api/binder`: the player's cards for the active expansion. */
export function getBinder(secret: string): Promise<BinderResponse> {
  return request("/api/binder", { headers: authHeader(secret) }, binderResponseSchema);
}

/** `GET /api/expansion` (public): cards and odds of the active expansion. */
export function getExpansion(): Promise<ExpansionResponse> {
  return request("/api/expansion", {}, expansionResponseSchema);
}

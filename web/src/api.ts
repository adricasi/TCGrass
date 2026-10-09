import { type CaptureResponse, captureResponseSchema } from "../../src/shared/schemas/captures.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";

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

/** Sends a photo for identification (`POST /api/captures`). */
export async function postCapture(photo: Blob): Promise<CaptureResponse> {
  const body = new FormData();
  body.append("photo", photo, "photo.jpg");
  const response = await fetch("/api/captures", { method: "POST", body });
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(json);
    throw error.success
      ? new ApiError(response.status, error.data.error.code, error.data.error.message)
      : new ApiError(response.status, "unknown", "Something went wrong. Try again.");
  }
  return captureResponseSchema.parse(json);
}

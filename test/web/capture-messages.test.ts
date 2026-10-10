import { describe, expect, it } from "vitest";

import { ApiError } from "../../web/src/api.js";
import { describeCaptureError } from "../../web/src/capture-messages.js";

describe("describeCaptureError", () => {
  it("AC-003.13 says when captures resume, in the player's local time", () => {
    const error = new ApiError(
      503,
      "daily_limit",
      "You've used today's captures. They come back at midnight UTC.",
      "2026-10-11T00:00:00.000Z",
    );
    expect(describeCaptureError(error, "en-GB", "Europe/Madrid")).toBe(
      "Today's captures are used up. They come back at 02:00.",
    );
    expect(describeCaptureError(error, "en-GB", "America/Los_Angeles")).toBe(
      "Today's captures are used up. They come back at 17:00.",
    );
  });

  it("AC-003.13 falls back to the server's message when no resume time is given", () => {
    expect(describeCaptureError(new ApiError(503, "daily_limit", "Paused for today."))).toBe(
      "Paused for today.",
    );
  });

  it("AC-003.12 shows the server's message for busy, rate-limited and invalid photos", () => {
    expect(describeCaptureError(new ApiError(503, "busy", "Too many captures right now."))).toBe(
      "Too many captures right now.",
    );
    expect(describeCaptureError(new ApiError(429, "rate_limited", "Wait a minute."))).toBe(
      "Wait a minute.",
    );
  });

  it("falls back to a generic message for anything else", () => {
    expect(describeCaptureError(new TypeError("offline"))).toBe("Something went wrong. Try again.");
  });
});

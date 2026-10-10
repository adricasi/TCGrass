import type { CaptureCooldown } from "../../src/shared/schemas/captures.js";
import { ApiError } from "./api.js";

/** After this long, "Looking…" becomes a longer note, since captures can take ~10–30 s (NFR-004). */
export const SLOW_CAPTURE_MS = 4000;

export const SLOW_CAPTURE_TEXT = "Identifying… this can take up to 30 seconds";

/**
 * The message for a card on cooldown (AC-014.1), with the time in the player's own time zone,
 * and the day too when it isn't today there.
 */
export function describeCooldown(
  cooldown: CaptureCooldown,
  now = new Date(),
  locale?: string,
  timeZone?: string,
): string {
  const zone = timeZone === undefined ? {} : { timeZone };
  const availableAt = new Date(cooldown.availableAt);
  const time = availableAt.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...zone,
  });
  const sameDay =
    availableAt.toLocaleDateString(locale, zone) === now.toLocaleDateString(locale, zone);
  const day = sameDay
    ? ""
    : `${availableAt.toLocaleDateString(locale, { weekday: "short", ...zone })} `;
  return `Already found: ${cooldown.name}. Next one from ${day}${time}.`;
}

/**
 * The message for a failed capture. For a daily limit the client writes the text itself, with
 * the resume time in the player's own time zone (AC-003.13), so it doesn't depend on the
 * server's wording.
 */
export function describeCaptureError(error: unknown, locale?: string, timeZone?: string): string {
  if (error instanceof ApiError && error.code === "daily_limit") {
    if (error.resumesAt === undefined) {
      return error.message;
    }
    const time = new Date(error.resumesAt).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone === undefined ? {} : { timeZone }),
    });
    return `Today's captures are used up. They come back at ${time}.`;
  }
  // Server messages for these codes are written for players (design § Interfaces).
  if (error instanceof ApiError && [413, 415, 429, 503].includes(error.status)) {
    return error.message;
  }
  return "Something went wrong. Try again.";
}

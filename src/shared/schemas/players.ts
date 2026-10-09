import { z } from "zod";

export const DISPLAY_NAME_MAX = 20;
export const DISPLAY_NAME_RULE = `Your name must be 1 to ${DISPLAY_NAME_MAX} characters, with no control characters.`;

/**
 * Characters a name must not contain, since other players see it (AC-002.4): control and
 * format characters (bidi overrides, zero-width, tags…), line/paragraph separators, private
 * use and unassigned code points. ZWJ (U+200D) is the one format character allowed, so emoji
 * sequences such as 👩‍💻 still work.
 */
const FORBIDDEN_IN_NAME = /[\p{Cc}\p{Zl}\p{Zp}\p{Co}\p{Cn}]|(?!\u200D)\p{Cf}/u;

/** Display name rule (AC-002.4), shared so the PWA explains it before the server rejects it. */
export const displayNameSchema = z
  .string()
  .transform((name) => name.normalize("NFC").trim())
  .refine((name) => {
    const length = Array.from(name).length;
    return length >= 1 && length <= DISPLAY_NAME_MAX && !FORBIDDEN_IN_NAME.test(name);
  }, DISPLAY_NAME_RULE);

export const createPlayerRequestSchema = z.object({ displayName: displayNameSchema }).strict();
export type CreatePlayerRequest = z.input<typeof createPlayerRequestSchema>;

export const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FRIEND_CODE_LENGTH = 8;
export const friendCodeSchema = z
  .string()
  .regex(new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_LENGTH}}$`));

/** What any player may see about a player: name and friend code only (AC-002.6). */
export const publicPlayerSchema = z
  .object({ displayName: z.string(), friendCode: friendCodeSchema })
  .strict();
export type PublicPlayer = z.infer<typeof publicPlayerSchema>;

/** Response of `POST /api/players`: the only time the secret is ever sent (AC-002.10). */
export const createPlayerResponseSchema = publicPlayerSchema
  .extend({ secret: z.string() })
  .strict();
export type CreatePlayerResponse = z.infer<typeof createPlayerResponseSchema>;

/** Response of `GET /api/me`. */
export const meResponseSchema = publicPlayerSchema;
export type MeResponse = PublicPlayer;

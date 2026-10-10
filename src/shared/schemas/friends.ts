import { z } from "zod";

import { binderResponseSchema } from "./binder.js";
import { friendCodeSchema, publicPlayerSchema } from "./players.js";

/** What a player types: trimmed and upper-cased before matching (AC-008.2). */
export function normalizeFriendCode(input: string): string {
  return input.trim().toUpperCase();
}

export const sendFriendRequestSchema = z
  .object({ friendCode: z.string().max(64).transform(normalizeFriendCode).pipe(friendCodeSchema) })
  .strict();

export const friendRequestStatusSchema = z.enum(["pending", "accepted", "declined"]);

/** A received pending request, as listed in the inbox (AC-008.6). */
export const incomingFriendRequestSchema = z
  .object({
    id: z.number().int(),
    from: publicPlayerSchema,
    createdAt: z.string(),
  })
  .strict();
export type IncomingFriendRequest = z.infer<typeof incomingFriendRequestSchema>;

/** Response of sending, accepting or declining a request. */
export const friendRequestResultSchema = z
  .object({
    id: z.number().int(),
    status: friendRequestStatusSchema,
    /** The other player: the recipient when sending, the sender when responding. */
    player: publicPlayerSchema,
  })
  .strict();
export type FriendRequestResult = z.infer<typeof friendRequestResultSchema>;

export const friendSchema = publicPlayerSchema.extend({ since: z.string() }).strict();
export type Friend = z.infer<typeof friendSchema>;

export const friendsResponseSchema = z.object({ friends: z.array(friendSchema) }).strict();
export type FriendsResponse = z.infer<typeof friendsResponseSchema>;

/**
 * Response of `GET /api/friends/:friendCode/binder` (AC-008.5). Same binder shape as the
 * player's own; `locked` instances are unavailable and cannot be requested (A-8).
 */
export const friendBinderResponseSchema = z
  .object({ friend: publicPlayerSchema, binder: binderResponseSchema })
  .strict();
export type FriendBinderResponse = z.infer<typeof friendBinderResponseSchema>;

/** Response of `GET /api/inbox`. Trade offers are added by T-008 (REQ-010). */
export const inboxResponseSchema = z
  .object({
    friendRequests: z.array(incomingFriendRequestSchema),
    tradeOffers: z.array(z.never()),
    counts: z
      .object({
        friendRequests: z.number().int().nonnegative(),
        tradeOffers: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type InboxResponse = z.infer<typeof inboxResponseSchema>;

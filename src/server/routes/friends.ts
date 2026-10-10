import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  type FriendBinderResponse,
  type FriendsResponse,
  normalizeFriendCode,
  sendFriendRequestSchema,
} from "../../shared/schemas/friends.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { errorJson } from "../errors.js";
import type { StoredExpansion } from "../expansion/repository.js";
import { readBinder } from "../game/binder.js";
import {
  areFriends,
  findPlayerByFriendCode,
  FriendError,
  listFriends,
  respondToFriendRequest,
  sendFriendRequest,
} from "../game/friends.js";
import type { SlidingWindowLimiter } from "../rate-limit.js";

/** Unknown friend codes per player: 10 per 10 minutes (AC-008.4). */
export const UNKNOWN_FRIEND_CODES = { limit: 10, windowMs: 10 * 60 * 1000 };

export interface FriendRouteDeps {
  db: Db;
  expansion: StoredExpansion;
  unknownCodes: SlidingWindowLimiter;
}

function friendErrorJson(c: Context<AppEnv>, error: unknown): Response {
  if (error instanceof FriendError) {
    return errorJson(c, error.status, error.code, error.message);
  }
  throw error;
}

const limitedBody = bodyLimit({
  maxSize: 1024,
  onError: (c) => errorJson(c, 413, "body_too_large", "Request body too large."),
});

/** `/api/friend-requests`: send, accept, decline (REQ-008). Auth by the default-deny middleware. */
export function friendRequestRoutes({ db, unknownCodes }: FriendRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post("/", limitedBody, async (c) => {
    const player = c.get("player");
    const key = String(player.id);
    // Once the allowance is used up, every attempt is refused until the window passes, so
    // valid codes cannot be probed either (AC-008.4).
    if (unknownCodes.blocked(key)) {
      return errorJson(
        c,
        429,
        "rate_limited",
        "Too many unknown codes. Try again in a few minutes.",
      );
    }
    const json: unknown = await c.req.json().catch(() => undefined);
    const request = sendFriendRequestSchema.safeParse(json);
    if (!request.success) {
      // Malformed codes can't belong to anyone, so they are not looked up or counted.
      return errorJson(c, 400, "invalid_friend_code", "Friend codes are 8 letters and digits.");
    }
    // Checked again after the await: requests already in flight must not slip past the limit.
    // From here to the hit below the code is synchronous, so the check cannot race.
    if (unknownCodes.blocked(key)) {
      return errorJson(
        c,
        429,
        "rate_limited",
        "Too many unknown codes. Try again in a few minutes.",
      );
    }
    try {
      return c.json(sendFriendRequest(db, player.id, request.data.friendCode), 201);
    } catch (error) {
      if (error instanceof FriendError && error.code === "player_not_found") {
        unknownCodes.tryHit(key);
      }
      return friendErrorJson(c, error);
    }
  });

  for (const [action, accept] of [
    ["accept", true],
    ["decline", false],
  ] as const) {
    routes.post(`/:id/${action}`, (c) => {
      const requestId = Number(c.req.param("id"));
      if (!Number.isSafeInteger(requestId) || requestId <= 0) {
        return errorJson(c, 404, "request_not_found", "No such friend request.");
      }
      try {
        return c.json(respondToFriendRequest(db, c.get("player").id, requestId, accept));
      } catch (error) {
        return friendErrorJson(c, error);
      }
    });
  }

  return routes;
}

/** `/api/friends`: the friends list and a friend's binder (AC-008.5, AC-008.9). */
export function friendRoutes({ db, expansion }: FriendRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get("/", (c) => {
    const body: FriendsResponse = { friends: listFriends(db, c.get("player").id) };
    return c.json(body);
  });

  routes.get("/:friendCode/binder", (c) => {
    const player = c.get("player");
    const friend = findPlayerByFriendCode(db, normalizeFriendCode(c.req.param("friendCode")));
    // Same answer for "no such player" and "not (yet) friends", so this cannot be used to
    // look up who exists, and a pending request shows nothing (AC-008.9).
    if (friend === undefined || !areFriends(db, player.id, friend.id)) {
      return errorJson(c, 404, "not_friends", "Not one of your friends.");
    }
    const body: FriendBinderResponse = {
      friend: { displayName: friend.display_name, friendCode: friend.friend_code },
      binder: readBinder(db, expansion, friend.id),
    };
    return c.json(body);
  });

  return routes;
}

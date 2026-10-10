import { Hono } from "hono";

import type { InboxResponse } from "../../shared/schemas/friends.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { incomingFriendRequests } from "../game/friends.js";
import { incomingOffers } from "../game/trades.js";

/** `GET /api/inbox`: friend requests and trade offers waiting for the player (AC-008.6, AC-010.2). */
export function inboxRoutes(db: Db): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => {
    const playerId = c.get("player").id;
    const friendRequests = incomingFriendRequests(db, playerId);
    const tradeOffers = incomingOffers(db, playerId);
    const body: InboxResponse = {
      friendRequests,
      tradeOffers,
      counts: {
        friendRequests: friendRequests.length,
        tradeOffers: tradeOffers.length,
        total: friendRequests.length + tradeOffers.length,
      },
    };
    return c.json(body);
  });
  return routes;
}

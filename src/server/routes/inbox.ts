import { Hono } from "hono";

import type { InboxResponse } from "../../shared/schemas/friends.js";
import type { AppEnv } from "../app.js";
import type { Db } from "../db/connection.js";
import { incomingFriendRequests } from "../game/friends.js";

/** `GET /api/inbox`: what waits for the player's answer (AC-008.6; trade offers in T-008). */
export function inboxRoutes(db: Db): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => {
    const friendRequests = incomingFriendRequests(db, c.get("player").id);
    const body: InboxResponse = {
      friendRequests,
      tradeOffers: [],
      counts: {
        friendRequests: friendRequests.length,
        tradeOffers: 0,
        total: friendRequests.length,
      },
    };
    return c.json(body);
  });
  return routes;
}

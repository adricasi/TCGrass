import { Hono } from "hono";

import { cardImageUrl, type ExpansionResponse } from "../../shared/schemas/expansion.js";
import type { AppEnv } from "../app.js";
import type { StoredExpansion } from "../expansion/repository.js";

/** `GET /api/expansion` (public): the active expansion with odds as loaded (AC-005.4). */
export function expansionRoutes(active: StoredExpansion): Hono<AppEnv> {
  const { expansion, cards } = active;
  const body: ExpansionResponse = {
    id: expansion.id,
    name: expansion.name,
    version: expansion.version,
    rarityOdds: expansion.rarity_odds,
    cards: cards.map((card) => ({
      id: card.id,
      name: card.name,
      category: card.category,
      imageUrl: cardImageUrl(expansion.id, card.id),
    })),
  };
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => c.json(body));
  return routes;
}

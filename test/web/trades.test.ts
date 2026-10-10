import { afterEach, describe, expect, it, vi } from "vitest";

import type { BinderResponse } from "../../src/shared/schemas/binder.js";
import { cancelTradeOffer, createTradeOffer, getSentOffers } from "../../web/src/api.js";
import { offerableCards, tradeStatusLabel } from "../../web/src/trade-view.js";

const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
const binder: BinderResponse = {
  owned: 2,
  total: 3,
  cards: [
    {
      id: "oak",
      name: "Oak",
      category: "tree",
      imageUrl: "/cards/x/oak",
      owned: true,
      counts,
      instances: [
        { id: 1, rarity: "common", capturedAt: "t", locked: false, flavorLine: null },
        { id: 2, rarity: "epic", capturedAt: "t", locked: true, flavorLine: null },
      ],
    },
    {
      id: "rose",
      name: "Rose",
      category: "flower",
      imageUrl: "/cards/x/rose",
      owned: false,
      counts,
      instances: [],
    },
    {
      id: "fox",
      name: "Fox",
      category: "animal",
      imageUrl: "/cards/x/fox",
      owned: true,
      counts,
      instances: [{ id: 3, rarity: "legendary", capturedAt: "t", locked: false, flavorLine: null }],
    },
  ],
};

const sentOffer = {
  id: 9,
  status: "pending",
  source: "friend",
  createdAt: "t",
  resolvedAt: null,
  to: { displayName: "Bob", friendCode: "ABCD2345" },
  offered: {
    instanceId: 1,
    cardId: "oak",
    name: "Oak",
    rarity: "common",
    imageUrl: "/cards/x/oak",
  },
  requested: {
    instanceId: 5,
    cardId: "fox",
    name: "Fox",
    rarity: "epic",
    imageUrl: "/cards/x/fox",
  },
};

function stubFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("trade picker", () => {
  it("AC-009.2 offers only my cards that are not locked in a pending offer, rarest first", () => {
    expect(offerableCards(binder).map((card) => [card.instanceId, card.rarity])).toEqual([
      [3, "legendary"],
      [1, "common"],
    ]);
  });

  it("AC-009.6 labels every offer status for the sent list", () => {
    expect(
      ["pending", "accepted", "declined", "cancelled", "failed"].map((status) =>
        tradeStatusLabel(status as never),
      ),
    ).toEqual([
      "Waiting for an answer",
      "Accepted",
      "Declined",
      "Cancelled",
      "Failed: a card changed hands",
    ]);
  });
});

describe("trades API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-009.1 sends only the two instance ids, with the secret header", async () => {
    const fetch = stubFetch(Response.json(sentOffer, { status: 201 }));
    await expect(
      createTradeOffer("s3cret", { offeredInstanceId: 1, requestedInstanceId: 5 }),
    ).resolves.toEqual(sentOffer);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/trades");
    expect(init?.body).toBe(JSON.stringify({ offeredInstanceId: 1, requestedInstanceId: 5 }));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
  });

  it("AC-009.5 cancels through the offer's own URL", async () => {
    const fetch = stubFetch(Response.json({ ...sentOffer, status: "cancelled", resolvedAt: "t2" }));
    await cancelTradeOffer("s3cret", 9);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/trades/9/cancel");
  });

  it("AC-009.6 reads the sent offers", async () => {
    stubFetch(Response.json({ offers: [sentOffer] }));
    await expect(getSentOffers("s3cret")).resolves.toEqual({ offers: [sentOffer] });
  });
});

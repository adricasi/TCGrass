import { describe, expect, it } from "vitest";

import { respondToFriendRequest, sendFriendRequest } from "../../src/server/game/friends.js";
import { mintCard } from "../../src/server/game/mint.js";
import { createOffer } from "../../src/server/game/trades.js";
import { createPlayer, type CreatedPlayer } from "../../src/server/players/service.js";
import type { Rarity } from "../../src/shared/expansion.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import { inboxResponseSchema } from "../../src/shared/schemas/friends.js";
import { offerAnswerSchema } from "../../src/shared/schemas/trades.js";
import { fakeIdentifier, testApp, type TestApp } from "./helpers.js";

interface World {
  t: TestApp;
  ada: CreatedPlayer;
  bob: CreatedPlayer;
  cy: CreatedPlayer;
  mint: (owner: CreatedPlayer, cardId: string, rarity?: Rarity) => number;
  offer: (from: CreatedPlayer, offered: number, requested: number) => number;
}

/** Ada, Bob and Cy are all friends. */
function world(): World {
  const t = testApp(fakeIdentifier({ outcome: "screen" }).identify);
  const ada = createPlayer(t.db, "Ada");
  const bob = createPlayer(t.db, "Bob");
  const cy = createPlayer(t.db, "Cy");
  for (const [a, b] of [
    [ada, bob],
    [ada, cy],
    [bob, cy],
  ] as const) {
    respondToFriendRequest(t.db, b.id, sendFriendRequest(t.db, a.id, b.friendCode).id, true);
  }
  return {
    t,
    ada,
    bob,
    cy,
    mint: (owner, cardId, rarity = "common") =>
      mintCard(t.db, {
        ownerId: owner.id,
        expansionId: "fixture-a",
        cardId,
        rarity,
        flavorLine: null,
      }).id,
    offer: (from, offered, requested) => createOffer(t.db, from.id, offered, requested),
  };
}

function as(player: CreatedPlayer): Record<string, string> {
  return { authorization: `Bearer ${player.secret}` };
}

function answer(
  w: World,
  by: CreatedPlayer,
  id: number | string,
  action: "accept" | "decline" | "cancel",
) {
  return Promise.resolve(
    w.t.app.request(`/api/trades/${id}/${action}`, { method: "POST", headers: as(by) }),
  );
}

function ownerOf(w: World, instanceId: number): number {
  return (
    w.t.db.prepare("SELECT owner_id FROM card_instances WHERE id = ?").get(instanceId) as {
      owner_id: number;
    }
  ).owner_id;
}

function statusOf(w: World, offerId: number): string {
  return (
    w.t.db.prepare("SELECT status FROM trade_offers WHERE id = ?").get(offerId) as {
      status: string;
    }
  ).status;
}

function locked(w: World, instanceId: number): boolean {
  return (
    w.t.db
      .prepare("SELECT 1 FROM trade_offers WHERE offered_instance_id = ? AND status = 'pending'")
      .get(instanceId) !== undefined
  );
}

async function errorOf(response: Response) {
  return errorResponseSchema.parse(await response.json()).error;
}

describe("inbox trade offers", () => {
  it("AC-010.2 lists received pending offers with both cards, rarity and the sender's name", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak", "epic");
    const bobFox = w.mint(w.bob, "fox", "rare");
    const id = w.offer(w.ada, adaOak, bobFox);
    // Not listed: Bob's own sent offer, and a resolved offer to Bob.
    w.offer(w.bob, w.mint(w.bob, "rose"), w.mint(w.cy, "rose"));
    const cancelled = w.offer(w.cy, w.mint(w.cy, "oak"), w.mint(w.bob, "oak"));
    await answer(w, w.cy, cancelled, "cancel");

    const inbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.bob) })).json(),
    );
    expect(inbox.tradeOffers).toEqual([
      {
        id,
        createdAt: expect.any(String) as string,
        from: { displayName: "Ada", friendCode: w.ada.friendCode },
        offered: {
          instanceId: adaOak,
          cardId: "oak",
          name: "Oak",
          rarity: "epic",
          imageUrl: "/cards/fixture-a/oak",
        },
        requested: {
          instanceId: bobFox,
          cardId: "fox",
          name: "Fox",
          rarity: "rare",
          imageUrl: "/cards/fixture-a/fox",
        },
      },
    ]);
  });

  it("AC-010.1 counts received pending offers and friend requests for the badge", async () => {
    const w = world();
    w.offer(w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"));
    w.offer(w.cy, w.mint(w.cy, "oak"), w.mint(w.bob, "rose"));
    const dee = createPlayer(w.t.db, "Dee");
    sendFriendRequest(w.t.db, dee.id, w.bob.friendCode);
    const inbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.bob) })).json(),
    );
    expect(inbox.counts).toEqual({ friendRequests: 1, tradeOffers: 2, total: 3 });
  });
});

describe("accepting", () => {
  it("AC-010.3 swaps both owners, marks the offer accepted and unlocks the card", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const id = w.offer(w.ada, adaOak, bobFox);

    const response = await answer(w, w.bob, id, "accept");
    expect(response.status).toBe(200);
    expect(offerAnswerSchema.parse(await response.json())).toEqual({ id, status: "accepted" });
    expect(ownerOf(w, adaOak)).toBe(w.bob.id);
    expect(ownerOf(w, bobFox)).toBe(w.ada.id);
    expect(statusOf(w, id)).toBe("accepted");
    expect(locked(w, adaOak)).toBe(false);
  });

  it("AC-010.4 fails every other pending offer that involves either card and unlocks their cards", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const cyRose = w.mint(w.cy, "rose");
    const cyOak = w.mint(w.cy, "oak");
    const accepted = w.offer(w.ada, adaOak, bobFox);
    const wantsBobFox = w.offer(w.cy, cyRose, bobFox); // requests the same card
    // Only offered cards are locked, so Bob can still offer the fox that Ada requested.
    const bobOffersFox = w.offer(w.bob, bobFox, cyOak);
    const unrelated = w.offer(w.cy, cyOak, w.mint(w.ada, "rose"));

    await answer(w, w.bob, accepted, "accept");
    expect(statusOf(w, wantsBobFox)).toBe("failed");
    expect(statusOf(w, bobOffersFox)).toBe("failed");
    expect(locked(w, cyRose)).toBe(false);
    expect(locked(w, bobFox)).toBe(false);
    expect(statusOf(w, unrelated)).toBe("pending");
  });

  it("AC-010.5 fails the offer and moves nothing if a card changed hands meanwhile", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const id = w.offer(w.ada, adaOak, bobFox);
    // Bob's fox changes hands outside this offer (a direct write stands in for any other path).
    w.t.db.prepare("UPDATE card_instances SET owner_id = ? WHERE id = ?").run(w.cy.id, bobFox);

    const response = await answer(w, w.bob, id, "accept");
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("offer_failed");
    expect(statusOf(w, id)).toBe("failed");
    expect(ownerOf(w, adaOak)).toBe(w.ada.id);
    expect(ownerOf(w, bobFox)).toBe(w.cy.id);
  });
});

describe("declining and guards", () => {
  it("AC-010.6 declining sets the offer declined and unlocks the offered card", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const id = w.offer(w.ada, adaOak, bobFox);
    const response = await answer(w, w.bob, id, "decline");
    expect(offerAnswerSchema.parse(await response.json())).toEqual({ id, status: "declined" });
    expect(locked(w, adaOak)).toBe(false);
    expect(ownerOf(w, adaOak)).toBe(w.ada.id);
    expect(ownerOf(w, bobFox)).toBe(w.bob.id);
  });

  it("AC-009.8 a declined offer frees a slot of the 10-offer limit", async () => {
    const w = world();
    const ids = Array.from({ length: 10 }, () =>
      w.offer(w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox")),
    );
    expect(() => w.offer(w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"))).toThrow(/10 offers/);
    await answer(w, w.bob, ids[0] ?? 0, "decline");
    expect(() => w.offer(w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"))).not.toThrow();
  });

  it("AC-010.7 only the recipient can accept or decline, and nothing changes otherwise", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const id = w.offer(w.ada, adaOak, bobFox);
    for (const player of [w.ada, w.cy]) {
      for (const action of ["accept", "decline"] as const) {
        const response = await answer(w, player, id, action);
        expect(response.status).toBe(403);
        expect((await errorOf(response)).code).toBe("not_recipient");
      }
    }
    expect(statusOf(w, id)).toBe("pending");
    expect(ownerOf(w, adaOak)).toBe(w.ada.id);
  });

  it("AC-010.7 rejects answering an offer that is no longer pending", async () => {
    const w = world();
    const id = w.offer(w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"));
    await answer(w, w.bob, id, "decline");
    for (const action of ["accept", "decline"] as const) {
      const response = await answer(w, w.bob, id, action);
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("not_pending");
    }
  });

  it.each(["999", "0", "abc", "0x1", "1e0", "+1", "01"])(
    "AC-010.7 answers 404 for offer %s",
    async (id) => {
      const w = world();
      expect((await answer(w, w.bob, id, "accept")).status).toBe(404);
    },
  );
});

describe("concurrent answers (AC-010.8)", () => {
  it.each([
    ["accept then accept", "accept", "accept"],
    ["accept then cancel", "accept", "cancel"],
    ["cancel then accept", "cancel", "accept"],
  ] as const)(
    "AC-010.8 %s: the first wins, the second is a conflict",
    async (_label, first, second) => {
      const w = world();
      const adaOak = w.mint(w.ada, "oak");
      const bobFox = w.mint(w.bob, "fox");
      const id = w.offer(w.ada, adaOak, bobFox);
      const actor = (action: string) => (action === "cancel" ? w.ada : w.bob);

      expect((await answer(w, actor(first), id, first)).status).toBe(200);
      const late = await answer(w, actor(second), id, second);
      expect(late.status).toBe(409);
      expect((await errorOf(late)).code).toBe("not_pending");
      const swapped = first === "accept";
      expect(ownerOf(w, adaOak)).toBe(swapped ? w.bob.id : w.ada.id);
      expect(ownerOf(w, bobFox)).toBe(swapped ? w.ada.id : w.bob.id);
    },
  );

  // One better-sqlite3 connection runs these back to back: this proves ordering, while the
  // IMMEDIATE transaction is what serialises writers in production (design § Testing).
  it("AC-010.8 two back-to-back accepts: exactly one succeeds and the cards swap once", async () => {
    const w = world();
    const adaOak = w.mint(w.ada, "oak");
    const bobFox = w.mint(w.bob, "fox");
    const id = w.offer(w.ada, adaOak, bobFox);
    const statuses = (
      await Promise.all([answer(w, w.bob, id, "accept"), answer(w, w.bob, id, "accept")])
    ).map((response) => response.status);
    expect(statuses.sort()).toEqual([200, 409]);
    expect(ownerOf(w, adaOak)).toBe(w.bob.id);
    expect(ownerOf(w, bobFox)).toBe(w.ada.id);
  });

  it("AC-002.5 requires a player to accept or decline", async () => {
    const w = world();
    expect((await w.t.app.request("/api/trades/1/accept", { method: "POST" })).status).toBe(401);
    expect((await w.t.app.request("/api/trades/1/decline", { method: "POST" })).status).toBe(401);
  });
});

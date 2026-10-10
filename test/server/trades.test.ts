import { describe, expect, it } from "vitest";

import { respondToFriendRequest, sendFriendRequest } from "../../src/server/game/friends.js";
import { mintCard } from "../../src/server/game/mint.js";
import { createPlayer, type CreatedPlayer } from "../../src/server/players/service.js";
import { binderResponseSchema } from "../../src/shared/schemas/binder.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import { sentOfferSchema, sentOffersResponseSchema } from "../../src/shared/schemas/trades.js";
import type { Rarity } from "../../src/shared/expansion.js";
import { fakeIdentifier, testApp, type TestApp } from "./helpers.js";

interface World {
  t: TestApp;
  ada: CreatedPlayer;
  bob: CreatedPlayer;
  cy: CreatedPlayer;
  mint: (owner: CreatedPlayer, cardId: string, rarity?: Rarity) => number;
}

function befriend(t: TestApp, a: CreatedPlayer, b: CreatedPlayer): void {
  const request = sendFriendRequest(t.db, a.id, b.friendCode);
  respondToFriendRequest(t.db, b.id, request.id, true);
}

/** Ada and Bob are friends; Cy is a stranger to both. */
function world(): World {
  const t = testApp(fakeIdentifier({ outcome: "screen" }).identify);
  const ada = createPlayer(t.db, "Ada");
  const bob = createPlayer(t.db, "Bob");
  const cy = createPlayer(t.db, "Cy");
  befriend(t, ada, bob);
  const mint = (owner: CreatedPlayer, cardId: string, rarity: Rarity = "common") =>
    mintCard(t.db, {
      ownerId: owner.id,
      expansionId: "fixture-a",
      cardId,
      rarity,
      flavorLine: null,
    }).id;
  return { t, ada, bob, cy, mint };
}

function as(player: CreatedPlayer): Record<string, string> {
  return { authorization: `Bearer ${player.secret}`, "content-type": "application/json" };
}

function offer(
  w: World,
  from: CreatedPlayer,
  offeredInstanceId: number,
  requestedInstanceId: number,
) {
  return Promise.resolve(
    w.t.app.request("/api/trades", {
      method: "POST",
      headers: as(from),
      body: JSON.stringify({ offeredInstanceId, requestedInstanceId }),
    }),
  );
}

function cancel(w: World, by: CreatedPlayer, id: number | string) {
  return Promise.resolve(
    w.t.app.request(`/api/trades/${id}/cancel`, { method: "POST", headers: as(by) }),
  );
}

async function errorOf(response: Response) {
  return errorResponseSchema.parse(await response.json()).error;
}

function offerCount(w: World): number {
  return (w.t.db.prepare("SELECT COUNT(*) AS n FROM trade_offers").get() as { n: number }).n;
}

describe("POST /api/trades", () => {
  it("AC-009.1 creates a pending friend offer and answers within 500 ms", async () => {
    const w = world();
    const mine = w.mint(w.ada, "oak", "rare");
    const theirs = w.mint(w.bob, "fox", "epic");

    const started = performance.now();
    const response = await offer(w, w.ada, mine, theirs);
    const elapsed = performance.now() - started;

    expect(response.status).toBe(201);
    expect(elapsed).toBeLessThan(500);
    const body = sentOfferSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: "pending",
      source: "friend",
      resolvedAt: null,
      to: { displayName: "Bob", friendCode: w.bob.friendCode },
      offered: {
        instanceId: mine,
        cardId: "oak",
        name: "Oak",
        rarity: "rare",
        imageUrl: "/cards/fixture-a/oak",
      },
      requested: { instanceId: theirs, cardId: "fox", name: "Fox", rarity: "epic" },
    });
  });

  it("AC-009.2 locks the offered card: it cannot be offered again and shows locked", async () => {
    const w = world();
    const mine = w.mint(w.ada, "oak");
    const first = w.mint(w.bob, "fox");
    const second = w.mint(w.bob, "rose");
    expect((await offer(w, w.ada, mine, first)).status).toBe(201);

    const again = await offer(w, w.ada, mine, second);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe("card_locked");
    const binder = binderResponseSchema.parse(
      await (await w.t.app.request("/api/binder", { headers: as(w.ada) })).json(),
    );
    expect(binder.cards[0]?.instances[0]?.locked).toBe(true);
  });

  it("AC-009.3 rejects offering a card the sender does not own, the same way as an unknown id", async () => {
    const w = world();
    const bobs = w.mint(w.bob, "oak");
    const bobsOther = w.mint(w.bob, "fox");
    for (const offered of [bobs, 99_999]) {
      const response = await offer(w, w.ada, offered, bobsOther);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toEqual({
        code: "instance_not_found",
        message: "That card isn't in your binder.",
      });
    }
    expect(offerCount(w)).toBe(0);
  });

  it("AC-009.3 rejects requesting a card that is locked in its owner's pending offer", async () => {
    const w = world();
    const bobsLocked = w.mint(w.bob, "fox");
    const adas = w.mint(w.ada, "oak");
    const adasOther = w.mint(w.ada, "rose");
    expect((await offer(w, w.bob, bobsLocked, adas)).status).toBe(201);

    const response = await offer(w, w.ada, adasOther, bobsLocked);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "card_locked",
      message: "That card is in one of their pending offers.",
    });
    expect(offerCount(w)).toBe(1);
  });

  it("AC-009.3 rejects requesting a card that no longer exists", async () => {
    const w = world();
    const response = await offer(w, w.ada, w.mint(w.ada, "oak"), 99_999);
    expect(response.status).toBe(404);
    expect(offerCount(w)).toBe(0);
  });

  it("AC-009.4 rejects requesting one of the sender's own cards", async () => {
    const w = world();
    const response = await offer(w, w.ada, w.mint(w.ada, "oak"), w.mint(w.ada, "fox"));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("own_card");
    expect(offerCount(w)).toBe(0);
  });

  it("AC-009.4 rejects requesting a card of a player who is not a friend", async () => {
    const w = world();
    const response = await offer(w, w.ada, w.mint(w.ada, "oak"), w.mint(w.cy, "fox"));
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("not_friends");
    expect(offerCount(w)).toBe(0);
  });

  it("AC-008.9 rejects offers in both directions while a friend request is only pending", async () => {
    const w = world();
    sendFriendRequest(w.t.db, w.ada.id, w.cy.friendCode);
    for (const [from, to] of [
      [w.ada, w.cy],
      [w.cy, w.ada],
    ] as const) {
      const response = await offer(w, from, w.mint(from, "oak"), w.mint(to, "fox"));
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("not_friends");
    }
    expect(offerCount(w)).toBe(0);
  });

  it("AC-009.4 refuses a client-supplied source (strict schema)", async () => {
    const w = world();
    const response = await Promise.resolve(
      w.t.app.request("/api/trades", {
        method: "POST",
        headers: as(w.ada),
        body: JSON.stringify({
          offeredInstanceId: w.mint(w.ada, "oak"),
          requestedInstanceId: w.mint(w.bob, "fox"),
          source: "daily_pack",
        }),
      }),
    );
    // Extra fields are refused outright by the strict schema.
    expect(response.status).toBe(400);
    expect(offerCount(w)).toBe(0);
  });

  it.each([
    ["no body", undefined],
    ["string ids", { offeredInstanceId: "1", requestedInstanceId: "2" }],
    ["negative ids", { offeredInstanceId: -1, requestedInstanceId: 2 }],
  ])("NFR-001 rejects a request with %s", async (_label, body) => {
    const w = world();
    const response = await Promise.resolve(
      w.t.app.request("/api/trades", {
        method: "POST",
        headers: as(w.ada),
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("cancelling and listing", () => {
  it("AC-009.5 cancelling sets the offer to cancelled and unlocks the offered card", async () => {
    const w = world();
    const mine = w.mint(w.ada, "oak");
    const theirs = w.mint(w.bob, "fox");
    const created = sentOfferSchema.parse(await (await offer(w, w.ada, mine, theirs)).json());

    const response = await cancel(w, w.ada, created.id);
    expect(response.status).toBe(200);
    expect(sentOfferSchema.parse(await response.json())).toMatchObject({
      status: "cancelled",
      resolvedAt: expect.any(String) as string,
    });
    // Unlocked: the same card can be offered again.
    expect((await offer(w, w.ada, mine, theirs)).status).toBe(201);
  });

  it("AC-010.7 only the sender can cancel, and only a pending offer", async () => {
    const w = world();
    const created = sentOfferSchema.parse(
      await (await offer(w, w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"))).json(),
    );
    for (const player of [w.bob, w.cy]) {
      const response = await cancel(w, player, created.id);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("not_sender");
    }
    await cancel(w, w.ada, created.id);
    const again = await cancel(w, w.ada, created.id);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe("not_pending");
  });

  it.each(["999", "0", "abc"])("AC-010.7 answers 404 when cancelling offer %s", async (id) => {
    const w = world();
    expect((await cancel(w, w.ada, id)).status).toBe(404);
  });

  it("AC-009.6 lists sent offers newest first with both cards, the recipient and the status", async () => {
    const w = world();
    const first = sentOfferSchema.parse(
      await (await offer(w, w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"))).json(),
    );
    await cancel(w, w.ada, first.id);
    const second = sentOfferSchema.parse(
      await (
        await offer(w, w.ada, w.mint(w.ada, "rose", "legendary"), w.mint(w.bob, "oak"))
      ).json(),
    );
    // Bob's own offer does not appear in Ada's sent list.
    await offer(w, w.bob, w.mint(w.bob, "rose"), w.mint(w.ada, "fox"));

    const sent = sentOffersResponseSchema.parse(
      await (await w.t.app.request("/api/trades/sent", { headers: as(w.ada) })).json(),
    );
    expect(sent.offers.map((sentOffer) => [sentOffer.id, sentOffer.status])).toEqual([
      [second.id, "pending"],
      [first.id, "cancelled"],
    ]);
    expect(sent.offers[0]).toMatchObject({
      to: { displayName: "Bob" },
      offered: { name: "Rose", rarity: "legendary" },
      requested: { name: "Oak" },
    });
  });

  it("AC-009.7 keeps a pending offer pending: offers have no expiry", async () => {
    const w = world();
    const created = sentOfferSchema.parse(
      await (await offer(w, w.ada, w.mint(w.ada, "oak"), w.mint(w.bob, "fox"))).json(),
    );
    const columns = (
      w.t.db.prepare("SELECT name FROM pragma_table_info('trade_offers')").all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    expect(columns.some((name) => /expir/i.test(name))).toBe(false);
    // Unrelated activity does not change it.
    await offer(w, w.bob, w.mint(w.bob, "rose"), w.mint(w.ada, "rose"));
    const sent = sentOffersResponseSchema.parse(
      await (await w.t.app.request("/api/trades/sent", { headers: as(w.ada) })).json(),
    );
    expect(sent.offers.find((sentOffer) => sentOffer.id === created.id)?.status).toBe("pending");
  });

  it("AC-002.5 requires a player on every trade route", async () => {
    const w = world();
    for (const [method, path] of [
      ["POST", "/api/trades"],
      ["POST", "/api/trades/1/cancel"],
      ["GET", "/api/trades/sent"],
    ] as const) {
      expect((await w.t.app.request(path, { method })).status).toBe(401);
    }
  });

  it("NFR-009 creating, rejecting and cancelling offers never changes card instances", async () => {
    const w = world();
    const mine = w.mint(w.ada, "oak");
    const theirs = w.mint(w.bob, "fox");
    const strangers = w.mint(w.cy, "rose");
    const snapshot = () =>
      w.t.db.prepare("SELECT id, owner_id, card_id, rarity FROM card_instances ORDER BY id").all();
    const before = snapshot();

    const created = sentOfferSchema.parse(await (await offer(w, w.ada, mine, theirs)).json());
    expect((await offer(w, w.ada, mine, theirs)).status).toBe(409); // rejected: locked
    expect((await offer(w, w.ada, w.mint(w.ada, "rose"), strangers)).status).toBe(403); // rejected: not friends
    await cancel(w, w.ada, created.id);

    const after = snapshot();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1); // only the rose minted above
  });

  it("AC-009.2 the DB itself refuses a second pending offer of the same card", () => {
    const w = world();
    const mine = w.mint(w.ada, "oak");
    const insert = w.t.db.prepare(
      "INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id, requested_instance_id, source, status, created_at) VALUES (?, ?, ?, ?, 'friend', 'pending', 'now')",
    );
    insert.run(w.ada.id, w.bob.id, mine, w.mint(w.bob, "fox"));
    expect(() => insert.run(w.ada.id, w.bob.id, mine, w.mint(w.bob, "rose"))).toThrow(/UNIQUE/);
  });
});

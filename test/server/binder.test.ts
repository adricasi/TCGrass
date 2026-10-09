import { describe, expect, it } from "vitest";

import { mintCard } from "../../src/server/game/mint.js";
import { createPlayer } from "../../src/server/players/service.js";
import { binderResponseSchema } from "../../src/shared/schemas/binder.js";
import type { Rarity } from "../../src/shared/expansion.js";
import { fakeIdentifier, testApp, type TestApp } from "./helpers.js";

function setup() {
  const t = testApp(fakeIdentifier({ outcome: "screen" }).identify);
  // testApp already created player 1 (t.auth).
  const mint = (cardId: string, rarity: Rarity, ownerId = 1, at = "2026-10-10T09:00:00.000Z") =>
    mintCard(t.db, {
      ownerId,
      expansionId: "fixture-a",
      cardId,
      rarity,
      flavorLine: null,
      now: new Date(at),
    }).id;
  return { t, mint };
}

async function binder(t: TestApp, auth = t.auth) {
  const response = await t.app.request("/api/binder", { headers: auth });
  expect(response.status).toBe(200);
  return binderResponseSchema.parse(await response.json());
}

describe("GET /api/binder", () => {
  it("AC-007.1 lists every catalogue card in file order, missing ones with name and no counts", async () => {
    const { t } = setup();
    const body = await binder(t);
    expect(body.cards.map((card) => card.id)).toEqual(["oak", "rose", "fox"]);
    expect(body.cards[1]).toEqual({
      id: "rose",
      name: "Rose",
      category: "flower",
      imageUrl: "/cards/fixture-a/rose",
      owned: false,
      counts: { common: 0, rare: 0, epic: 0, legendary: 0 },
      instances: [],
    });
  });

  it("AC-007.1 shows owned cards with the number owned per rarity", async () => {
    const { t, mint } = setup();
    mint("oak", "common");
    mint("oak", "common");
    mint("oak", "epic");
    mint("fox", "legendary");
    const body = await binder(t);
    const [oak, rose, fox] = body.cards;
    expect(oak).toMatchObject({
      owned: true,
      counts: { common: 2, rare: 0, epic: 1, legendary: 0 },
    });
    expect(rose?.owned).toBe(false);
    expect(fox).toMatchObject({
      owned: true,
      counts: { common: 0, rare: 0, epic: 0, legendary: 1 },
    });
  });

  it("AC-007.2 lists each instance with rarity, capture date and lock state, newest first", async () => {
    const { t, mint } = setup();
    const older = mint("oak", "common", 1, "2026-10-10T08:00:00.000Z");
    const newer = mint("oak", "rare", 1, "2026-10-10T10:00:00.000Z");
    const body = await binder(t);
    expect(body.cards[0]?.instances).toEqual([
      {
        id: newer,
        rarity: "rare",
        capturedAt: "2026-10-10T10:00:00.000Z",
        locked: false,
        flavorLine: null,
      },
      {
        id: older,
        rarity: "common",
        capturedAt: "2026-10-10T08:00:00.000Z",
        locked: false,
        flavorLine: null,
      },
    ]);
  });

  it("AC-007.2 marks an instance locked only while it is the offered card of a pending offer", async () => {
    const { t, mint } = setup();
    const other = createPlayer(t.db, "Other");
    const offered = mint("oak", "common");
    const declined = mint("rose", "common");
    const theirs = mint("fox", "rare", other.id);
    const theirsToo = mint("fox", "epic", other.id);
    // Raw rows on purpose: this tests lock *derivation* only. Real offers go through the trade
    // service (T-009), which checks friendship and ownership.
    const offer = t.db.prepare(
      "INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id, requested_instance_id, source, status, created_at) VALUES (1, ?, ?, ?, 'friend', ?, 'now')",
    );
    offer.run(other.id, offered, theirs, "pending");
    offer.run(other.id, declined, theirsToo, "declined");

    const body = await binder(t);
    expect(body.cards[0]?.instances[0]?.locked).toBe(true);
    expect(body.cards[1]?.instances[0]?.locked).toBe(false);
    // The *requested* card of a pending offer is not locked for its owner.
    const otherBinder = await binder(t, { authorization: `Bearer ${other.secret}` });
    expect(otherBinder.cards[2]?.instances.every((instance) => !instance.locked)).toBe(true);
  });

  it("AC-007.3 counts distinct cards owned out of the catalogue total", async () => {
    const { t, mint } = setup();
    expect(await binder(t)).toMatchObject({ owned: 0, total: 3 });
    mint("oak", "common");
    mint("oak", "rare");
    mint("fox", "common");
    expect(await binder(t)).toMatchObject({ owned: 2, total: 3 });
  });

  it("AC-007.1 shows only the caller's own cards", async () => {
    const { t, mint } = setup();
    const other = createPlayer(t.db, "Other");
    mint("rose", "epic", other.id);
    expect((await binder(t)).owned).toBe(0);
    const theirs = await binder(t, { authorization: `Bearer ${other.secret}` });
    expect(theirs).toMatchObject({ owned: 1 });
    expect(theirs.cards[1]?.counts.epic).toBe(1);
  });

  it("AC-002.5 requires a player", async () => {
    const { t } = setup();
    expect((await t.app.request("/api/binder")).status).toBe(401);
  });
});

import { describe, expect, it } from "vitest";

import { mintCard } from "../../src/server/game/mint.js";
import { createPlayer, type CreatedPlayer } from "../../src/server/players/service.js";
import { SlidingWindowLimiter } from "../../src/server/rate-limit.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import {
  friendBinderResponseSchema,
  friendRequestResultSchema,
  friendsResponseSchema,
  inboxResponseSchema,
} from "../../src/shared/schemas/friends.js";
import { fakeIdentifier, testApp, type TestApp } from "./helpers.js";

interface World {
  t: TestApp;
  ada: CreatedPlayer;
  bob: CreatedPlayer;
  cy: CreatedPlayer;
  now: { value: number };
}

function world(): World {
  const now = { value: 0 };
  const t = testApp(fakeIdentifier({ outcome: "screen" }).identify, {
    unknownFriendCodes: new SlidingWindowLimiter(10, 10 * 60 * 1000, () => now.value),
  });
  return {
    t,
    ada: createPlayer(t.db, "Ada"),
    bob: createPlayer(t.db, "Bob"),
    cy: createPlayer(t.db, "Cy"),
    now,
  };
}

function as(player: CreatedPlayer): Record<string, string> {
  return { authorization: `Bearer ${player.secret}`, "content-type": "application/json" };
}

function sendRequest(t: TestApp, from: CreatedPlayer, friendCode: string): Promise<Response> {
  return Promise.resolve(
    t.app.request("/api/friend-requests", {
      method: "POST",
      headers: as(from),
      body: JSON.stringify({ friendCode }),
    }),
  );
}

function respond(t: TestApp, by: CreatedPlayer, id: number, action: "accept" | "decline") {
  return Promise.resolve(
    t.app.request(`/api/friend-requests/${id}/${action}`, { method: "POST", headers: as(by) }),
  );
}

async function errorOf(response: Response) {
  return errorResponseSchema.parse(await response.json()).error;
}

async function befriend(w: World, a: CreatedPlayer, b: CreatedPlayer): Promise<void> {
  const sent = friendRequestResultSchema.parse(
    await (await sendRequest(w.t, a, b.friendCode)).json(),
  );
  expect((await respond(w.t, b, sent.id, "accept")).status).toBe(200);
}

function friendBinder(w: World, viewer: CreatedPlayer, friend: CreatedPlayer) {
  return Promise.resolve(
    w.t.app.request(`/api/friends/${friend.friendCode}/binder`, { headers: as(viewer) }),
  );
}

function count(w: World, sql: string): number {
  return (w.t.db.prepare(sql).get() as { n: number }).n;
}

describe("POST /api/friend-requests", () => {
  it("AC-008.2 trims and upper-cases the code and creates a pending request", async () => {
    const w = world();
    const response = await sendRequest(w.t, w.ada, `  ${w.bob.friendCode.toLowerCase()} \n`);
    expect(response.status).toBe(201);
    expect(friendRequestResultSchema.parse(await response.json())).toMatchObject({
      status: "pending",
      player: { displayName: "Bob", friendCode: w.bob.friendCode },
    });
    expect(count(w, "SELECT COUNT(*) AS n FROM friend_requests WHERE status = 'pending'")).toBe(1);
  });

  it("AC-008.3 says 'No player with that code' for an unknown code", async () => {
    const w = world();
    const response = await sendRequest(w.t, w.ada, "ZZZZZZZZ");
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toEqual({
      code: "player_not_found",
      message: "No player with that code",
    });
  });

  it("AC-008.3 rejects the player's own code", async () => {
    const w = world();
    const response = await sendRequest(w.t, w.ada, w.ada.friendCode);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("own_code");
  });

  it("AC-008.3 creates nothing when a request is already pending, in either direction", async () => {
    const w = world();
    await sendRequest(w.t, w.ada, w.bob.friendCode);
    for (const [from, to] of [
      [w.ada, w.bob],
      [w.bob, w.ada],
    ] as const) {
      const response = await sendRequest(w.t, from, to.friendCode);
      expect(response.status).toBe(409);
      expect((await errorOf(response)).code).toBe("request_pending");
    }
    expect(count(w, "SELECT COUNT(*) AS n FROM friend_requests")).toBe(1);
  });

  it("AC-008.3 creates nothing when they are already friends", async () => {
    const w = world();
    await befriend(w, w.ada, w.bob);
    const response = await sendRequest(w.t, w.bob, w.ada.friendCode);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("already_friends");
  });

  it("AC-008.4 refuses all attempts after 10 unknown codes in 10 minutes, until the window passes", async () => {
    const w = world();
    for (let index = 0; index < 10; index += 1) {
      expect((await sendRequest(w.t, w.ada, `ZZZZZZZ${"23456789"[index] ?? "2"}`)).status).toBe(
        404,
      );
    }
    const unknown = await sendRequest(w.t, w.ada, "ZZZZZZXX");
    expect(unknown.status).toBe(429);
    // A valid code is refused too, so codes cannot be probed while limited.
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(429);
    // Other players are unaffected.
    expect((await sendRequest(w.t, w.cy, w.bob.friendCode)).status).toBe(201);
    // After the window the earlier refused request can be sent (it was never created).
    w.now.value = 10 * 60 * 1000;
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(201);
  });

  it("AC-008.4 holds under concurrency: of 20 parallel unknown codes at most 10 are looked up", async () => {
    const w = world();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        sendRequest(w.t, w.ada, `ZZZZZZ${"23456789ABCDEFGHJKMNPQRSTUVWXYZ"[index] ?? "2"}2`),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 404).length).toBeLessThanOrEqual(10);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(10);
  });

  it("AC-008.4 answers 400 for a malformed code without counting it", async () => {
    const w = world();
    for (let index = 0; index < 12; index += 1) {
      const response = await sendRequest(w.t, w.ada, "not a code!");
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe("invalid_friend_code");
    }
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(201);
  });

  it("AC-008.4 does not count codes that match a player", async () => {
    const w = world();
    for (let index = 0; index < 9; index += 1) {
      await sendRequest(w.t, w.ada, `ZZZZZZZ${"23456789"[index] ?? "2"}`);
    }
    await sendRequest(w.t, w.ada, w.ada.friendCode); // own code: known, not counted
    expect((await sendRequest(w.t, w.ada, "ZZZZZZZ9")).status).toBe(404);
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(429);
  });

  it("NFR-001 rejects a body without a friend code", async () => {
    const w = world();
    const response = await Promise.resolve(
      w.t.app.request("/api/friend-requests", { method: "POST", headers: as(w.ada), body: "{}" }),
    );
    expect(response.status).toBe(400);
  });
});

describe("accepting and declining", () => {
  it("AC-008.7 accepting makes both players friends and marks the request accepted", async () => {
    const w = world();
    const sent = friendRequestResultSchema.parse(
      await (await sendRequest(w.t, w.ada, w.bob.friendCode)).json(),
    );
    const response = await respond(w.t, w.bob, sent.id, "accept");
    expect(friendRequestResultSchema.parse(await response.json())).toEqual({
      id: sent.id,
      status: "accepted",
      player: { displayName: "Ada", friendCode: w.ada.friendCode },
    });
    for (const [viewer, other] of [
      [w.ada, "Bob"],
      [w.bob, "Ada"],
    ] as const) {
      const friends = friendsResponseSchema.parse(
        await (await w.t.app.request("/api/friends", { headers: as(viewer) })).json(),
      );
      expect(friends.friends.map((friend) => friend.displayName)).toEqual([other]);
    }
  });

  it("AC-008.7 declining marks the request declined and creates no friendship", async () => {
    const w = world();
    const sent = friendRequestResultSchema.parse(
      await (await sendRequest(w.t, w.ada, w.bob.friendCode)).json(),
    );
    expect(
      friendRequestResultSchema.parse(await (await respond(w.t, w.bob, sent.id, "decline")).json()),
    ).toMatchObject({
      status: "declined",
    });
    expect(count(w, "SELECT COUNT(*) AS n FROM friendships")).toBe(0);
  });

  it("AC-008.8 rejects an answer from anyone but the recipient and changes nothing", async () => {
    const w = world();
    const sent = friendRequestResultSchema.parse(
      await (await sendRequest(w.t, w.ada, w.bob.friendCode)).json(),
    );
    for (const player of [w.ada, w.cy]) {
      const response = await respond(w.t, player, sent.id, "accept");
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("not_recipient");
    }
    expect(count(w, "SELECT COUNT(*) AS n FROM friend_requests WHERE status = 'pending'")).toBe(1);
    expect(count(w, "SELECT COUNT(*) AS n FROM friendships")).toBe(0);
  });

  it("AC-008.8 rejects answering a request that is no longer pending", async () => {
    const w = world();
    const sent = friendRequestResultSchema.parse(
      await (await sendRequest(w.t, w.ada, w.bob.friendCode)).json(),
    );
    await respond(w.t, w.bob, sent.id, "decline");
    const response = await respond(w.t, w.bob, sent.id, "accept");
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("not_pending");
    expect(count(w, "SELECT COUNT(*) AS n FROM friendships")).toBe(0);
  });

  it.each(["999", "0", "-1", "abc"])("AC-008.8 answers 404 for request id %s", async (id) => {
    const w = world();
    const response = await Promise.resolve(
      w.t.app.request(`/api/friend-requests/${id}/accept`, { method: "POST", headers: as(w.bob) }),
    );
    expect(response.status).toBe(404);
  });
});

describe("re-sending after a decline (AC-008.10)", () => {
  /** Bob declines Ada's pending request; the decline is dated `hoursAgo` back. */
  async function bobDeclines(w: World, hoursAgo = 0): Promise<void> {
    const inbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.bob) })).json(),
    );
    const request = inbox.friendRequests[0];
    if (request === undefined) {
      throw new Error("no pending request to decline");
    }
    await respond(w.t, w.bob, request.id, "decline");
    w.t.db
      .prepare("UPDATE friend_requests SET resolved_at = ? WHERE id = ?")
      .run(new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(), request.id);
  }

  async function sendAndDecline(w: World, times: number, hoursAgo = 0): Promise<void> {
    for (let attempt = 0; attempt < times; attempt += 1) {
      expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(201);
      await bobDeclines(w, hoursAgo);
    }
  }

  it("AC-008.10 allows re-sending straight after a decline, 3 times", async () => {
    const w = world();
    await sendAndDecline(w, 3); // the first request + 2 re-sends, all declined
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(201); // 3rd re-send
  });

  it("AC-008.10 blocks for 24 h after the 3rd re-send is declined and says when", async () => {
    const w = world();
    await sendAndDecline(w, 4, 1); // 4 declines, the last one 1 h ago
    const response = await sendRequest(w.t, w.ada, w.bob.friendCode);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toEqual({
      code: "request_declined",
      message: "This player declined your last 4 requests. You can ask again in 23 h.",
    });
    expect(count(w, "SELECT COUNT(*) AS n FROM friend_requests WHERE status = 'pending'")).toBe(0);
  });

  it("AC-008.10 starts over once 24 h have passed since the last decline", async () => {
    const w = world();
    await sendAndDecline(w, 4, 25);
    // A fresh cycle: the first request and 3 re-sends are allowed again.
    await sendAndDecline(w, 3);
    expect((await sendRequest(w.t, w.ada, w.bob.friendCode)).status).toBe(201);
  });

  it("AC-008.10 counts only the sender→recipient direction", async () => {
    const w = world();
    await sendAndDecline(w, 4, 1);
    // Bob declined Ada 4 times; Bob may still ask Ada, and others may ask Bob.
    expect((await sendRequest(w.t, w.bob, w.ada.friendCode)).status).toBe(201);
    expect((await sendRequest(w.t, w.cy, w.bob.friendCode)).status).toBe(201);
  });
});

describe("friends' binders", () => {
  it("AC-008.5 shows a friend's instances, marking ones locked in their pending offers unavailable", async () => {
    const w = world();
    await befriend(w, w.ada, w.bob);
    const mint = (owner: CreatedPlayer, cardId: string) =>
      mintCard(w.t.db, {
        ownerId: owner.id,
        expansionId: "fixture-a",
        cardId,
        rarity: "rare",
        flavorLine: null,
      }).id;
    const locked = mint(w.bob, "oak");
    mint(w.bob, "rose");
    const adaFox = mint(w.ada, "fox");
    // Raw row: tests lock derivation only (offers are created by the trade service, T-009).
    w.t.db
      .prepare(
        "INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id, requested_instance_id, source, status, created_at) VALUES (?, ?, ?, ?, 'friend', 'pending', 'now')",
      )
      .run(w.bob.id, w.ada.id, locked, adaFox);

    const body = friendBinderResponseSchema.parse(
      await (await friendBinder(w, w.ada, w.bob)).json(),
    );
    expect(body.friend).toEqual({ displayName: "Bob", friendCode: w.bob.friendCode });
    expect(body.binder.owned).toBe(2);
    expect(body.binder.cards[0]?.instances.map((instance) => instance.locked)).toEqual([true]);
    expect(body.binder.cards[1]?.instances.map((instance) => instance.locked)).toEqual([false]);
    // Only Bob's cards, not the viewer's.
    expect(body.binder.cards[2]?.owned).toBe(false);
  });

  it("AC-008.9 hides binders while a request is pending, and from strangers, with the same 404", async () => {
    const w = world();
    await sendRequest(w.t, w.ada, w.bob.friendCode);
    for (const [viewer, owner] of [
      [w.ada, w.bob],
      [w.bob, w.ada],
      [w.cy, w.ada],
    ] as const) {
      const response = await friendBinder(w, viewer, owner);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toEqual({
        code: "not_friends",
        message: "Not one of your friends.",
      });
    }
    const unknown = await Promise.resolve(
      w.t.app.request("/api/friends/ZZZZZZZZ/binder", { headers: as(w.ada) }),
    );
    expect(await errorOf(unknown)).toEqual({
      code: "not_friends",
      message: "Not one of your friends.",
    });
  });

  it("AC-008.5 accepts the friend code in any case in the URL", async () => {
    const w = world();
    await befriend(w, w.ada, w.bob);
    const response = await Promise.resolve(
      w.t.app.request(`/api/friends/${w.bob.friendCode.toLowerCase()}/binder`, {
        headers: as(w.ada),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("GET /api/inbox", () => {
  it("AC-008.6 lists received pending friend requests with the sender's name and counts them", async () => {
    const w = world();
    await sendRequest(w.t, w.ada, w.cy.friendCode);
    await sendRequest(w.t, w.bob, w.cy.friendCode);
    await sendRequest(w.t, w.cy, w.ada.friendCode); // fails: already pending the other way
    const inbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.cy) })).json(),
    );
    expect(inbox.friendRequests.map((request) => request.from.displayName)).toEqual(["Ada", "Bob"]);
    expect(inbox.counts).toEqual({ friendRequests: 2, tradeOffers: 0, total: 2 });

    const senderInbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.ada) })).json(),
    );
    expect(senderInbox.counts.total).toBe(0);
  });

  it("AC-008.6 drops a request from the inbox once answered", async () => {
    const w = world();
    const sent = friendRequestResultSchema.parse(
      await (await sendRequest(w.t, w.ada, w.bob.friendCode)).json(),
    );
    await respond(w.t, w.bob, sent.id, "decline");
    const inbox = inboxResponseSchema.parse(
      await (await w.t.app.request("/api/inbox", { headers: as(w.bob) })).json(),
    );
    expect(inbox.friendRequests).toEqual([]);
  });

  it("AC-002.5 requires a player on every friends route", async () => {
    const w = world();
    for (const [method, path] of [
      ["POST", "/api/friend-requests"],
      ["POST", "/api/friend-requests/1/accept"],
      ["GET", "/api/friends"],
      ["GET", `/api/friends/${w.bob.friendCode}/binder`],
      ["GET", "/api/inbox"],
    ] as const) {
      expect((await w.t.app.request(path, { method })).status).toBe(401);
    }
  });
});

describe("privacy and DB rules", () => {
  it("AC-002.6 friends responses never contain a secret, a secret hash or internal player ids", async () => {
    const w = world();
    const sent = await sendRequest(w.t, w.ada, w.bob.friendCode);
    const sentText = await sent.text();
    const id = (JSON.parse(sentText) as { id: number }).id;
    const bodies = [
      sentText,
      await (await w.t.app.request("/api/inbox", { headers: as(w.bob) })).text(),
      await (await respond(w.t, w.bob, id, "accept")).text(),
      await (await w.t.app.request("/api/friends", { headers: as(w.ada) })).text(),
      await (await friendBinder(w, w.ada, w.bob)).text(),
    ];
    const hashes = (
      w.t.db.prepare("SELECT secret_hash FROM players").all() as { secret_hash: string }[]
    ).map((row) => row.secret_hash);
    for (const body of bodies) {
      for (const secret of [w.ada.secret, w.bob.secret, ...hashes]) {
        expect(body).not.toContain(secret);
      }
      expect(body).not.toMatch(/secret|"playerId"|"ownerId"|"owner_id"|"from_player_id"/);
    }
  });

  it("design § Data model: the DB allows one pending request per pair, in either direction", () => {
    const w = world();
    const insert = w.t.db.prepare(
      "INSERT INTO friend_requests (from_player_id, to_player_id, status, created_at) VALUES (?, ?, 'pending', 'now')",
    );
    insert.run(w.ada.id, w.bob.id);
    expect(() => insert.run(w.bob.id, w.ada.id)).toThrow(/UNIQUE/);
  });
});

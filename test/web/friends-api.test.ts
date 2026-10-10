import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeFriendCode } from "../../src/shared/schemas/friends.js";
import {
  answerFriendRequest,
  ApiError,
  getFriendBinder,
  getInbox,
  sendFriendRequest,
} from "../../web/src/api.js";

function stubFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const result = { id: 7, status: "pending", player: { displayName: "Bob", friendCode: "ABCD2345" } };

describe("friends API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-008.2 normalises a typed code by trimming and upper-casing", () => {
    expect(normalizeFriendCode("  abcd2345\n")).toBe("ABCD2345");
  });

  it("AC-008.2 sends a friend request as JSON with the secret header", async () => {
    const fetch = stubFetch(Response.json(result, { status: 201 }));
    await expect(sendFriendRequest("s3cret", "abcd2345")).resolves.toEqual(result);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/friend-requests");
    expect(init?.body).toBe(JSON.stringify({ friendCode: "abcd2345" }));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
  });

  it("AC-008.3 surfaces the server's message, e.g. 'No player with that code'", async () => {
    stubFetch(
      Response.json(
        { error: { code: "player_not_found", message: "No player with that code" } },
        { status: 404 },
      ),
    );
    await expect(sendFriendRequest("s3cret", "ZZZZZZZZ")).rejects.toEqual(
      new ApiError(404, "player_not_found", "No player with that code"),
    );
  });

  it("AC-008.7 accepts and declines through the request's own URL", async () => {
    const fetch = stubFetch(Response.json({ ...result, status: "accepted" }));
    await answerFriendRequest("s3cret", 7, true);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/friend-requests/7/accept");
    fetch.mockResolvedValue(Response.json({ ...result, status: "declined" }));
    await answerFriendRequest("s3cret", 7, false);
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/friend-requests/7/decline");
  });

  it("AC-008.5 encodes the friend code in the binder URL", async () => {
    const fetch = stubFetch(
      Response.json({ friend: result.player, binder: { owned: 0, total: 0, cards: [] } }),
    );
    await getFriendBinder("s3cret", "AB/CD");
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/friends/AB%2FCD/binder");
  });

  it("AC-008.6 reads the inbox counts for the badge", async () => {
    stubFetch(
      Response.json({
        friendRequests: [],
        tradeOffers: [],
        counts: { friendRequests: 0, tradeOffers: 0, total: 0 },
      }),
    );
    await expect(getInbox("s3cret")).resolves.toMatchObject({ counts: { total: 0 } });
  });
});

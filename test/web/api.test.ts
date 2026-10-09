import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, createPlayer, getMe, postCapture } from "../../web/src/api.js";

function stubFetch(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

describe("postCapture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-003.3 posts the photo as multipart field 'photo' to /api/captures", async () => {
    const card = {
      id: 1,
      cardId: "oak",
      name: "Oak",
      category: "tree",
      rarity: "rare",
      flavorLine: null,
      imageUrl: "/cards/everyday-nature/oak",
    };
    const fetch = stubFetch(Response.json({ outcome: "card", card }));
    await expect(postCapture("s3cret", photo)).resolves.toEqual({ outcome: "card", card });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/captures");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("photo")).toBeInstanceOf(Blob);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
  });

  it("NFR-001 sends the secret only in the Authorization header, never in the URL", async () => {
    const fetch = stubFetch(Response.json({ displayName: "Ada", friendCode: "ABCD2345" }));
    await getMe("s3cret");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/me");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer s3cret");
  });

  it("AC-002.10 creates a player with a JSON display name and parses the one-time secret", async () => {
    const fetch = stubFetch(
      Response.json(
        { secret: "s3cret", displayName: "Ada", friendCode: "ABCD2345" },
        { status: 201 },
      ),
    );
    await expect(createPlayer("Ada")).resolves.toEqual({
      secret: "s3cret",
      displayName: "Ada",
      friendCode: "ABCD2345",
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/players");
    expect(init?.body).toBe(JSON.stringify({ displayName: "Ada" }));
  });

  it("AC-003.12 turns an error response into an ApiError with the server's code and message", async () => {
    stubFetch(Response.json({ error: { code: "busy", message: "Try again." } }, { status: 503 }));
    const error = await postCapture("s3cret", photo).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: "busy", message: "Try again." });
  });

  it("NFR-001 rejects an error response without the error shape as unknown", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    await expect(postCapture("s3cret", photo)).rejects.toMatchObject({
      status: 502,
      code: "unknown",
    });
  });

  it("NFR-001 rejects a success response that does not match the schema", async () => {
    stubFetch(Response.json({ outcome: "legendary" }));
    await expect(postCapture("s3cret", photo)).rejects.toThrow();
  });
});

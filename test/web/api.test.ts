import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, postCapture } from "../../web/src/api.js";

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
    const fetch = stubFetch(Response.json({ outcome: "card", cardId: "oak" }));
    await expect(postCapture(photo)).resolves.toEqual({ outcome: "card", cardId: "oak" });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/captures");
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("photo")).toBeInstanceOf(Blob);
  });

  it("AC-003.12 turns an error response into an ApiError with the server's code and message", async () => {
    stubFetch(Response.json({ error: { code: "busy", message: "Try again." } }, { status: 503 }));
    const error = await postCapture(photo).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: "busy", message: "Try again." });
  });

  it("NFR-001 rejects an error response without the error shape as unknown", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    await expect(postCapture(photo)).rejects.toMatchObject({ status: 502, code: "unknown" });
  });

  it("NFR-001 rejects a success response that does not match the schema", async () => {
    stubFetch(Response.json({ outcome: "legendary" }));
    await expect(postCapture(photo)).rejects.toThrow();
  });
});

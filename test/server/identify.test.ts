import { describe, expect, it, vi } from "vitest";

import {
  buildSystemPrompt,
  decide,
  identifyPhoto,
  type IdentifyCatalogue,
  type InferenceOptions,
} from "../../src/server/identify/client.js";

const catalogue: IdentifyCatalogue = {
  instructions: "Pick the best card.",
  cards: [
    { id: "oak", name: "Oak", identify_hint: "Lobed leaves, acorns." },
    { id: "rose", name: "Rose", identify_hint: "Spiral petals, thorns." },
  ],
};
const ids = new Set(["oak", "rose"]);
const photo = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  mimeType: "image/jpeg" as const,
};

function answer(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

function completion(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: answer(content) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const good = {
  card_id: "oak",
  confidence: 0.9,
  is_photo_of_screen: false,
  flavor_line: "Acorns today, forests tomorrow.",
};

function options(fetchImpl: typeof fetch): InferenceOptions {
  return {
    baseUrl: "http://inference.test/v1",
    model: "gemma-test",
    apiKey: "sk-test",
    fetch: fetchImpl,
  };
}

describe("decide", () => {
  it("AC-003.5 mints when a catalogue card meets the threshold", () => {
    expect(decide(answer(good), ids, 0.5)).toEqual({
      outcome: "card",
      cardId: "oak",
      confidence: 0.9,
      flavorLine: "Acorns today, forests tomorrow.",
    });
  });

  it("AC-003.6 answers none for 'none' or low confidence", () => {
    expect(decide(answer({ ...good, card_id: "none" }), ids, 0.5)).toEqual({
      outcome: "none",
      reason: "model",
    });
    expect(decide(answer({ ...good, confidence: 0.49 }), ids, 0.5)).toEqual({
      outcome: "none",
      reason: "low-confidence",
    });
  });

  it("AC-003.7 answers screen when the model reports a screen or print", () => {
    expect(decide(answer({ ...good, is_photo_of_screen: true }), ids, 0.5)).toEqual({
      outcome: "screen",
    });
  });

  it.each([
    ["not JSON", "I think it is an oak"],
    ["missing field", answer({ card_id: "oak", confidence: 0.9 })],
    ["confidence out of range", answer({ ...good, confidence: 7 })],
    ["wrong type", answer({ ...good, is_photo_of_screen: "no" })],
    ["non-string content", 42],
  ])("AC-003.8 treats an invalid answer (%s) as none", (_label, content) => {
    expect(decide(content, ids, 0.5)).toEqual({
      outcome: "none",
      reason: "invalid",
    });
  });

  it("AC-003.8 treats a card id outside the catalogue as none, even when flagged as a screen", () => {
    expect(decide(answer({ ...good, card_id: "legendary-dragon" }), ids, 0.5)).toEqual({
      outcome: "none",
      reason: "invalid",
    });
    expect(
      decide(answer({ ...good, card_id: "dragon", is_photo_of_screen: true }), ids, 0.5),
    ).toEqual({ outcome: "none", reason: "invalid" });
  });

  it("accepts an answer wrapped in a ```json fence", () => {
    const fenced = "```json\n" + JSON.stringify(good) + "\n```";
    expect(decide(fenced, ids, 0.5)).toMatchObject({
      outcome: "card",
      cardId: "oak",
    });
  });

  it("AC-006.3 maps an empty flavor line to null", () => {
    expect(decide(answer({ ...good, flavor_line: "  " }), ids, 0.5)).toEqual(
      expect.objectContaining({ outcome: "card", flavorLine: null }),
    );
  });
});

describe("buildSystemPrompt", () => {
  it("AC-003.4 lists the instructions and every catalogue card with its hint", () => {
    const prompt = buildSystemPrompt(catalogue);
    expect(prompt).toContain("Pick the best card.");
    expect(prompt).toContain("oak — Oak — Lobed leaves, acorns.");
    expect(prompt).toContain("rose — Rose — Spiral petals, thorns.");
    expect(prompt).toContain("is_photo_of_screen");
    expect(prompt).toMatch(/never quote/i);
    expect(prompt).toMatch(/people/i);
  });
});

describe("identifyPhoto", () => {
  it("AC-012.1 calls the configured OpenAI-compatible endpoint with model, key and photo", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(completion(good)));
    const result = await identifyPhoto(options(fetchMock), catalogue, photo, 0.5);

    expect(result).toMatchObject({ outcome: "card", cardId: "oak" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://inference.test/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-test");
    const body = JSON.parse(init?.body as string) as {
      model: string;
      temperature: number;
      messages: { content: unknown }[];
    };
    expect(body.model).toBe("gemma-test");
    expect(body.temperature).toBe(0.2);
    expect(JSON.stringify(body.messages[1]?.content)).toContain("data:image/jpeg;base64,");
  });

  it("AC-012.1 sends no authorization header without a key", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(completion(good)));
    await identifyPhoto({ ...options(fetchMock), apiKey: undefined }, catalogue, photo, 0.5);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("AC-003.8 treats a catalogue-external answer from the endpoint as none", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(completion({ ...good, card_id: "unicorn" })),
    );
    await expect(identifyPhoto(options(fetchMock), catalogue, photo, 0.5)).resolves.toEqual({
      outcome: "none",
      reason: "invalid",
    });
  });

  it("AC-003.9 answers retry when the endpoint returns an error", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("boom", { status: 502 })),
    );
    await expect(identifyPhoto(options(fetchMock), catalogue, photo, 0.5)).resolves.toEqual({
      outcome: "retry",
      reason: "error",
    });
  });

  it("AC-003.9 answers retry when the connection fails", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("fetch failed")));
    await expect(identifyPhoto(options(fetchMock), catalogue, photo, 0.5)).resolves.toEqual({
      outcome: "retry",
      reason: "error",
    });
  });

  it("AC-003.9 answers retry when the model does not answer in time", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation timed out.", "TimeoutError"));
          });
        }),
    );
    await expect(
      identifyPhoto({ ...options(fetchMock), timeoutMs: 20 }, catalogue, photo, 0.5),
    ).resolves.toEqual({ outcome: "retry", reason: "timeout" });
  });

  it("AC-003.9 uses a 30-second timeout by default", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(completion(good)));
    await identifyPhoto(options(fetchMock), catalogue, photo, 0.5);
    expect(spy).toHaveBeenCalledWith(30_000);
    spy.mockRestore();
  });
});

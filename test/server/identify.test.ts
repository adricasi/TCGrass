import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import type { Config } from "../../src/server/config.js";
import { parseExpansionYaml } from "../../src/server/expansion/parse.js";
import { createIdentifier, type Photo } from "../../src/server/identify/client.js";
import { buildSystemPrompt } from "../../src/server/identify/prompt.js";

const expansion = parseExpansionYaml(`
id: tiny
name: Tiny
version: 0.1.0
license: { data: Apache-2.0, images: CC0 }
rarity_odds: { common: 70, rare: 22, epic: 7, legendary: 1 }
style_prompt: Watercolour.
identification: { instructions: Choose the single card that best matches. }
cards:
  - { id: oak, name: Oak, category: tree, identify_hint: Lobed leaves or acorns., art_prompt: An oak. }
  - { id: rose, name: Rose, category: flower, identify_hint: Spiral petals and thorns., art_prompt: A rose. }
`);

const config: Config = {
  inference: {
    baseUrl: "https://inference.example.test/v1",
    model: "gemma-test",
    apiKey: "sk-test-key",
  },
  identifyMinConfidence: 0.5,
};

const photo: Photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mimeType: "image/jpeg" };

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

/** Fake OpenAI-compatible endpoint that answers every request with `respond()`. */
function fakeEndpoint(respond: (init: RequestInit) => Promise<Response> | Response) {
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push({ url, init });
    return respond(init);
  };
  return { fetch, requests };
}

function completion(content: string): Response {
  return Response.json({ choices: [{ message: { role: "assistant", content } }] });
}

function answer(fields: Record<string, unknown>): Response {
  return completion(
    JSON.stringify({
      card_id: "oak",
      confidence: 0.9,
      is_photo_of_screen: false,
      flavor_line: "Mighty oaks from little acorns grow.",
      ...fields,
    }),
  );
}

function identifierFor(respond: Parameters<typeof fakeEndpoint>[0], timeoutMs?: number) {
  const endpoint = fakeEndpoint(respond);
  const identify = createIdentifier({
    config,
    expansion,
    fetch: endpoint.fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { identify, requests: endpoint.requests };
}

function sentBody(request: RecordedRequest | undefined): {
  model: string;
  messages: { role: string; content: unknown }[];
} {
  const body = request?.init.body;
  if (typeof body !== "string") {
    throw new Error("expected a JSON string request body");
  }
  return JSON.parse(body) as ReturnType<typeof sentBody>;
}

describe("buildSystemPrompt", () => {
  it("AC-003.4 includes the instructions, every catalogue id with its hint, and 'none'", () => {
    const prompt = buildSystemPrompt(expansion);
    expect(prompt).toContain("Choose the single card that best matches.");
    expect(prompt).toContain("oak — Oak — Lobed leaves or acorns.");
    expect(prompt).toContain("rose — Rose — Spiral petals and thorns.");
    expect(prompt).toContain('"none"');
  });

  it("AC-003.4 asks for screen detection and a flavor line that quotes no text, people or places", () => {
    const prompt = buildSystemPrompt(expansion);
    expect(prompt).toContain("is_photo_of_screen");
    expect(prompt).toMatch(/screen, a printed picture or a drawing/);
    expect(prompt).toMatch(/never quote or mention any text visible in the photo/i);
    expect(prompt).toMatch(/never\s+describe people or places/i);
  });
});

describe("createIdentifier", () => {
  it("AC-012.1 calls the configured endpoint with the model, API key and photo", async () => {
    const { identify, requests } = identifierFor(() => answer({}));
    await identify(photo);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe("https://inference.example.test/v1/chat/completions");
    expect(new Headers(request?.init.headers).get("authorization")).toBe("Bearer sk-test-key");
    const body = sentBody(request);
    expect(body.model).toBe("gemma-test");
    expect(JSON.stringify(body.messages[1]?.content)).toContain("data:image/jpeg;base64,/9j/4A==");
  });

  it("AC-012.1 sends no authorization header when no API key is configured", async () => {
    const endpoint = fakeEndpoint(() => answer({}));
    const identify = createIdentifier({
      config: { ...config, inference: { ...config.inference, apiKey: undefined } },
      expansion,
      fetch: endpoint.fetch,
    });
    await identify(photo);
    expect(new Headers(endpoint.requests[0]?.init.headers).has("authorization")).toBe(false);
  });

  it("AC-003.4 sends the catalogue prompt as the system message", async () => {
    const { identify, requests } = identifierFor(() => answer({}));
    await identify(photo);
    const system = sentBody(requests[0]).messages[0];
    expect(system).toEqual({ role: "system", content: buildSystemPrompt(expansion) });
  });

  it("AC-003.5 returns the card with its flavor line for a confident catalogue match", async () => {
    const { identify } = identifierFor(() => answer({}));
    await expect(identify(photo)).resolves.toEqual({
      outcome: "card",
      cardId: "oak",
      confidence: 0.9,
      flavorLine: "Mighty oaks from little acorns grow.",
    });
  });

  it("AC-003.5 accepts JSON wrapped in a Markdown code fence", async () => {
    const fenced =
      '```json\n{"card_id":"rose","confidence":0.8,"is_photo_of_screen":false,"flavor_line":"x"}\n```';
    const { identify } = identifierFor(() => completion(fenced));
    await expect(identify(photo)).resolves.toMatchObject({ outcome: "card", cardId: "rose" });
  });

  it("AC-006.3 returns a null flavor line when the model leaves it empty or out", async () => {
    const empty = identifierFor(() => answer({ flavor_line: "  " }));
    await expect(empty.identify(photo)).resolves.toMatchObject({ flavorLine: null });
    const missing = identifierFor(() => answer({ flavor_line: undefined }));
    await expect(missing.identify(photo)).resolves.toMatchObject({ flavorLine: null });
  });

  it("AC-006.3 truncates flavor lines longer than 140 characters without splitting emoji", async () => {
    const long = "🌳".repeat(150);
    const { identify } = identifierFor(() => answer({ flavor_line: long }));
    await expect(identify(photo)).resolves.toMatchObject({ flavorLine: "🌳".repeat(140) });
  });

  it("AC-006.4 replaces control and bidi characters in the flavor line with spaces", async () => {
    const { identify } = identifierFor(() =>
      answer({ flavor_line: "Bark\u202Eside\nup\u0007 high" }),
    );
    await expect(identify(photo)).resolves.toMatchObject({ flavorLine: "Bark side up high" });
  });

  it("AC-003.6 returns none when the model answers 'none'", async () => {
    const { identify } = identifierFor(() => answer({ card_id: "none" }));
    await expect(identify(photo)).resolves.toEqual({ outcome: "none", reason: "no-match" });
  });

  it("AC-003.6 returns none when confidence is below the threshold", async () => {
    const { identify } = identifierFor(() => answer({ confidence: 0.49 }));
    await expect(identify(photo)).resolves.toEqual({ outcome: "none", reason: "low-confidence" });
  });

  it("AC-003.7 returns screen when the model reports a screen or print, even for a match", async () => {
    const { identify } = identifierFor(() => answer({ is_photo_of_screen: true }));
    await expect(identify(photo)).resolves.toEqual({ outcome: "screen" });
  });

  it.each([
    ["a card id not in the catalogue", answer({ card_id: "unicorn" })],
    ["confidence above 1", answer({ confidence: 1.2 })],
    ["confidence as a string", answer({ confidence: "0.9" })],
    ["is_photo_of_screen missing", answer({ is_photo_of_screen: undefined })],
    ["content that is not JSON", completion("It is an oak tree!")],
    ["a JSON array", completion("[]")],
    ["an envelope without choices", Response.json({ error: "nope" })],
    ["a body that is not JSON", new Response("<html>")],
  ])("AC-003.8 treats %s as none", async (_label, response) => {
    const { identify } = identifierFor(() => response);
    await expect(identify(photo)).resolves.toEqual({ outcome: "none", reason: "invalid-answer" });
  });

  it("AC-003.9 returns retry when the model does not answer before the timeout", async () => {
    const { identify } = identifierFor(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason as Error);
          });
        }),
      20,
    );
    await expect(identify(photo)).resolves.toEqual({ outcome: "retry", reason: "timeout" });
  });

  it("AC-003.9 uses a 30-second timeout by default", async () => {
    const { identify, requests } = identifierFor(() => answer({}));
    await identify(photo);
    expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
    const { IDENTIFY_TIMEOUT_MS } = await import("../../src/server/identify/client.js");
    expect(IDENTIFY_TIMEOUT_MS).toBe(30_000);
  });

  it.each([500, 429, 401])(
    "AC-003.9 returns retry when the endpoint answers HTTP %i",
    async (status) => {
      const { identify } = identifierFor(() => new Response("error", { status }));
      await expect(identify(photo)).resolves.toEqual({ outcome: "retry", reason: "http-error" });
    },
  );

  it("AC-003.9 returns retry when the endpoint cannot be reached", async () => {
    const { identify } = identifierFor(() => {
      throw new TypeError("fetch failed");
    });
    await expect(identify(photo)).resolves.toEqual({ outcome: "retry", reason: "network-error" });
  });
  it("AC-003.9 releases the response body when the endpoint answers an error", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const { identify } = identifierFor(() => new Response(body, { status: 503 }));
    await expect(identify(photo)).resolves.toEqual({ outcome: "retry", reason: "http-error" });
    expect(cancelled).toBe(true);
  });

  it("AC-003.8 treats an oversized response as none", async () => {
    const { identify } = identifierFor(() => answer({ flavor_line: "x".repeat(70_000) }));
    await expect(identify(photo)).resolves.toEqual({ outcome: "none", reason: "invalid-answer" });
  });

  it("AC-004.2 never follows a redirect, so the photo goes only to the configured endpoint", async () => {
    let redirectTargetHits = 0;
    const server = createServer((request, response) => {
      if (request.url === "/elsewhere/chat/completions") {
        redirectTargetHits += 1;
        response.end("{}");
        return;
      }
      response.writeHead(307, { location: "/elsewhere/chat/completions" }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const identify = createIdentifier({
        config: {
          ...config,
          inference: { ...config.inference, baseUrl: `http://127.0.0.1:${port}/v1` },
        },
        expansion,
      });
      await expect(identify(photo)).resolves.toEqual({ outcome: "retry", reason: "network-error" });
      expect(redirectTargetHits).toBe(0);
    } finally {
      server.close();
    }
  });
});

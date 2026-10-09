import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.js";
import type { Identification } from "../../src/server/identify/client.js";
import { createLogger } from "../../src/server/logger.js";
import { fakeIdentifier, memoryLog, photoForm, seededDb } from "./helpers.js";

// A recognisable photo payload: if any of it reaches the logs, the test finds it.
const PHOTO = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...new TextEncoder().encode("PHOTO-MARKER-1234"),
]);
const PHOTO_BASE64 = Buffer.from(PHOTO).toString("base64");
const SECRET = "player-secret-abcdef123456";

describe("logging", () => {
  it("NFR-007 logs request id, method, path, status and latency for each request", async () => {
    const log = memoryLog();
    const app = createApp({
      ...seededDb(),
      identify: fakeIdentifier({ outcome: "screen" }).identify,
      logger: log.logger,
    });
    const response = await app.request("/healthz");

    const line = JSON.parse(log.lines.at(-1) ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({
      requestId: response.headers.get("x-request-id"),
      method: "GET",
      path: "/healthz",
      status: 200,
    });
    expect(line.latencyMs).toEqual(expect.any(Number));
  });

  it("NFR-007 logs the capture outcome, card id and model latency", async () => {
    const log = memoryLog();
    const card: Identification = {
      outcome: "card",
      cardId: "oak",
      confidence: 0.9,
      flavorLine: null,
    };
    const app = createApp({
      ...seededDb(),
      identify: fakeIdentifier(card).identify,
      logger: log.logger,
    });
    await app.request("/api/captures", { method: "POST", body: photoForm(PHOTO) });

    const capture = log.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === "capture");
    expect(capture).toMatchObject({ outcome: "card", cardId: "oak" });
    expect(capture?.modelLatencyMs).toEqual(expect.any(Number));
  });

  it("NFR-007 never logs photo bytes, the authorization header or secrets (AC-004.1)", async () => {
    const log = memoryLog();
    const outcomes: Identification[] = [
      { outcome: "card", cardId: "oak", confidence: 0.9, flavorLine: "Acorns!" },
      { outcome: "retry", reason: "timeout" },
    ];
    for (const outcome of outcomes) {
      const app = createApp({
        ...seededDb(),
        identify: fakeIdentifier(outcome).identify,
        logger: log.logger,
      });
      await app.request("/api/captures?secret=" + SECRET, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        body: photoForm(PHOTO),
      });
    }
    const failing = createApp({
      ...seededDb(),
      identify: fakeIdentifier(() => Promise.reject(new Error(`boom ${SECRET}`))).identify,
      logger: log.logger,
    });
    await failing.request("/api/captures", { method: "POST", body: photoForm(PHOTO) });

    const text = log.text();
    expect(log.lines.length).toBeGreaterThan(4);
    expect(text).not.toContain("PHOTO-MARKER");
    expect(text).not.toContain(PHOTO_BASE64.slice(0, 16));
    expect(text).not.toContain(SECRET);
    expect(text.toLowerCase()).not.toContain("bearer");
  });

  it("NFR-007 redacts sensitive fields at any depth if a caller ever logs them", () => {
    const log = memoryLog();
    log.logger.info({
      headers: { authorization: `Bearer ${SECRET}`, cookie: "session=abc" },
      photo: PHOTO_BASE64,
      config: { inference: { apiKey: "sk-live-123" }, INFERENCE_API_KEY: "sk-live-456" },
      player: { playerSecret: SECRET, secretHash: "hash-789" },
      items: [{ token: "tok-000" }],
      cardId: "oak",
      requestId: "r-1",
    });
    const text = log.text();
    for (const value of [
      SECRET,
      PHOTO_BASE64,
      "sk-live-123",
      "sk-live-456",
      "hash-789",
      "tok-000",
      "session=abc",
    ]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain("[redacted]");
    expect(text).toContain('"cardId":"oak"');
    expect(text).toContain('"requestId":"r-1"');
  });

  it("NFR-007 writes log lines to the configured file as well", async () => {
    const filePath = join(mkdtempSync(join(tmpdir(), "tcgrass-log-")), "logs", "api.log");
    const logger = createLogger({ level: "info", filePath, destination: new PassThrough() });
    logger.info({ event: "file-check" });
    await expect.poll(() => readFileSync(filePath, "utf8")).toContain('"event":"file-check"');
  });
});

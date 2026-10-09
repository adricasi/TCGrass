import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.js";
import { generateFriendCode } from "../../src/server/players/friend-code.js";
import { hashSecret } from "../../src/server/players/secret.js";
import { createPlayer, findPlayerBySecret } from "../../src/server/players/service.js";
import { SlidingWindowLimiter } from "../../src/server/rate-limit.js";
import {
  createPlayerResponseSchema,
  DISPLAY_NAME_RULE,
  FRIEND_CODE_ALPHABET,
  meResponseSchema,
} from "../../src/shared/schemas/players.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import { emptyDb, fakeIdentifier, memoryLog, photoForm, JPEG_BYTES, seededDb } from "./helpers.js";

function playersApp(options: { now?: () => number; trustProxy?: boolean } = {}) {
  const { db, expansion } = seededDb();
  const log = memoryLog();
  const app = createApp({
    db,
    expansion,
    identify: fakeIdentifier({ outcome: "none", reason: "no-match" }).identify,
    logger: log.logger,
    playerCreations: new SlidingWindowLimiter(10, 60 * 60 * 1000, options.now),
    trustProxy: options.trustProxy ?? true,
  });
  return { app, db, log };
}

function postPlayer(
  app: ReturnType<typeof playersApp>["app"],
  body: unknown,
  ip = "203.0.113.7",
): Promise<Response> {
  return Promise.resolve(
    app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

async function errorOf(response: Response) {
  return errorResponseSchema.parse(await response.json()).error;
}

describe("POST /api/players", () => {
  it("AC-002.10 creates a player and returns the secret once with name and friend code", async () => {
    const { app } = playersApp();
    const response = await postPlayer(app, { displayName: "  Ada  " });

    expect(response.status).toBe(201);
    const body = createPlayerResponseSchema.parse(await response.json());
    expect(body.displayName).toBe("Ada");
    expect(Object.keys(body).sort()).toEqual(["displayName", "friendCode", "secret"]);
  });

  it("AC-002.2 issues a 256-bit secret and an 8-character friend code from the safe alphabet", async () => {
    const { app } = playersApp();
    const body = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    expect(Buffer.from(body.secret, "base64url")).toHaveLength(32);
    expect(body.friendCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  });

  it("AC-002.9 stores only the SHA-256 hash of the secret", async () => {
    const { app, db } = playersApp();
    const { secret } = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    const row = db.prepare("SELECT * FROM players").get() as Record<string, unknown>;
    expect(row.secret_hash).toBe(hashSecret(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["21 characters", "x".repeat(21)],
    ["a control character", "Ada\u0007"],
    ["a newline", "Ada\nLovelace"],
    ["a bidi override", "Ada\u202Eecalevol"],
    ["only a zero-width space", "\u200B"],
    ["a zero-width space", "Ana\u200B"],
    ["a line separator", "Ada\u2028Lovelace"],
    ["a private-use character", "Ada\uE000"],
  ])(
    "AC-002.4 rejects a display name that is %s and explains the rule",
    async (_label, displayName) => {
      const { app, db } = playersApp();
      const response = await postPlayer(app, { displayName });
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toEqual({
        code: "invalid_display_name",
        message: DISPLAY_NAME_RULE,
      });
      expect(db.prepare("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
    },
  );

  it.each([
    ["20 characters", "x".repeat(20)],
    ["emoji counted as characters", "🌳".repeat(20)],
    ["accents and spaces inside", "Adrià Casals"],
    ["an emoji ZWJ sequence", "Dev 👩\u200D💻"],
  ])("AC-002.4 accepts a display name with %s", async (_label, displayName) => {
    const { app } = playersApp();
    expect((await postPlayer(app, { displayName })).status).toBe(201);
  });

  it.each([
    ["no body", undefined],
    ["an extra field", { displayName: "Ada", secret: "mine" }],
    ["a non-string name", { displayName: 42 }],
  ])("AC-002.4 rejects a request with %s and explains the name rule", async (_label, body) => {
    const { app } = playersApp();
    const response = await postPlayer(app, body);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({
      code: "invalid_display_name",
      message: DISPLAY_NAME_RULE,
    });
  });

  it("AC-002.4 stores names in NFC so look-alike spellings are the same name", async () => {
    const { app } = playersApp();
    const body = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Adria\u0300" })).json(),
    );
    expect(body.displayName).toBe("Adri\u00E0");
  });

  it("NFR-001 accepts only JSON, so other sites cannot create players through a visitor", async () => {
    const { app, db } = playersApp();
    const response = await app.request("/api/players", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ displayName: "Ada" }),
    });
    expect(response.status).toBe(415);
    expect(db.prepare("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
  });

  it("NFR-001 rejects a body over 1 KB with 413", async () => {
    const { app } = playersApp();
    const response = await postPlayer(app, { displayName: "x".repeat(2000) });
    expect(response.status).toBe(413);
  });

  it("AC-002.10 marks the response that carries the secret as not cacheable", async () => {
    const { app } = playersApp();
    const response = await postPlayer(app, { displayName: "Ada" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("AC-002.8 rejects the 11th creation from one IP within 60 minutes, until the window passes", async () => {
    let now = 0;
    const { app } = playersApp({ now: () => now });
    for (let index = 0; index < 10; index += 1) {
      expect((await postPlayer(app, { displayName: `P${index}` })).status).toBe(201);
    }
    const eleventh = await postPlayer(app, { displayName: "P10" });
    expect(eleventh.status).toBe(429);
    expect((await errorOf(eleventh)).code).toBe("rate_limited");

    expect((await postPlayer(app, { displayName: "Other IP" }, "198.51.100.1")).status).toBe(201);
    now = 60 * 60 * 1000;
    expect((await postPlayer(app, { displayName: "Later" })).status).toBe(201);
  });

  it("AC-002.8 ignores X-Forwarded-For unless TRUST_PROXY is set, so it cannot be forged", async () => {
    const { app } = playersApp({ trustProxy: false });
    for (let index = 0; index < 10; index += 1) {
      await postPlayer(app, { displayName: `P${index}` }, `198.51.100.${index}`);
    }
    // All ten came from the same socket ("unknown" under app.request), whatever the header said.
    expect((await postPlayer(app, { displayName: "Forged" }, "192.0.2.99")).status).toBe(429);
  });

  it("AC-002.8 counts the address Caddy appended, not a client-sent X-Forwarded-For", async () => {
    const { app } = playersApp();
    for (let index = 0; index < 10; index += 1) {
      await postPlayer(app, { displayName: `P${index}` }, `10.0.0.${index}, 203.0.113.7`);
    }
    expect(
      (await postPlayer(app, { displayName: "Spoofed" }, "10.9.9.9, 203.0.113.7")).status,
    ).toBe(429);
  });

  it("AC-002.8 falls back to the socket address when there is no X-Forwarded-For (local dev)", async () => {
    const { app } = playersApp();
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    try {
      const { port } = server.address() as AddressInfo;
      const create = (index: number) =>
        fetch(`http://127.0.0.1:${port}/api/players`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: `P${index}` }),
        });
      for (let index = 0; index < 10; index += 1) {
        expect((await create(index)).status).toBe(201);
      }
      expect((await create(10)).status).toBe(429);
    } finally {
      server.close();
    }
  });

  it("AC-002.8 counts one IPv6 /64 as one client, so rotating addresses does not bypass it", async () => {
    const { app } = playersApp();
    for (let index = 0; index < 10; index += 1) {
      const ip = `2001:db8:1:2::${(index + 1).toString(16)}`;
      expect((await postPlayer(app, { displayName: `P${index}` }, ip)).status).toBe(201);
    }
    expect((await postPlayer(app, { displayName: "Rotated" }, "2001:db8:1:2:ffff::9")).status).toBe(
      429,
    );
    expect((await postPlayer(app, { displayName: "Next /64" }, "2001:db8:1:3::1")).status).toBe(
      201,
    );
  });

  it("NFR-007 never logs the secret", async () => {
    const { app, log } = playersApp();
    const { secret } = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    await app.request("/api/me", { headers: { authorization: `Bearer ${secret}` } });
    expect(log.lines.length).toBeGreaterThan(0);
    expect(log.text()).not.toContain(secret);
  });
});

describe("GET /api/me and authentication", () => {
  it("AC-002.3 returns the same player for the stored secret", async () => {
    const { app } = playersApp();
    const created = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    const response = await app.request("/api/me", {
      headers: { authorization: `Bearer ${created.secret}` },
    });
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json())).toEqual({
      displayName: "Ada",
      friendCode: created.friendCode,
    });
  });

  it("AC-002.6 exposes only display name and friend code, never the secret, hash or id", async () => {
    const { app, db } = playersApp();
    const created = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    const text = await (
      await app.request("/api/me", { headers: { authorization: `Bearer ${created.secret}` } })
    ).text();
    const row = db.prepare("SELECT id, secret_hash FROM players").get() as {
      id: number;
      secret_hash: string;
    };
    expect(JSON.parse(text)).toEqual({ displayName: "Ada", friendCode: created.friendCode });
    expect(text).not.toContain(created.secret);
    expect(text).not.toContain(row.secret_hash);
  });

  it.each([
    ["no header", {}],
    ["an empty bearer", { authorization: "Bearer " }],
    ["another scheme", { authorization: "Basic dXNlcjpwdw==" }],
    ["a malformed secret", { authorization: "Bearer not-a-secret" }],
    ["an unknown well-formed secret", { authorization: `Bearer ${"A".repeat(43)}` }],
  ])(
    "AC-002.5 refuses %s with the same 401 on /api/me and /api/captures",
    async (_label, headers) => {
      const { app } = playersApp();
      const me = await app.request("/api/me", { headers });
      const capture = await app.request("/api/captures", {
        method: "POST",
        headers,
        body: photoForm(JPEG_BYTES),
      });
      for (const response of [me, capture]) {
        expect(response.status).toBe(401);
        expect(await errorOf(response)).toEqual({
          code: "unauthenticated",
          message: "Player not found. Create a new player.",
        });
      }
    },
  );

  it("AC-002.5 requires a player on any other /api route, even one that does not exist yet", async () => {
    const { app } = playersApp();
    for (const [method, path] of [
      ["GET", "/api/binder"],
      ["POST", "/api/trades"],
      ["GET", "/api/players"],
    ]) {
      const response = await app.request(path ?? "", { method: method ?? "GET" });
      expect(response.status).toBe(401);
    }
  });

  it("AC-002.5 accepts the bearer scheme in any letter case", async () => {
    const { app } = playersApp();
    const { secret } = createPlayerResponseSchema.parse(
      await (await postPlayer(app, { displayName: "Ada" })).json(),
    );
    expect(
      (await app.request("/api/me", { headers: { authorization: `bearer ${secret}` } })).status,
    ).toBe(200);
  });

  it("AC-002.5 keeps public routes public", async () => {
    const { app } = playersApp();
    expect((await app.request("/api/expansion")).status).toBe(200);
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("players service", () => {
  it("AC-002.2 generates another friend code when one already exists", () => {
    const db = emptyDb();
    const codes = ["AAAAAAAA", "AAAAAAAA", "BBBBBBBB"];
    createPlayer(db, "First", { friendCode: () => codes.shift() ?? "ZZZZZZZZ" });
    const second = createPlayer(db, "Second", { friendCode: () => codes.shift() ?? "ZZZZZZZZ" });
    expect(second.friendCode).toBe("BBBBBBBB");
  });

  it("AC-002.2 gives up after repeated friend-code clashes instead of looping forever", () => {
    const db = emptyDb();
    createPlayer(db, "First", { friendCode: () => "AAAAAAAA" });
    expect(() => createPlayer(db, "Second", { friendCode: () => "AAAAAAAA" })).toThrow(/UNIQUE/);
  });

  it("AC-002.2 refuses an out-of-range random index instead of producing a bad code", () => {
    expect(() => generateFriendCode(() => 99)).toThrow(RangeError);
  });

  it("AC-002.2 builds friend codes only from the alphabet without 0/O/1/I/L", () => {
    expect(FRIEND_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(generateFriendCode(() => 0)).toBe("22222222");
    expect(generateFriendCode((max) => max - 1)).toBe("ZZZZZZZZ");
    for (let index = 0; index < 200; index += 1) {
      expect(generateFriendCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    }
  });

  it("AC-002.5 finds a player only by the exact secret", () => {
    const db = emptyDb();
    const player = createPlayer(db, "Ada");
    expect(findPlayerBySecret(db, player.secret)?.id).toBe(player.id);
    expect(findPlayerBySecret(db, player.secret.slice(0, -1) + "x")).toBeUndefined();
  });
});

describe("SlidingWindowLimiter", () => {
  it("NFR-005 prunes idle keys at most once per tenth of the window", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(1, 100, () => now);
    for (let index = 0; index < 50; index += 1) {
      limiter.tryHit(`ip-${index}`);
    }
    now = 100; // all 50 windows have expired; the prune interval (10) has passed
    limiter.tryHit("fresh");
    expect(limiter.trackedKeys).toBe(1);
    now = 105; // within the prune interval: no scan, nothing removed
    limiter.tryHit("second");
    expect(limiter.trackedKeys).toBe(2);
  });

  it("NFR-005 refuses unseen keys once maxKeys are tracked, without resetting others", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(2, 1000, () => now, 3);
    expect(["a", "b", "c"].map((key) => limiter.tryHit(key))).toEqual([true, true, true]);
    expect(limiter.tryHit("flood")).toBe(false);
    expect(limiter.tryHit("a")).toBe(true); // known keys keep their own window
    expect(limiter.tryHit("a")).toBe(false);
    now = 1000; // windows over: pruning frees room for new keys
    expect(limiter.tryHit("flood")).toBe(true);
  });

  it("AC-002.8 allows `limit` hits per key per window", () => {
    let now = 1_000;
    const limiter = new SlidingWindowLimiter(2, 100, () => now);
    expect([limiter.tryHit("a"), limiter.tryHit("a"), limiter.tryHit("a")]).toEqual([
      true,
      true,
      false,
    ]);
    expect(limiter.tryHit("b")).toBe(true);
    now += 99;
    expect(limiter.tryHit("a")).toBe(false);
    now += 1;
    expect(limiter.tryHit("a")).toBe(true);
  });
});

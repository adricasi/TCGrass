import { describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.js";
import { loadExpansionFolder } from "../../src/server/expansion/load.js";
import { findExpansion } from "../../src/server/expansion/repository.js";
import { seedExpansion } from "../../src/server/expansion/seed.js";
import { expansionResponseSchema } from "../../src/shared/schemas/expansion.js";
import { emptyDb, fakeIdentifier, memoryLog, repoPath, seededDb, testApp } from "./helpers.js";

const identify = fakeIdentifier({ outcome: "screen" }).identify;

describe("GET /api/expansion", () => {
  it("AC-005.4 returns the active expansion's cards and odds exactly as loaded", async () => {
    const { app } = testApp(identify);
    const response = await app.request("/api/expansion");

    expect(response.status).toBe(200);
    const body = expansionResponseSchema.parse(await response.json());
    expect(body).toEqual({
      id: "fixture-a",
      name: "Fixture A",
      version: "1.0.0",
      rarityOdds: { common: 60, rare: 30, epic: 9, legendary: 1 },
      cards: [
        { id: "oak", name: "Oak", category: "tree", imageUrl: "/cards/fixture-a/oak" },
        { id: "rose", name: "Rose", category: "flower", imageUrl: "/cards/fixture-a/rose" },
        { id: "fox", name: "Fox", category: "animal", imageUrl: "/cards/fixture-a/fox" },
      ],
    });
  });

  it("AC-001.1 returns the 15 everyday-nature cards with odds after a placeholder seed", async () => {
    const db = emptyDb();
    seedExpansion(
      db,
      loadExpansionFolder(repoPath("expansions/everyday-nature"), { placeholders: true }),
    );
    const expansion = findExpansion(db, "everyday-nature");
    if (expansion === undefined) {
      throw new Error("not seeded");
    }
    const app = createApp({ db, expansion, identify, logger: memoryLog().logger });

    const body = expansionResponseSchema.parse(await (await app.request("/api/expansion")).json());
    expect(body.cards).toHaveLength(15);
    expect(body.rarityOdds).toEqual({ common: 70, rare: 22, epic: 7, legendary: 1 });
  });
});

describe("GET /cards/:expansionId/:cardId", () => {
  it("AC-001.4 serves a card's PNG", async () => {
    const { app } = testApp(identify);
    const response = await app.request("/cards/fixture-a/oak");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("AC-001.4 serves the category placeholder SVG for a card without art", async () => {
    const db = emptyDb();
    seedExpansion(
      db,
      loadExpansionFolder(repoPath("expansions/everyday-nature"), { placeholders: true }),
    );
    const expansion = findExpansion(db, "everyday-nature");
    if (expansion === undefined) {
      throw new Error("not seeded");
    }
    const app = createApp({ db, expansion, identify, logger: memoryLog().logger });

    const response = await app.request("/cards/everyday-nature/oak");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toMatch(/^<svg [\s\S]*>tree<\/text><\/svg>$/);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });

  it.each([
    "/cards/fixture-a/unicorn",
    "/cards/other/oak",
    "/cards/fixture-a/..%2F..%2Fpackage.json",
    "/cards/..%2F..%2Fetc/passwd",
  ])("NFR-001 answers 404 for an unknown or crafted card path %s", async (path) => {
    const { app } = testApp(identify);
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("GET /cards when the art file is gone", () => {
  it("NFR-007 answers 404 and logs which card's art is missing", async () => {
    const { db, expansion } = seededDb();
    db.prepare("UPDATE catalogue_cards SET image_path = ? WHERE id = 'oak'").run(
      "/nonexistent/oak.png",
    );
    const log = memoryLog();
    const app = createApp({ db, expansion, identify, logger: log.logger });

    const response = await app.request("/cards/fixture-a/oak");
    expect(response.status).toBe(404);
    expect(log.text()).toContain(
      '"event":"card_image_missing","expansionId":"fixture-a","cardId":"oak"',
    );
  });
});

describe("GET /healthz", () => {
  it("NFR-007 reports ok when the DB answers and 503 when it does not", async () => {
    const { app, db } = testApp(identify);
    expect((await app.request("/healthz")).status).toBe(200);
    db.close();
    const response = await app.request("/healthz");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "db_unavailable", message: "Database unavailable." },
    });
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "../../src/server/config.js";
import { openDatabase } from "../../src/server/db/connection.js";
import { migrate } from "../../src/server/db/migrate.js";
import { loadExpansionFolder } from "../../src/server/expansion/load.js";
import { ExpansionError } from "../../src/server/expansion/parse.js";
import { seedExpansion } from "../../src/server/expansion/seed.js";
import { bootstrap } from "../../src/server/startup.js";
import { fixtureDir, memoryLog } from "./helpers.js";

const dirs: string[] = [];

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const dir = mkdtempSync(join(tmpdir(), "tcgrass-start-"));
  dirs.push(dir);
  return {
    inference: { baseUrl: "http://127.0.0.1:9/v1", model: "m", apiKey: undefined },
    identifyMinConfidence: 0.5,
    activeExpansion: "fixture-a",
    port: 0,
    logLevel: "info",
    logFilePath: undefined,
    databasePath: join(dir, "data", "tcgrass.db"),
    trustProxy: false,
    dailyCaps: { global: 3000, perPlayer: 30 },
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bootstrap", () => {
  it("AC-012.3 refuses to start and names the active expansion when it is not loaded", () => {
    expect(() => bootstrap(config(), memoryLog().logger)).toThrow(ExpansionError);
    expect(() => bootstrap(config(), memoryLog().logger)).toThrow(
      /Active expansion "fixture-a" is not loaded/,
    );
  });

  it("AC-012.3 starts once the active expansion is seeded, creating and migrating the DB file", async () => {
    const settings = config();
    const db = openDatabase(settings.databasePath);
    migrate(db);
    seedExpansion(db, loadExpansionFolder(fixtureDir("fixture-a"), { placeholders: false }));
    db.close();

    const started = bootstrap(settings, memoryLog().logger);
    try {
      expect(started.expansion.expansion.id).toBe("fixture-a");
      expect(started.db.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(started.db.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(started.db.pragma("foreign_keys", { simple: true })).toBe(1);
      expect((await started.app.request("/healthz")).status).toBe(200);
    } finally {
      started.db.close();
    }
  });
});

describe("migrate", () => {
  it("ADR-0004 refuses two migration files with the same version", () => {
    const dir = mkdtempSync(join(tmpdir(), "tcgrass-mig-"));
    dirs.push(dir);
    writeFileSync(join(dir, "001-a.sql"), "CREATE TABLE a (x INTEGER);");
    writeFileSync(join(dir, "001-b.sql"), "CREATE TABLE b (x INTEGER);");
    expect(() => migrate(openDatabase(":memory:"), `${dir}/`)).toThrow(/share a version/);
  });

  it("ADR-0004 applies the migrations once and is a no-op on the next start", () => {
    const db = openDatabase(":memory:");
    expect(migrate(db)).toBe(2);
    expect(migrate(db)).toBe(2);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "card_instances",
      "catalogue_cards",
      "daily_call_counts",
      "daily_pack_cards",
      "daily_packs",
      "expansions",
      "friend_requests",
      "friendships",
      "players",
      "trade_offers",
    ]);
  });
});

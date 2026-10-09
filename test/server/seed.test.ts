import { readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Db } from "../../src/server/db/connection.js";
import { loadExpansionFolder } from "../../src/server/expansion/load.js";
import { ExpansionError } from "../../src/server/expansion/parse.js";
import { findExpansion } from "../../src/server/expansion/repository.js";
import { seedExpansion } from "../../src/server/expansion/seed.js";
import { copyFixture, emptyDb, fixtureDir, repoPath } from "./helpers.js";

function editYaml(dir: string, edit: (text: string) => string): void {
  const file = join(dir, "expansion.yaml");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
}

function seed(db: Db, dir: string, placeholders = false) {
  return seedExpansion(db, loadExpansionFolder(dir, { placeholders }));
}

function count(db: Db, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function addPlayer(db: Db, id: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO players (id, secret_hash, display_name, friend_code, created_at) VALUES (?, ?, 'Ada', ?, 'now')",
  ).run(id, `hash-${id}`, `CODE-${id}`);
}

function addOwnedInstance(db: Db, expansionId: string, cardId: string, ownerId = 1): number {
  addPlayer(db, ownerId);
  return Number(
    db
      .prepare(
        "INSERT INTO card_instances (expansion_id, card_id, rarity, owner_id, flavor_line, captured_at) VALUES (?, ?, 'rare', ?, 'x', 'now')",
      )
      .run(expansionId, cardId, ownerId).lastInsertRowid,
  );
}

describe("seeding an expansion", () => {
  it("AC-001.1 stores the expansion, cards, odds, style prompt and instructions and reports the count", () => {
    const db = emptyDb();
    const result = seed(db, fixtureDir("fixture-a"));

    expect(result).toEqual({ expansionId: "fixture-a", cardsLoaded: 3, cardsRemoved: [] });
    const stored = findExpansion(db, "fixture-a");
    expect(stored?.expansion).toMatchObject({
      name: "Fixture A",
      rarity_odds: { common: 60, rare: 30, epic: 9, legendary: 1 },
      style_prompt: "Flat test style.",
      identification: { instructions: "Choose the matching card or none." },
    });
    expect(stored?.cards.map((card) => card.id)).toEqual(["oak", "rose", "fox"]);
    expect(stored?.cards.every((card) => !card.isPlaceholder)).toBe(true);
  });

  it("NFR-004 keeps every everyday-nature card at or under 350 KB for phones", () => {
    const dir = repoPath("expansions/everyday-nature/images");
    const sizes = readdirSync(dir)
      .filter((name) => name.endsWith(".png"))
      .map((name) => ({ name, bytes: statSync(join(dir, name)).size }));
    expect(sizes).toHaveLength(15);
    expect(sizes.filter((file) => file.bytes > 350 * 1024)).toEqual([]);
  });

  it("AC-001.2 rejects bad odds, names the problem and stores nothing", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    editYaml(dir, (text) => text.replace("legendary: 1", "legendary: 2"));
    expect(() => seed(db, dir)).toThrow(/sum to exactly 100/);
    expect(count(db, "SELECT COUNT(*) AS n FROM expansions")).toBe(0);
  });

  it("AC-001.3 rejects a card with an empty field, names card and field and stores nothing", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    editYaml(dir, (text) => text.replace("identify_hint: A rose.", "identify_hint: ''"));
    expect(() => seed(db, dir)).toThrow(/cards\.1\.identify_hint/);
    expect(count(db, "SELECT COUNT(*) AS n FROM catalogue_cards")).toBe(0);
  });

  it("REQ-001 rejects an expansion whose id differs from its folder name", () => {
    const dir = copyFixture("fixture-a");
    editYaml(dir, (text) => text.replace("id: fixture-a", "id: other-id"));
    expect(() => seed(emptyDb(), dir)).toThrow(/must equal the folder name "fixture-a"/);
  });

  it("AC-001.4 rejects a card without an image, naming the card", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    rmSync(join(dir, "images", "fox.png"));
    expect(() => seed(db, dir)).toThrow(ExpansionError);
    expect(() => seed(db, dir)).toThrow(/cards\.fox: missing image images\/fox\.png/);
    expect(count(db, "SELECT COUNT(*) AS n FROM expansions")).toBe(0);
  });

  it("AC-001.4 loads a missing image as the category placeholder with a warning in placeholder mode", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    rmSync(join(dir, "images", "fox.png"));
    const loaded = loadExpansionFolder(dir, { placeholders: true });
    seedExpansion(db, loaded);

    expect(loaded.warnings).toEqual(["cards.fox: no images/fox.png, using the animal placeholder"]);
    const fox = findExpansion(db, "fixture-a")?.cards.find((card) => card.id === "fox");
    expect(fox).toMatchObject({ isPlaceholder: true, imagePath: "animal.svg" });
  });

  it.each([
    [
      "a symlink to a file outside images/",
      (dir: string) => {
        symlinkSync(join(dir, "expansion.yaml"), join(dir, "images", "fox.png"));
      },
      /images\/fox\.png must be a regular file, not a symlink/,
    ],
    [
      "a file that is not a PNG",
      (dir: string) => {
        writeFileSync(join(dir, "images", "fox.png"), "SQLite format 3\0");
      },
      /images\/fox\.png is not a PNG/,
    ],
  ])(
    "NFR-001 rejects card art that is %s, so the card route cannot serve other files",
    (_label, plant, message) => {
      const dir = copyFixture("fixture-a");
      rmSync(join(dir, "images", "fox.png"));
      plant(dir);
      expect(() => loadExpansionFolder(dir, { placeholders: true })).toThrow(message);
    },
  );

  it("AC-001.5 re-seeding updates data without duplicating cards or touching instances", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    seed(db, dir);
    const instanceId = addOwnedInstance(db, "fixture-a", "oak");
    const before = db.prepare("SELECT * FROM card_instances WHERE id = ?").get(instanceId);

    editYaml(dir, (text) =>
      text.replace("name: Oak", "name: Great Oak").replace("version: 1.0.0", "version: 1.1.0"),
    );
    seed(db, dir);

    expect(
      count(db, "SELECT COUNT(*) AS n FROM catalogue_cards WHERE expansion_id = 'fixture-a'"),
    ).toBe(3);
    const stored = findExpansion(db, "fixture-a");
    expect(stored?.expansion.version).toBe("1.1.0");
    expect(stored?.cards[0]?.name).toBe("Great Oak");
    expect(db.prepare("SELECT * FROM card_instances WHERE id = ?").get(instanceId)).toEqual(before);
    expect(count(db, "SELECT COUNT(*) AS n FROM card_instances")).toBe(1);
  });

  it("AC-001.6 rejects a reload that removes an owned card, naming it and changing nothing", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    seed(db, dir);
    addOwnedInstance(db, "fixture-a", "fox");

    editYaml(dir, (text) =>
      text.replace(/ {2}- id: fox[\s\S]*$/, "").replace("name: Oak", "name: Renamed Oak"),
    );
    expect(() => seed(db, dir)).toThrow(/players own "fox"/);
    const stored = findExpansion(db, "fixture-a");
    expect(stored?.cards.map((card) => card.id)).toEqual(["oak", "rose", "fox"]);
    expect(stored?.cards[0]?.name).toBe("Oak");
  });

  it("AC-001.6 deletes a removed card that nobody owns", () => {
    const db = emptyDb();
    const dir = copyFixture("fixture-a");
    seed(db, dir);
    editYaml(dir, (text) => text.replace(/ {2}- id: fox[\s\S]*$/, ""));

    expect(seed(db, dir).cardsRemoved).toEqual(["fox"]);
    expect(findExpansion(db, "fixture-a")?.cards.map((card) => card.id)).toEqual(["oak", "rose"]);
  });

  it("AC-001.7 loads a second expansion with different cards alongside the first", () => {
    const db = emptyDb();
    seed(db, fixtureDir("fixture-a"));
    expect(seed(db, fixtureDir("fixture-b"))).toMatchObject({
      expansionId: "fixture-b",
      cardsLoaded: 2,
    });
    expect(findExpansion(db, "fixture-b")?.cards.map((card) => card.id)).toEqual([
      "cactus",
      "gull",
    ]);
    expect(findExpansion(db, "fixture-a")?.cards).toHaveLength(3);
  });
});

describe("schema", () => {
  it("AC-009.2 allows only one pending offer per offered card (partial unique index)", () => {
    const db = emptyDb();
    seed(db, fixtureDir("fixture-a"));
    const first = addOwnedInstance(db, "fixture-a", "oak");
    const second = addOwnedInstance(db, "fixture-a", "rose", 2);
    const insertOffer = db.prepare(
      "INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id, requested_instance_id, source, status, created_at) VALUES (1, 2, ?, ?, 'friend', ?, 'now')",
    );
    insertOffer.run(first, second, "pending");
    insertOffer.run(first, second, "declined");
    expect(() => insertOffer.run(first, second, "pending")).toThrow(/UNIQUE/);
  });

  it("REQ-009 rejects offers to yourself or of a card for itself", () => {
    const db = emptyDb();
    seed(db, fixtureDir("fixture-a"));
    const mine = addOwnedInstance(db, "fixture-a", "oak");
    const theirs = addOwnedInstance(db, "fixture-a", "rose", 2);
    const offer = db.prepare(
      "INSERT INTO trade_offers (from_player_id, to_player_id, offered_instance_id, requested_instance_id, source, status, created_at) VALUES (?, ?, ?, ?, 'friend', 'pending', 'now')",
    );
    expect(() => offer.run(1, 1, mine, theirs)).toThrow(/CHECK/);
    expect(() => offer.run(1, 2, mine, mine)).toThrow(/CHECK/);
  });

  it("REQ-008 allows one pending friend request per pair, in either direction", () => {
    const db = emptyDb();
    addPlayer(db, 1);
    addPlayer(db, 2);
    const request = db.prepare(
      "INSERT INTO friend_requests (from_player_id, to_player_id, status, created_at) VALUES (?, ?, ?, 'now')",
    );
    request.run(1, 2, "pending");
    expect(() => request.run(2, 1, "pending")).toThrow(/UNIQUE/);
    request.run(2, 1, "declined");
  });

  it("REQ-008 stores each friendship once, lower player id first", () => {
    const db = emptyDb();
    addPlayer(db, 1);
    addPlayer(db, 2);
    const friendship = db.prepare(
      "INSERT INTO friendships (player_a_id, player_b_id, created_at) VALUES (?, ?, 'now')",
    );
    expect(() => friendship.run(2, 1)).toThrow(/CHECK/);
    friendship.run(1, 2);
  });

  it("AC-006.3 rejects flavor lines longer than 140 characters", () => {
    const db = emptyDb();
    seed(db, fixtureDir("fixture-a"));
    addPlayer(db, 1);
    const instance = db.prepare(
      "INSERT INTO card_instances (expansion_id, card_id, rarity, owner_id, flavor_line, captured_at) VALUES ('fixture-a', 'oak', 'common', 1, ?, 'now')",
    );
    instance.run("🌳".repeat(140));
    expect(() => instance.run("x".repeat(141))).toThrow(/CHECK/);
  });

  it("REQ-002 stores only a hash of the player secret", () => {
    const columns = emptyDb()
      .prepare("SELECT name FROM pragma_table_info('players')")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(["id", "secret_hash", "display_name", "friend_code", "created_at"]);
  });

  it("AC-004.3 stores no image data on card instances", () => {
    const columns = emptyDb()
      .prepare("SELECT name FROM pragma_table_info('card_instances')")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual([
      "id",
      "expansion_id",
      "card_id",
      "rarity",
      "owner_id",
      "flavor_line",
      "captured_at",
    ]);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/server/db/connection.js";
import { findExpansion } from "../../src/server/expansion/repository.js";
import { runSeed, SEED_USAGE } from "../../src/server/seed.js";
import { fixtureDir, repoPath } from "./helpers.js";

const dirs: string[] = [];

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  const lines = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  const code = runSeed(args, env, {
    log: (line) => lines.log.push(line),
    warn: (line) => lines.warn.push(line),
    error: (line) => lines.error.push(line),
  });
  return { code, ...lines };
}

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "tcgrass-seedcmd-"));
  dirs.push(dir);
  return join(dir, "tcgrass.db");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("seed command", () => {
  it("AC-001.1 loads an expansion into DATABASE_PATH and reports the number of cards", () => {
    const path = databasePath();
    const result = run([fixtureDir("fixture-a")], { DATABASE_PATH: path });

    expect(result).toMatchObject({
      code: 0,
      log: ['Loaded expansion "fixture-a": 3 cards.'],
      error: [],
    });
    const db = openDatabase(path);
    expect(findExpansion(db, "fixture-a")?.cards).toHaveLength(3);
    db.close();
  });

  it("AC-001.4 prints a warning per placeholder in placeholder mode", () => {
    const result = run([repoPath("expansions/everyday-nature"), "--placeholders"], {
      DATABASE_PATH: databasePath(),
    });
    expect(result.code).toBe(0);
    expect(result.warn).toHaveLength(15);
    expect(result.warn[0]).toBe(
      "warning: cards.pine: no images/pine.png, using the tree placeholder",
    );
    expect(result.log).toEqual(['Loaded expansion "everyday-nature": 15 cards.']);
  });

  it("AC-001.4 exits 1 naming the cards without art when placeholders are off", () => {
    const result = run([repoPath("expansions/everyday-nature")], { DATABASE_PATH: databasePath() });
    expect(result.code).toBe(1);
    expect(result.error[0]).toMatch(/cards\.pine: missing image images\/pine\.png/);
  });

  it("AC-012.2 exits 1 naming DATABASE_PATH when it is missing", () => {
    const result = run([fixtureDir("fixture-a")], {});
    expect(result).toMatchObject({
      code: 1,
      error: ["Missing or invalid configuration: DATABASE_PATH"],
    });
  });

  it.each([[[]], [["a", "b"]], [["--nope", "a"]]])(
    "exits 2 with usage for arguments %j",
    (args) => {
      expect(run(args, { DATABASE_PATH: databasePath() })).toMatchObject({
        code: 2,
        error: [SEED_USAGE],
      });
    },
  );
});

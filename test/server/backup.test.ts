import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backupDatabase,
  backupDirFor,
  BACKUPS_KEPT,
  pruneBackups,
  startDailyBackups,
} from "../../src/server/backup.js";
import { openDatabase } from "../../src/server/db/connection.js";
import { migrate } from "../../src/server/db/migrate.js";
import { createPlayer } from "../../src/server/players/service.js";
import { memoryLog } from "./helpers.js";

const dirs: string[] = [];

afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "tcgrass-backup-"));
  dirs.push(dir);
  return dir;
}

/** A file-backed, migrated game DB with one player in it. */
function gameDb() {
  const dir = tempDir();
  const db = openDatabase(join(dir, "tcgrass.db"));
  migrate(db);
  createPlayer(db, "Ada");
  return { db, dir };
}

function day(isoDay: string): Date {
  return new Date(`${isoDay}T03:00:00.000Z`);
}

describe("daily SQLite backup (NFR-003)", () => {
  it("NFR-003 writes a backup that opens and holds the game data", async () => {
    const { db, dir } = gameDb();
    const backups = join(dir, "backups");

    const result = await backupDatabase(db, backups, day("2026-10-11"));

    expect(result).toMatchObject({ status: "created", file: "tcgrass-2026-10-11.db" });
    const copy = openDatabase(join(backups, "tcgrass-2026-10-11.db"));
    expect(copy.prepare("SELECT display_name FROM players").all()).toEqual([
      { display_name: "Ada" },
    ]);
    copy.close();
    expect(readdirSync(backups)).toEqual(["tcgrass-2026-10-11.db"]);
  });

  it("NFR-003 replaces a half-written backup left by an interrupted run", async () => {
    const { db, dir } = gameDb();
    const backups = join(dir, "backups");
    mkdirSync(backups);
    writeFileSync(join(backups, "tcgrass-2026-10-10.db.partial"), "cut short");

    await backupDatabase(db, backups, day("2026-10-11"));

    expect(readdirSync(backups)).toEqual(["tcgrass-2026-10-11.db"]);
  });

  it("NFR-002 makes backups readable by the API's user only (they hold secret hashes)", async () => {
    const { db, dir } = gameDb();
    const backups = join(dir, "backups");

    await backupDatabase(db, backups, day("2026-10-11"));

    expect(statSync(backups).mode & 0o777).toBe(0o700);
    expect(statSync(join(backups, "tcgrass-2026-10-11.db")).mode & 0o777).toBe(0o600);
  });

  it("NFR-003 makes one backup per UTC day", async () => {
    const { db, dir } = gameDb();
    const backups = join(dir, "backups");
    await backupDatabase(db, backups, day("2026-10-11"));

    const again = await backupDatabase(db, backups, new Date("2026-10-11T23:59:00.000Z"));

    expect(again).toEqual({ status: "exists", file: "tcgrass-2026-10-11.db" });
  });

  it("NFR-003 keeps the newest 7 backups and leaves other files alone", () => {
    const backups = tempDir();
    for (let n = 1; n <= 9; n += 1) {
      writeFileSync(join(backups, `tcgrass-2026-10-0${n}.db`), "x");
    }
    writeFileSync(join(backups, "notes.txt"), "keep me");

    const removed = pruneBackups(backups);

    expect(BACKUPS_KEPT).toBe(7);
    expect(removed).toEqual(["tcgrass-2026-10-01.db", "tcgrass-2026-10-02.db"]);
    expect(readdirSync(backups).sort()).toEqual([
      "notes.txt",
      ...[3, 4, 5, 6, 7, 8, 9].map((n) => `tcgrass-2026-10-0${n}.db`),
    ]);
  });

  it("NFR-003 puts backups next to the DB on the volume, and none for an in-memory DB", () => {
    expect(backupDirFor("/data/tcgrass.db")).toBe("/data/backups");
    expect(backupDirFor(":memory:")).toBeUndefined();
  });

  it("NFR-003 backs up at start and again when a new UTC day begins", async () => {
    const { db, dir } = gameDb();
    const backups = join(dir, "backups");
    const log = memoryLog();
    let now = day("2026-10-11");

    const job = startDailyBackups({
      db,
      dir: backups,
      logger: log.logger,
      now: () => now,
      intervalMs: 10,
    });
    try {
      await job.ready;
      expect(readdirSync(backups)).toEqual(["tcgrass-2026-10-11.db"]);

      now = day("2026-10-12");
      await expect
        .poll(() => readdirSync(backups).sort())
        .toEqual(["tcgrass-2026-10-11.db", "tcgrass-2026-10-12.db"]);
    } finally {
      await job.stop();
    }
    expect(log.text()).toContain('"event":"backup_done"');
  });

  it("NFR-003 a check during a running backup joins it instead of starting another", async () => {
    const { db, dir } = gameDb();
    const log = memoryLog();
    const job = startDailyBackups({
      db,
      dir: join(dir, "backups"),
      logger: log.logger,
      now: () => day("2026-10-11"),
    });

    await Promise.all([job.ready, job.runNow(), job.runNow()]);
    await job.stop();

    expect(log.lines.filter((line) => line.includes('"event":"backup_done"'))).toHaveLength(1);
  });

  it("NFR-003 logs a failed backup instead of crashing the API", async () => {
    const { db, dir } = gameDb();
    const blocker = join(dir, "not-a-dir");
    writeFileSync(blocker, "a file where the backup folder should be");
    const log = memoryLog();

    const job = startDailyBackups({
      db,
      dir: join(blocker, "backups"),
      logger: log.logger,
      now: () => day("2026-10-11"),
    });
    await job.ready;
    await job.stop();

    expect(log.text()).toContain('"event":"backup_failed"');
  });
});

import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { Db } from "./db/connection.js";
import type { Logger } from "./logger.js";

/** Daily backups kept on the volume (NFR-003); the off-box copy comes with T-017. */
export const BACKUPS_KEPT = 7;

/** How often the job checks whether today's backup exists. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

const BACKUP_FILE = /^tcgrass-\d{4}-\d{2}-\d{2}\.db$/;
const PARTIAL_FILE = /^tcgrass-\d{4}-\d{2}-\d{2}\.db\.partial$/;

export type BackupResult =
  { status: "created"; file: string; bytes: number } | { status: "exists"; file: string };

/** `backups/` next to the database file, i.e. on the Compose volume; none for `:memory:`. */
export function backupDirFor(databasePath: string): string | undefined {
  return databasePath === ":memory:" ? undefined : join(dirname(databasePath), "backups");
}

function backupFileName(now: Date): string {
  return `tcgrass-${now.toISOString().slice(0, 10)}.db`;
}

/**
 * Writes today's (UTC) online backup of the live database into `dir`, unless it exists. The
 * copy is written under a temporary name, synced and renamed when complete, so a half-written
 * file is never mistaken for a backup. Backups hold the players' secret hashes (Confidential),
 * so the folder and files are readable by the API's user only.
 */
export async function backupDatabase(db: Db, dir: string, now = new Date()): Promise<BackupResult> {
  const file = backupFileName(now);
  const target = join(dir, file);
  if (existsSync(target)) {
    return { status: "exists", file };
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Left over from an interrupted run; only this job writes these files.
  readdirSync(dir)
    .filter((name) => PARTIAL_FILE.test(name))
    .forEach((name) => rmSync(join(dir, name), { force: true }));
  const partial = `${target}.partial`;
  await db.backup(partial);
  chmodSync(partial, 0o600);
  const handle = openSync(partial, "r");
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(partial, target);
  return { status: "created", file, bytes: statSync(target).size };
}

/** Deletes all but the newest `keep` backups; other files are never touched. */
export function pruneBackups(dir: string, keep = BACKUPS_KEPT): string[] {
  // The date in the name sorts chronologically.
  const backups = readdirSync(dir)
    .filter((name) => BACKUP_FILE.test(name))
    .sort();
  const removed = backups.slice(0, Math.max(0, backups.length - keep));
  removed.forEach((name) => rmSync(join(dir, name), { force: true }));
  return removed;
}

export interface DailyBackupOptions {
  db: Db;
  dir: string;
  logger: Logger;
  now?: () => Date;
  intervalMs?: number;
}

export interface DailyBackupJob {
  /** Settles when the startup backup has finished or failed. */
  ready: Promise<void>;
  /** Checks now; joins a backup already in progress. */
  runNow: () => Promise<void>;
  /** Stops the timer; settles when a backup in progress has finished, so the DB can close. */
  stop: () => Promise<void>;
}

/**
 * Backs up at startup if today's backup is missing, then checks every hour, so a restart never
 * skips a day and no long timer can drift. A failure is logged and never crashes the API.
 */
export function startDailyBackups({
  db,
  dir,
  logger,
  now = () => new Date(),
  intervalMs = CHECK_INTERVAL_MS,
}: DailyBackupOptions): DailyBackupJob {
  let current: Promise<void> | undefined;
  const run = async (): Promise<void> => {
    try {
      const result = await backupDatabase(db, dir, now());
      if (result.status === "created") {
        const removed = pruneBackups(dir);
        logger.info({ event: "backup_done", file: result.file, bytes: result.bytes, removed });
      }
    } catch (error) {
      logger.error({
        event: "backup_failed",
        error: error instanceof Error ? error.name : "unknown",
        code: error instanceof Error && "code" in error ? String(error.code) : undefined,
      });
    }
  };
  // A check while one is running joins it instead of starting a second backup.
  const check = (): Promise<void> => {
    current ??= run().finally(() => {
      current = undefined;
    });
    return current;
  };
  const timer = setInterval(() => void check(), intervalMs);
  // The job must never keep the process alive on shutdown.
  timer.unref();
  return {
    ready: check(),
    runNow: check,
    stop: () => {
      clearInterval(timer);
      return current ?? Promise.resolve();
    },
  };
}

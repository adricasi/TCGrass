import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { fileURLToPath } from "node:url";

import type { Hono } from "hono";
import { onTestFinished } from "vitest";

import { type AppDeps, type AppEnv, createApp } from "../../src/server/app.js";
import { type Db, openDatabase } from "../../src/server/db/connection.js";
import { migrate } from "../../src/server/db/migrate.js";
import { loadExpansionFolder } from "../../src/server/expansion/load.js";
import { findExpansion, type StoredExpansion } from "../../src/server/expansion/repository.js";
import { seedExpansion } from "../../src/server/expansion/seed.js";
import { createPlayer } from "../../src/server/players/service.js";
import type { Identification, Identifier, Photo } from "../../src/server/identify/client.js";
import { createLogger } from "../../src/server/logger.js";

export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** Collects log lines in memory so tests can assert on them. */
export function memoryLog() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(...chunk.toString("utf8").split("\n").filter(Boolean));
      done();
    },
  });
  const logger = createLogger({ level: "info", destination });
  return { logger, lines, text: () => lines.join("\n") };
}

/** Fake identifier that records each photo and answers with `answer`. */
export function fakeIdentifier(answer: Identification | (() => Promise<Identification>)) {
  const photos: Photo[] = [];
  const identify: Identifier = async (photo) => {
    photos.push(photo);
    return typeof answer === "function" ? answer() : answer;
  };
  return { identify, photos };
}

/** Absolute path inside the repo, independent of the working directory. */
export function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

export function fixtureDir(id: string): string {
  return fileURLToPath(new URL(`../fixtures/expansions/${id}`, import.meta.url));
}

/**
 * Copy of a fixture expansion in a temp dir (removed after the test), without the art of
 * `withoutImages`, so tests can exercise missing-image and placeholder paths. Call it inside
 * a test: cleanup uses `onTestFinished`, which throws in `beforeAll` or a `describe` body.
 */
export function copyFixture(id: string, withoutImages: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "tcgrass-fixture-"));
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const target = join(root, id);
  cpSync(fixtureDir(id), target, { recursive: true });
  for (const cardId of withoutImages) {
    rmSync(join(target, "images", `${cardId}.png`));
  }
  return target;
}

/** A migrated in-memory DB. */
export function emptyDb(): Db {
  const db = openDatabase(":memory:");
  migrate(db);
  return db;
}

/** A migrated in-memory DB with the given fixture expansion seeded. */
export function seededDb(fixture = "fixture-a"): { db: Db; expansion: StoredExpansion } {
  const db = emptyDb();
  seedExpansion(db, loadExpansionFolder(fixtureDir(fixture), { placeholders: false }));
  const expansion = findExpansion(db, fixture);
  if (expansion === undefined) {
    throw new Error(`fixture ${fixture} did not seed`);
  }
  return { db, expansion };
}

export type TestAppOptions = Partial<
  Pick<
    AppDeps,
    | "maxInFlight"
    | "maxUploads"
    | "capturesPerPlayer"
    | "random"
    | "playerCreations"
    | "unknownFriendCodes"
    | "dailyCaps"
  >
>;

/** Creates a player and returns the header that authenticates as them. */
export function playerAuth(db: Db, displayName = "Tester"): Record<string, string> {
  return { authorization: `Bearer ${createPlayer(db, displayName).secret}` };
}

export interface TestApp {
  app: Hono<AppEnv>;
  log: ReturnType<typeof memoryLog>;
  db: Db;
  /** Authorization header of a player created for this app. */
  auth: Record<string, string>;
}

export function testApp(identify: Identifier, options: TestAppOptions = {}): TestApp {
  const log = memoryLog();
  const { db, expansion } = seededDb();
  const app = createApp({ db, expansion, identify, logger: log.logger, ...options });
  return { app, log, db, auth: playerAuth(db) };
}

export function photoForm(bytes: Uint8Array, type = "image/jpeg"): FormData {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), "photo.jpg");
  return form;
}

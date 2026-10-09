import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app.js";
import { openDatabase } from "../../src/server/db/connection.js";
import { migrate } from "../../src/server/db/migrate.js";
import { loadExpansionFolder } from "../../src/server/expansion/load.js";
import { findExpansion } from "../../src/server/expansion/repository.js";
import { seedExpansion } from "../../src/server/expansion/seed.js";
import type { Identification } from "../../src/server/identify/client.js";
import { createLogger } from "../../src/server/logger.js";
import { fakeIdentifier, fixtureDir, photoForm, playerAuth } from "./helpers.js";

const MARKER = "PHOTO-PRIVACY-MARKER-7f3a";
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(MARKER)]);
const MARKER_BYTES = Buffer.from(MARKER);
const MARKER_BASE64 = Buffer.from(PHOTO).toString("base64").slice(0, 20);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe("photos are never stored (REQ-004)", () => {
  it("AC-004.1 leaves no photo bytes in the DB, its WAL or the log file, whatever the outcome", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "tcgrass-privacy-"));
    dirs.push(dataDir);
    const db = openDatabase(join(dataDir, "tcgrass.db"));
    migrate(db);
    seedExpansion(db, loadExpansionFolder(fixtureDir("fixture-a"), { placeholders: false }));
    const expansion = findExpansion(db, "fixture-a");
    if (expansion === undefined) {
      throw new Error("not seeded");
    }
    const logger = createLogger({
      level: "trace",
      filePath: join(dataDir, "logs", "api.log"),
      destination: new PassThrough(),
    });
    const auth = playerAuth(db);

    const answers: (Identification | (() => Promise<Identification>))[] = [
      { outcome: "card", cardId: "oak", confidence: 0.9, flavorLine: "x" },
      { outcome: "none", reason: "no-match" },
      { outcome: "screen" },
      { outcome: "retry", reason: "timeout" },
      () => Promise.reject(new Error(`model crashed on ${MARKER}`)),
    ];
    const received: Uint8Array[] = [];
    for (const answer of answers) {
      const model = fakeIdentifier(answer);
      const app = createApp({ db, expansion, identify: model.identify, logger });
      await app.request("/api/captures", { method: "POST", headers: auth, body: photoForm(PHOTO) });
      received.push(...model.photos.map((photo) => photo.bytes));
    }
    logger.flush();
    db.pragma("wal_checkpoint(PASSIVE)");
    await new Promise((resolve) => setTimeout(resolve, 50));
    db.close();

    // AC-004.2: the photo reached the identifier, and nothing else.
    expect(received).toHaveLength(answers.length);
    const files = filesUnder(dataDir);
    expect(files.some((file) => file.endsWith("api.log"))).toBe(true);
    for (const file of files) {
      const content = readFileSync(file);
      expect(content.includes(MARKER_BYTES), file).toBe(false);
      expect(content.includes(Buffer.from(MARKER_BASE64)), file).toBe(false);
    }
  });
});

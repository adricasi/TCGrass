/**
 * Load check for NFR-005 / AC-003.12: sends N parallel captures from N players through the
 * real API (all limits included) against a stub model that answers after a delay, and reports
 * the status codes. In-memory DB, no network and no inference cost.
 *
 *   npm run load -- [--parallel 5] [--delay-ms 2000] [expansion-dir]
 */
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createApp } from "../src/server/app.js";
import { openDatabase } from "../src/server/db/connection.js";
import { migrate } from "../src/server/db/migrate.js";
import { loadExpansionFolder } from "../src/server/expansion/load.js";
import { findExpansion } from "../src/server/expansion/repository.js";
import { seedExpansion } from "../src/server/expansion/seed.js";
import type { Identifier } from "../src/server/identify/client.js";
import { createLogger } from "../src/server/logger.js";
import { createPlayer } from "../src/server/players/service.js";

/** The smallest byte sequence the API accepts as a JPEG (magic bytes only). */
const STUB_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

export interface LoadOptions {
  parallel: number;
  /** How long the stub model takes to answer. */
  delayMs: number;
  expansionDir?: string;
}

export interface LoadReport {
  /** Count of responses per HTTP status. */
  statuses: Record<number, number>;
  serverErrors: number;
  /** 503 `busy` answers: the in-flight cap turned the capture away (AC-003.12). */
  busy: number;
  latenciesMs: number[];
}

export async function runLoad({
  parallel,
  delayMs,
  expansionDir = "expansions/everyday-nature",
}: LoadOptions): Promise<LoadReport> {
  const db = openDatabase(":memory:");
  try {
    migrate(db);
    const loaded = loadExpansionFolder(expansionDir, { placeholders: true });
    seedExpansion(db, loaded);
    const expansion = findExpansion(db, loaded.expansion.id);
    const cardId = expansion?.cards[0]?.id;
    if (expansion === undefined || cardId === undefined) {
      throw new Error(`Expansion in ${expansionDir} did not seed`);
    }
    const identify: Identifier = async () => {
      await sleep(delayMs);
      return { outcome: "card", cardId, confidence: 0.9, flavorLine: null };
    };
    const app = createApp({ db, expansion, identify, logger: createLogger({ level: "error" }) });
    const secrets = Array.from({ length: parallel }, (_, n) => createPlayer(db, `Load ${n + 1}`));

    const results = await Promise.all(
      secrets.map(async ({ secret }) => {
        const form = new FormData();
        form.append("photo", new Blob([STUB_JPEG], { type: "image/jpeg" }), "photo.jpg");
        const started = performance.now();
        const response = await app.request("/api/captures", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: form,
        });
        const body = (await response.json()) as { error?: { code?: string } };
        return {
          status: response.status,
          busy: response.status === 503 && body.error?.code === "busy",
          latencyMs: Math.round(performance.now() - started),
        };
      }),
    );

    const statuses: Record<number, number> = {};
    for (const { status } of results) {
      statuses[status] = (statuses[status] ?? 0) + 1;
    }
    return {
      statuses,
      serverErrors: results.filter(({ status, busy }) => status >= 500 && !busy).length,
      busy: results.filter(({ busy }) => busy).length,
      latenciesMs: results.map(({ latencyMs }) => latencyMs).sort((a, b) => a - b),
    };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      parallel: { type: "string", default: "5" },
      "delay-ms": { type: "string", default: "2000" },
    },
  });
  const parallel = Number(values.parallel);
  const delayMs = Number(values["delay-ms"]);
  if (!Number.isInteger(parallel) || parallel < 1 || !Number.isFinite(delayMs) || delayMs < 0) {
    console.error(
      "Usage: npm run load -- [--parallel <n ≥ 1>] [--delay-ms <ms ≥ 0>] [expansion-dir]",
    );
    process.exit(2);
  }
  const report = await runLoad({
    parallel,
    delayMs,
    ...(positionals[0] === undefined ? {} : { expansionDir: positionals[0] }),
  });
  console.log(`Parallel captures: ${parallel}, stub model delay: ${delayMs} ms`);
  console.log(`Statuses:          ${JSON.stringify(report.statuses)}`);
  console.log(`Busy (503, AC-003.12): ${report.busy}`);
  console.log(`Other 5xx:         ${report.serverErrors}`);
  console.log(`Latency (ms):      ${report.latenciesMs.join(", ")}`);
  if (report.serverErrors > 0) {
    process.exitCode = 1;
  }
}

// Run only as a script, not when a test imports runLoad.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

/**
 * T-001 identification spike (not run in CI; the human runs it against the real endpoint).
 *
 *   npx tsx scripts/spike-identify.ts <photo-dir> [expansion-dir]
 *
 * Photos are labelled by file name: `<label>--<anything>.jpg|png|webp`, where label is a
 * catalogue card id, `none` (a subject not in the catalogue) or `screen` (a screen, print or
 * drawing). Reads INFERENCE_* and IDENTIFY_MIN_CONFIDENCE from the environment.
 * Prints per-photo results, accuracy, parse rate, screen rejection rate and every flavor
 * line so they can be checked for quoted text by hand.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/server/config.js";
import { readExpansionFile } from "../src/server/expansion/parse.js";
import {
  identifyPhoto,
  type Identification,
  type PhotoInput,
} from "../src/server/identify/client.js";

const MIME: Record<string, PhotoInput["mimeType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function expectedOutcome(label: string): string {
  return label === "none" || label === "screen" ? label : `card:${label}`;
}

function actualOutcome(r: Identification): string {
  return r.outcome === "card" ? `card:${r.cardId}` : r.outcome;
}

async function main(): Promise<void> {
  const [photoDir, expansionDir = "expansions/everyday-nature"] = process.argv.slice(2);
  if (!photoDir) {
    console.error("usage: npx tsx scripts/spike-identify.ts <photo-dir> [expansion-dir]");
    process.exitCode = 2;
    return;
  }

  const config = loadConfig();
  const expansion = await readExpansionFile(expansionDir);
  const catalogue = {
    instructions: expansion.identification.instructions,
    cards: expansion.cards,
  };

  const files = (await readdir(photoDir))
    .filter((f) => MIME[path.extname(f).toLowerCase()] !== undefined)
    .sort();

  let correct = 0;
  let parseable = 0;
  let screens = 0;
  let screensRejected = 0;
  const latencies: number[] = [];

  for (const file of files) {
    const label = file.split("--")[0] ?? "";
    const mimeType = MIME[path.extname(file).toLowerCase()];
    if (!mimeType) continue;
    const bytes = await readFile(path.join(photoDir, file));
    const started = performance.now();
    const result = await identifyPhoto(
      config.inference,
      catalogue,
      { bytes, mimeType },
      config.identifyMinConfidence,
    );
    const ms = Math.round(performance.now() - started);
    latencies.push(ms);

    const expected = expectedOutcome(label);
    const actual = actualOutcome(result);
    const ok = expected === actual;
    if (ok) correct += 1;
    if (!(result.outcome === "none" && result.reason === "invalid")) {
      if (result.outcome !== "retry") parseable += 1;
    }
    if (label === "screen") {
      screens += 1;
      if (result.outcome === "screen") screensRejected += 1;
    }
    const flavor = result.outcome === "card" ? (result.flavorLine ?? "") : "";
    console.log(
      `${ok ? "OK  " : "MISS"} ${file}: expected ${expected}, got ${actual} (${ms} ms)${flavor ? ` — "${flavor}"` : ""}`,
    );
  }

  const n = files.length;
  const pct = (a: number, b: number): string =>
    b === 0 ? "n/a" : `${((100 * a) / b).toFixed(0)} %`;
  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.max(0, Math.ceil(0.95 * n) - 1)] ?? 0;
  console.log("");
  console.log(`photos:            ${n}`);
  console.log(`correct outcomes:  ${correct}/${n} (${pct(correct, n)}; target ≥ 80 %)`);
  console.log(`parseable answers: ${parseable}/${n} (${pct(parseable, n)}; target 100 %)`);
  console.log(
    `screens rejected:  ${screensRejected}/${screens} (${pct(screensRejected, screens)})`,
  );
  console.log(`latency p95:       ${p95} ms`);
}

await main();

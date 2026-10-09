/**
 * Identification spike (T-001): runs a folder of labelled photos through the configured
 * inference endpoint and prints accuracy, parse rate, screen rejection and latency.
 *
 * Usage: npm run spike -- <photos-dir> [expansion-dir] [--timeout-ms <ms>]
 *   <photos-dir>/<card id>/*.jpg   photos of catalogue subjects (expected outcome: that card)
 *   <photos-dir>/none/*.jpg        non-catalogue subjects (expected: none)
 *   <photos-dir>/screen/*.jpg      screens, prints, drawings (expected: screen)
 * Photos must be JPEG, PNG or WebP; downscale them to <= 1024 px on the long edge first, as
 * the app does (e.g. `mogrify -resize '1024x1024>' *.jpg`). Reads the INFERENCE_* settings
 * from the environment (or `.env`). `--timeout-ms` overrides the app's 30-s limit to measure a
 * slow model's accuracy separately from its speed. Not run in CI: it calls the real endpoint.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";

import { loadConfig } from "../src/server/config.js";
import { parseExpansionYaml } from "../src/server/expansion/parse.js";
import {
  createIdentifier,
  IDENTIFY_TIMEOUT_MS,
  type Identification,
  type PhotoMimeType,
} from "../src/server/identify/client.js";

const MIME_TYPES: Record<string, PhotoMimeType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface Result {
  file: string;
  expected: string;
  identification: Identification;
  latencyMs: number;
}

function describeOutcome(identification: Identification): string {
  switch (identification.outcome) {
    case "card":
      return `${identification.cardId} (${identification.confidence.toFixed(2)})`;
    case "screen":
      return "screen";
    case "none":
    case "retry":
      return `${identification.outcome} [${identification.reason}]`;
  }
}

function isCorrect(result: Result): boolean {
  const { identification, expected } = result;
  if (identification.outcome === "card") {
    return identification.cardId === expected;
  }
  if (identification.outcome === "none" && identification.reason === "invalid-answer") {
    // An unparseable answer is a model failure, even on a photo that should give "none".
    return false;
  }
  return identification.outcome === expected;
}

function percentile(sortedValues: number[], fraction: number): number {
  const index = Math.min(sortedValues.length - 1, Math.ceil(fraction * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)] ?? 0;
}

function percent(count: number, total: number): string {
  return total === 0 ? "n/a" : `${((100 * count) / total).toFixed(0)} % (${count}/${total})`;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { "timeout-ms": { type: "string" } },
  });
  const [photosDir, expansionDir = "expansions/everyday-nature"] = positionals;
  const timeoutMs =
    values["timeout-ms"] === undefined ? IDENTIFY_TIMEOUT_MS : Number(values["timeout-ms"]);
  if (photosDir === undefined || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    console.error("Usage: npm run spike -- <photos-dir> [expansion-dir] [--timeout-ms <ms>]");
    process.exit(2);
  }

  const config = loadConfig(process.env);
  const expansion = parseExpansionYaml(readFileSync(join(expansionDir, "expansion.yaml"), "utf8"));
  const catalogueIds = new Set(expansion.cards.map((card) => card.id));
  const identify = createIdentifier({ config, expansion, timeoutMs });

  console.log(
    `Endpoint: ${config.inference.baseUrl} · model: ${config.inference.model} · timeout: ${timeoutMs} ms`,
  );
  console.log(`Expansion: ${expansion.id} (${catalogueIds.size} cards)\n`);

  const results: Result[] = [];
  for (const label of readdirSync(photosDir).sort()) {
    const labelDir = join(photosDir, label);
    if (!statSync(labelDir).isDirectory()) {
      continue;
    }
    if (label !== "none" && label !== "screen" && !catalogueIds.has(label)) {
      console.warn(`! skipping folder "${label}": not a catalogue id, "none" or "screen"`);
      continue;
    }
    for (const fileName of readdirSync(labelDir).sort()) {
      const file = join(label, fileName);
      const mimeType = MIME_TYPES[extname(fileName).toLowerCase()];
      if (mimeType === undefined) {
        console.warn(`! skipping ${file}: not JPEG, PNG or WebP`);
        continue;
      }
      const bytes = readFileSync(join(labelDir, fileName));
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        console.warn(`! ${file} is over 5 MB: the app would reject it; downscale it first`);
      }
      const started = performance.now();
      const identification = await identify({ bytes, mimeType });
      const result = {
        file,
        expected: label,
        identification,
        latencyMs: performance.now() - started,
      };
      results.push(result);
      console.log(
        `${isCorrect(result) ? "✓" : "✗"} ${file.padEnd(32)} expected ${label.padEnd(12)} ` +
          `got ${describeOutcome(identification).padEnd(28)} ${result.latencyMs.toFixed(0)} ms`,
      );
    }
  }

  const correct = results.filter(isCorrect).length;
  const answered = results.filter((result) => result.identification.outcome !== "retry");
  const parsed = answered.filter(
    (result) =>
      !(
        result.identification.outcome === "none" &&
        result.identification.reason === "invalid-answer"
      ),
  );
  const screens = results.filter((result) => result.expected === "screen");
  const nonCatalogue = results.filter((result) => result.expected === "none");
  const catalogue = results.filter((result) => catalogueIds.has(result.expected));
  const latencies = answered.map((result) => result.latencyMs).sort((a, b) => a - b);

  console.log("\n=== Spike report ===");
  console.log(`Correct outcomes:        ${percent(correct, results.length)}   (target >= 80 %)`);
  console.log(
    `  catalogue matched:     ${percent(catalogue.filter(isCorrect).length, catalogue.length)}`,
  );
  console.log(
    `  non-catalogue -> none: ${percent(nonCatalogue.filter(isCorrect).length, nonCatalogue.length)}`,
  );
  console.log(
    `  screen rejected:       ${percent(screens.filter(isCorrect).length, screens.length)}`,
  );
  console.log(
    `Parseable answers:       ${percent(parsed.length, answered.length)}   (target 100 %)`,
  );
  console.log(`Retries (timeout/error): ${results.length - answered.length}`);
  console.log(
    `Latency p50 / p95:       ${percentile(latencies, 0.5).toFixed(0)} ms / ` +
      `${percentile(latencies, 0.95).toFixed(0)} ms`,
  );

  console.log("\nFlavor lines (check none quotes text from the photo or describes people/places):");
  for (const result of results) {
    if (result.identification.outcome === "card") {
      console.log(`- ${result.file}: ${result.identification.flavorLine ?? "(none)"}`);
    }
  }
}

await main();

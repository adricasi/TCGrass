import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { ExpansionFileSchema, type ExpansionFile } from "../../shared/expansion.js";

export class ExpansionError extends Error {
  override name = "ExpansionError";
}

/** Describe one validation issue, naming the card and field (AC-001.2, AC-001.3). */
function describeIssue(raw: unknown, issue: z.core.$ZodIssue): string {
  const [first, index, field] = issue.path;
  if (first === "cards" && typeof index === "number") {
    const cards = (raw as { cards?: unknown }).cards;
    const card: unknown = Array.isArray(cards) ? cards[index] : undefined;
    const id =
      typeof card === "object" && card !== null && "id" in card && typeof card.id === "string"
        ? card.id
        : `#${index + 1}`;
    return `card "${id}" field ${field === undefined ? "(card)" : String(field)}: ${issue.message}`;
  }
  const where = issue.path.length > 0 ? issue.path.join(".") : "expansion";
  return `${where}: ${issue.message}`;
}

/** Parse and validate expansion YAML text. Throws ExpansionError listing every problem. */
export function parseExpansion(text: string): ExpansionFile {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ExpansionError(`expansion.yaml is not valid YAML: ${(err as Error).message}`);
  }
  const result = ExpansionFileSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map((i) => describeIssue(raw, i));
    throw new ExpansionError(`Invalid expansion:\n- ${problems.join("\n- ")}`);
  }
  return result.data;
}

/** Read `<dir>/expansion.yaml` and validate it. */
export async function readExpansionFile(dir: string): Promise<ExpansionFile> {
  const file = path.join(dir, "expansion.yaml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new ExpansionError(`Cannot read ${file}`);
  }
  return parseExpansion(text);
}

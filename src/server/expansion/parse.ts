import { parse } from "yaml";

import { type Expansion, expansionSchema } from "../../shared/expansion.js";

export class ExpansionError extends Error {
  override name = "ExpansionError";
}

/** Parses and validates the text of an `expansion.yaml`, naming every problem found. */
export function parseExpansionYaml(text: string): Expansion {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ExpansionError(`expansion.yaml is not valid YAML: ${String(error)}`);
  }
  const result = expansionSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ExpansionError(`expansion.yaml is invalid:\n- ${problems.join("\n- ")}`);
  }
  return result.data;
}

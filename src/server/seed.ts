import { parseArgs } from "node:util";

import { ConfigError, loadDatabasePath } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { loadExpansionFolder } from "./expansion/load.js";
import { ExpansionError } from "./expansion/parse.js";
import { seedExpansion } from "./expansion/seed.js";

export const SEED_USAGE = "Usage: npm run seed -- <expansion-dir> [--placeholders]";

export interface SeedOutput {
  log: (line: string) => void;
  warn: (line: string) => void;
  error: (line: string) => void;
}

/**
 * The seed command (REQ-001): validates an expansion folder and stores it. Returns the exit
 * code: 0 loaded, 1 invalid expansion or config, 2 bad arguments.
 */
export function runSeed(args: string[], env: NodeJS.ProcessEnv, out: SeedOutput): number {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { placeholders: { type: "boolean", default: false } },
    });
  } catch {
    out.error(SEED_USAGE);
    return 2;
  }
  const [directory, ...extra] = parsed.positionals;
  if (directory === undefined || extra.length > 0) {
    out.error(SEED_USAGE);
    return 2;
  }

  try {
    const loaded = loadExpansionFolder(directory, { placeholders: parsed.values.placeholders });
    const db = openDatabase(loadDatabasePath(env));
    try {
      migrate(db);
      const result = seedExpansion(db, loaded);
      loaded.warnings.forEach((warning) => {
        out.warn(`warning: ${warning}`);
      });
      if (result.cardsRemoved.length > 0) {
        out.log(`Removed unowned cards: ${result.cardsRemoved.join(", ")}`);
      }
      out.log(`Loaded expansion "${result.expansionId}": ${result.cardsLoaded} cards.`);
      return 0;
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof ConfigError || error instanceof ExpansionError) {
      out.error(error.message);
      return 1;
    }
    throw error;
  }
}

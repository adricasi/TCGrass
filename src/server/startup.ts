import type { Hono } from "hono";

import { type AppEnv, createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { type Db, openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { ExpansionError } from "./expansion/parse.js";
import { findExpansion, type StoredExpansion } from "./expansion/repository.js";
import { createIdentifier } from "./identify/client.js";
import type { Logger } from "./logger.js";

export interface Started {
  app: Hono<AppEnv>;
  db: Db;
  expansion: StoredExpansion;
}

/**
 * Opens and migrates the DB, then builds the app for the active expansion. Refuses to start,
 * naming the expansion, if it has not been seeded (AC-012.3).
 */
export function bootstrap(config: ServerConfig, logger: Logger): Started {
  const db = openDatabase(config.databasePath);
  try {
    migrate(db);
    const expansion = findExpansion(db, config.activeExpansion);
    if (expansion === undefined) {
      throw new ExpansionError(
        `Active expansion "${config.activeExpansion}" is not loaded in the database. ` +
          `Run: npm run seed -- expansions/${config.activeExpansion}`,
      );
    }
    const identify = createIdentifier({ config, expansion: expansion.expansion });
    return { app: createApp({ db, expansion, identify, logger }), db, expansion };
  } catch (error) {
    db.close();
    throw error;
  }
}

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Db } from "./connection.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const MIGRATION_FILE = /^(\d{3})-[a-z0-9-]+\.sql$/;

interface Migration {
  version: number;
  sql: string;
}

function readMigrations(directory: string): Migration[] {
  const migrations = readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort()
    .map((name) => ({
      name,
      version: Number(MIGRATION_FILE.exec(name)?.[1]),
      sql: readFileSync(`${directory}${name}`, "utf8"),
    }));
  migrations.forEach((migration, index) => {
    const previous = migrations[index - 1];
    if (previous !== undefined && previous.version === migration.version) {
      // The second file would be skipped silently, since user_version already covers it.
      throw new Error(`Migrations ${previous.name} and ${migration.name} share a version`);
    }
  });
  return migrations;
}

/**
 * Applies pending migrations in order, each in its own transaction, tracking the schema
 * version in `PRAGMA user_version` (design.md § Data model). Returns the new version.
 */
export function migrate(db: Db, directory = MIGRATIONS_DIR): number {
  let current = db.pragma("user_version", { simple: true }) as number;
  for (const migration of readMigrations(directory)) {
    if (migration.version <= current) {
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    }).immediate();
    current = migration.version;
  }
  return current;
}

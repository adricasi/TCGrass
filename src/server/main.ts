import type { Server } from "node:http";

import { serve } from "@hono/node-server";

import { backupDirFor, startDailyBackups } from "./backup.js";
import { ConfigError, loadServerConfig } from "./config.js";
import { ExpansionError } from "./expansion/parse.js";
import { createLogger } from "./logger.js";
import { bootstrap } from "./startup.js";

function start(): void {
  const config = loadServerConfig(process.env);
  const logger = createLogger({ level: config.logLevel, filePath: config.logFilePath });
  const { app, db, expansion } = bootstrap(config, logger);
  // Daily backup on the volume, next to the DB (NFR-003).
  const backupDir = backupDirFor(config.databasePath);
  const backups =
    backupDir === undefined ? undefined : startDailyBackups({ db, dir: backupDir, logger });

  // Plain HTTP/1.1 behind Caddy, so the returned server is a node:http Server.
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ event: "listening", port: info.port, expansion: expansion.expansion.id });
  }) as Server;

  // A slow or stalled upload cannot hold a connection (and its buffered body) for long.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  const stop = () => {
    server.close(() => {
      // Let a backup in progress finish before the DB closes under it (NFR-003).
      void (backups?.stop() ?? Promise.resolve()).finally(() => {
        db.close();
        // The file stream is async: flush it so the last request lines reach the volume.
        logger.flush();
        process.exit(0);
      });
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

try {
  start();
} catch (error) {
  if (error instanceof ConfigError || error instanceof ExpansionError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

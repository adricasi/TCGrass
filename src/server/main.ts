import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { ConfigError, loadServerConfig } from "./config.js";
import { ExpansionError, parseExpansionYaml } from "./expansion/parse.js";
import { createIdentifier } from "./identify/client.js";
import { createLogger } from "./logger.js";

function start(): void {
  const config = loadServerConfig(process.env);
  const logger = createLogger({ level: config.logLevel, filePath: config.logFilePath });

  // Until T-003 adds the DB, the active expansion is read from its folder. The id comes
  // from config (validated as a slug), never from a request.
  const expansionFile = join("expansions", config.activeExpansion, "expansion.yaml");
  if (!existsSync(expansionFile)) {
    throw new ExpansionError(
      `Active expansion "${config.activeExpansion}" not found at ${expansionFile}`,
    );
  }
  const expansion = parseExpansionYaml(readFileSync(expansionFile, "utf8"));

  const app = createApp({ identify: createIdentifier({ config, expansion }), logger });
  // Plain HTTP/1.1 behind Caddy, so the returned server is a node:http Server.
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ event: "listening", port: info.port, expansion: expansion.id });
  }) as Server;

  // A slow or stalled upload cannot hold a connection (and its buffered body) for long.
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;

  const stop = () => {
    server.close(() => {
      // The file stream is async: flush it so the last request lines reach the volume.
      logger.flush();
      process.exit(0);
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

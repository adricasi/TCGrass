import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger };

/**
 * Any field whose name matches is replaced, at any depth (NFR-007, design § Reliability:
 * `authorization`, `photo`, any `*key*`/`*secret*`). Routes never log bodies or headers;
 * this is the safety net if one ever does.
 */
export const SENSITIVE_KEY = /key|secret|authorization|cookie|token|password|photo/i;
const REDACTED = "[redacted]";

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : scrub(item, depth + 1),
    ]),
  );
}

export interface LoggerOptions {
  level: string;
  /** Also append JSON lines to this file (on the volume in production). */
  filePath?: string | undefined;
  /** Replaces stdout; used by tests to capture log lines. */
  destination?: DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  // Each stream needs the level too, or multistream drops everything below "info".
  const level = options.level;
  const streams = [{ level, stream: options.destination ?? process.stdout }];
  if (options.filePath !== undefined) {
    const file = pino.destination({ dest: options.filePath, mkdir: true, sync: false });
    streams.push({ level, stream: file });
  }
  return pino(
    {
      level,
      base: null,
      formatters: { log: (object) => scrub(object) as Record<string, unknown> },
    },
    pino.multistream(streams),
  );
}

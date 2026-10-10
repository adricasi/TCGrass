import { z } from "zod";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Treats `KEY=` (empty or blank, as in a copied `.env.example`) as unset. */
const emptyAsUnset = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Hosts where plain HTTP never leaves the machine or the private network (AC-004.4). */
function isLocalOrPrivateHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "host.docker.internal" ||
    !hostname.includes(".") || // Compose service name, e.g. http://ollama:11434
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

// Refinements run even when `z.url` already failed, so they must tolerate unparseable input.
const inferenceUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = URL.parse(value);
    return url === null || (url.username === "" && url.password === "");
  }, "must not contain credentials")
  .refine((value) => {
    const url = URL.parse(value);
    return url === null || url.protocol === "https:" || isLocalOrPrivateHost(url.hostname);
  }, "must use https unless the host is local or on a private network");

const configSchema = z.object({
  INFERENCE_BASE_URL: inferenceUrl,
  INFERENCE_MODEL: z.string().trim().min(1),
  INFERENCE_API_KEY: z.preprocess(emptyAsUnset, z.string().optional()),
  IDENTIFY_MIN_CONFIDENCE: z.preprocess(emptyAsUnset, z.coerce.number().min(0).max(1).default(0.5)),
});

const serverConfigSchema = configSchema.extend({
  ACTIVE_EXPANSION: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65_535).default(3000)),
  LOG_LEVEL: z.preprocess(
    emptyAsUnset,
    z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  ),
  LOG_FILE_PATH: z.preprocess(emptyAsUnset, z.string().optional()),
  DATABASE_PATH: z.string().trim().min(1),
  TRUST_PROXY: z.preprocess(emptyAsUnset, z.enum(["true", "false"]).default("false")),
  INFERENCE_DAILY_CALL_LIMIT: z.preprocess(
    emptyAsUnset,
    // 0 pauses captures (kill switch); the upper bound stops a typo from multiplying spend.
    z.coerce.number().int().nonnegative().max(100_000).default(3000),
  ),
  CAPTURES_PER_PLAYER_PER_DAY: z.preprocess(
    emptyAsUnset,
    z.coerce.number().int().nonnegative().max(1_000).default(30),
  ),
});

const databaseConfigSchema = z.object({ DATABASE_PATH: z.string().trim().min(1) });

export interface Config {
  inference: {
    baseUrl: string;
    model: string;
    apiKey: string | undefined;
  };
  identifyMinConfidence: number;
}

export interface ServerConfig extends Config {
  activeExpansion: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  logFilePath: string | undefined;
  databasePath: string;
  /** Read client IPs from X-Forwarded-For: set only behind Caddy (design § Security). */
  trustProxy: boolean;
  /** Daily model-call caps (NFR-012). */
  dailyCaps: { global: number; perPlayer: number };
}

/**
 * Parses with `schema` or throws naming the invalid keys only, never their values, because
 * some of them are secrets (AC-012.2).
 */
function parseEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.output<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`Missing or invalid configuration: ${keys.join(", ")}`);
  }
  return result.data;
}

function toConfig(parsed: z.output<typeof configSchema>): Config {
  return {
    inference: {
      baseUrl: parsed.INFERENCE_BASE_URL.replace(/\/+$/, ""),
      model: parsed.INFERENCE_MODEL,
      apiKey: parsed.INFERENCE_API_KEY,
    },
    identifyMinConfidence: parsed.IDENTIFY_MIN_CONFIDENCE,
  };
}

/** Inference settings only, for tools such as the spike script (AC-012.1, AC-012.2). */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return toConfig(parseEnv(configSchema, env));
}

/** Everything the API server needs, parsed once at startup (AC-012.1, AC-012.2). */
export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const parsed = parseEnv(serverConfigSchema, env);
  return {
    ...toConfig(parsed),
    activeExpansion: parsed.ACTIVE_EXPANSION,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    logFilePath: parsed.LOG_FILE_PATH,
    databasePath: parsed.DATABASE_PATH,
    trustProxy: parsed.TRUST_PROXY === "true",
    dailyCaps: {
      global: parsed.INFERENCE_DAILY_CALL_LIMIT,
      perPlayer: parsed.CAPTURES_PER_PLAYER_PER_DAY,
    },
  };
}

/** Only the database location, for the seed command. */
export function loadDatabasePath(env: NodeJS.ProcessEnv): string {
  return parseEnv(databaseConfigSchema, env).DATABASE_PATH;
}

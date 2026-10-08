import { z } from "zod";

import { ID_PATTERN } from "../shared/expansion.js";

const ConfigSchema = z.object({
  INFERENCE_BASE_URL: z.url({ protocol: /^https?$/ }),
  INFERENCE_MODEL: z.string().trim().min(1),
  INFERENCE_API_KEY: z.string().min(1).optional(),
  IDENTIFY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  ACTIVE_EXPANSION: z.string().regex(ID_PATTERN).default("everyday-nature"),
  DATABASE_PATH: z.string().min(1).default(".dev/tcgrass.db"),
  LOG_FILE_PATH: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  inference: { baseUrl: string; model: string; apiKey: string | undefined };
  identifyMinConfidence: number;
  activeExpansion: string;
  databasePath: string;
  logFilePath: string | undefined;
  port: number;
  logLevel: z.infer<typeof ConfigSchema>["LOG_LEVEL"];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Parse settings from the environment once at startup (AC-012.1, AC-012.2).
 * On failure the error names each missing or invalid key but never prints a value.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const input: Record<string, string> = {};
  for (const key of Object.keys(ConfigSchema.shape)) {
    const value = env[key];
    if (value !== undefined && value.trim() !== "") input[key] = value;
  }

  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? "configuration");
      return `${key} (${key in input ? "invalid" : "missing"})`;
    });
    throw new ConfigError(`Invalid configuration: ${[...new Set(problems)].join(", ")}`);
  }

  const c = parsed.data;
  return {
    inference: {
      baseUrl: c.INFERENCE_BASE_URL.replace(/\/+$/, ""),
      model: c.INFERENCE_MODEL,
      apiKey: c.INFERENCE_API_KEY,
    },
    identifyMinConfidence: c.IDENTIFY_MIN_CONFIDENCE,
    activeExpansion: c.ACTIVE_EXPANSION,
    databasePath: c.DATABASE_PATH,
    logFilePath: c.LOG_FILE_PATH,
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
  };
}

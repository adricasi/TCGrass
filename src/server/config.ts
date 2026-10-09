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

export interface Config {
  inference: {
    baseUrl: string;
    model: string;
    apiKey: string | undefined;
  };
  identifyMinConfidence: number;
}

/**
 * Parses the environment once at startup (AC-012.1, AC-012.2). Errors name the invalid
 * keys only, never their values, because some of them are secrets.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new ConfigError(`Missing or invalid configuration: ${keys.join(", ")}`);
  }
  const parsed = result.data;
  return {
    inference: {
      baseUrl: parsed.INFERENCE_BASE_URL.replace(/\/+$/, ""),
      model: parsed.INFERENCE_MODEL,
      apiKey: parsed.INFERENCE_API_KEY,
    },
    identifyMinConfidence: parsed.IDENTIFY_MIN_CONFIDENCE,
  };
}

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig, loadServerConfig } from "../../src/server/config.js";

const validEnv = {
  INFERENCE_BASE_URL: "https://inference.example.test/v1/",
  INFERENCE_MODEL: "gemma-3-12b-it",
  INFERENCE_API_KEY: "sk-very-secret-value",
};

describe("loadConfig", () => {
  it("AC-012.1 reads the inference endpoint, model and API key from the environment", () => {
    const config = loadConfig(validEnv);
    expect(config.inference).toEqual({
      baseUrl: "https://inference.example.test/v1",
      model: "gemma-3-12b-it",
      apiKey: "sk-very-secret-value",
    });
    expect(config.identifyMinConfidence).toBe(0.5);
  });

  it("AC-012.1 treats the API key as optional (e.g. local Ollama)", () => {
    const config = loadConfig({ ...validEnv, INFERENCE_API_KEY: "" });
    expect(config.inference.apiKey).toBeUndefined();
  });

  it("AC-012.1 reads a custom confidence threshold", () => {
    expect(loadConfig({ ...validEnv, IDENTIFY_MIN_CONFIDENCE: "0.7" }).identifyMinConfidence).toBe(
      0.7,
    );
  });

  it.each(["", "  "])("AC-012.1 uses the default threshold when it is blank (%j)", (value) => {
    expect(loadConfig({ ...validEnv, IDENTIFY_MIN_CONFIDENCE: value }).identifyMinConfidence).toBe(
      0.5,
    );
  });

  it("AC-012.1 treats a blank API key as unset", () => {
    expect(loadConfig({ ...validEnv, INFERENCE_API_KEY: "   " }).inference.apiKey).toBeUndefined();
  });

  it.each([
    "http://localhost:11434/v1",
    "http://127.0.0.1:8000/v1",
    "http://ollama:11434/v1",
    "http://10.114.0.3:8000/v1",
    "http://172.20.0.5:8000/v1",
    "http://192.168.1.20:11434/v1",
  ])("AC-012.1 accepts plain http for a local or private host (%s)", (url) => {
    expect(loadConfig({ ...validEnv, INFERENCE_BASE_URL: url }).inference.baseUrl).toBe(url);
  });

  it.each([
    ["INFERENCE_BASE_URL", { INFERENCE_BASE_URL: "http://inference.example.test/v1" }],
    ["INFERENCE_BASE_URL", { INFERENCE_BASE_URL: "http://172.32.0.1/v1" }],
    ["INFERENCE_BASE_URL", { INFERENCE_BASE_URL: undefined }],
    ["INFERENCE_BASE_URL", { INFERENCE_BASE_URL: "not a url" }],
    ["INFERENCE_BASE_URL", { INFERENCE_BASE_URL: "ftp://inference.example.test" }],
    ["INFERENCE_MODEL", { INFERENCE_MODEL: "" }],
    ["IDENTIFY_MIN_CONFIDENCE", { IDENTIFY_MIN_CONFIDENCE: "1.5" }],
    ["IDENTIFY_MIN_CONFIDENCE", { IDENTIFY_MIN_CONFIDENCE: "high" }],
  ])("AC-012.2 refuses to start and names %s when it is missing or malformed", (key, override) => {
    expect(() => loadConfig({ ...validEnv, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...validEnv, ...override })).toThrow(key);
  });

  it("AC-012.2 never prints secret values in the error", () => {
    const env = {
      ...validEnv,
      INFERENCE_BASE_URL: "https://user:pw@inference.example.test/v1",
      INFERENCE_MODEL: "",
    };
    let message = "";
    try {
      loadConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("INFERENCE_BASE_URL");
    expect(message).toContain("INFERENCE_MODEL");
    expect(message).not.toContain("sk-very-secret-value");
    expect(message).not.toContain("user:pw");
  });
});

describe("loadServerConfig", () => {
  const serverEnv = {
    ...validEnv,
    ACTIVE_EXPANSION: "everyday-nature",
    DATABASE_PATH: ".dev/test.db",
  };

  it("AC-012.1 reads the server settings with defaults", () => {
    const config = loadServerConfig(serverEnv);
    expect(config).toMatchObject({
      activeExpansion: "everyday-nature",
      port: 3000,
      logLevel: "info",
      logFilePath: undefined,
      databasePath: ".dev/test.db",
      trustProxy: false,
      dailyCaps: { global: 3000, perPlayer: 30 },
    });
    expect(config.inference.model).toBe("gemma-3-12b-it");
  });

  it("NFR-012 reads the daily caps", () => {
    expect(
      loadServerConfig({
        ...serverEnv,
        INFERENCE_DAILY_CALL_LIMIT: "500",
        CAPTURES_PER_PLAYER_PER_DAY: "12",
      }).dailyCaps,
    ).toEqual({ global: 500, perPlayer: 12 });
  });

  it.each([
    [undefined, 5],
    ["", 5],
    ["0", 0],
    ["0.5", 0.5],
    ["168", 168],
  ])("AC-014.4 reads CAPTURE_COOLDOWN_HOURS %j as %j hours", (value, hours) => {
    expect(
      loadServerConfig({ ...serverEnv, CAPTURE_COOLDOWN_HOURS: value }).captureCooldownHours,
    ).toBe(hours);
  });

  it.each(["-1", "168.5", "abc", "Infinity"])(
    "AC-014.4 refuses to start with CAPTURE_COOLDOWN_HOURS=%j and names the setting",
    (value) => {
      expect(() => loadServerConfig({ ...serverEnv, CAPTURE_COOLDOWN_HOURS: value })).toThrow(
        new ConfigError("Missing or invalid configuration: CAPTURE_COOLDOWN_HOURS"),
      );
    },
  );

  it("NFR-001 trusts X-Forwarded-For only when TRUST_PROXY is exactly true", () => {
    expect(loadServerConfig({ ...serverEnv, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadServerConfig({ ...serverEnv, TRUST_PROXY: "" }).trustProxy).toBe(false);
  });

  it("AC-012.1 reads explicit port, log level and log file", () => {
    const config = loadServerConfig({
      ...serverEnv,
      PORT: "8080",
      LOG_LEVEL: "debug",
      LOG_FILE_PATH: "/data/logs/api.log",
    });
    expect(config).toMatchObject({
      port: 8080,
      logLevel: "debug",
      logFilePath: "/data/logs/api.log",
    });
  });

  it.each([
    ["ACTIVE_EXPANSION", { ACTIVE_EXPANSION: undefined }],
    ["ACTIVE_EXPANSION", { ACTIVE_EXPANSION: "../etc" }],
    ["PORT", { PORT: "99999" }],
    ["LOG_LEVEL", { LOG_LEVEL: "verbose" }],
    ["DATABASE_PATH", { DATABASE_PATH: "" }],
    ["TRUST_PROXY", { TRUST_PROXY: "yes" }],
    ["INFERENCE_DAILY_CALL_LIMIT", { INFERENCE_DAILY_CALL_LIMIT: "-1" }],
    ["INFERENCE_DAILY_CALL_LIMIT", { INFERENCE_DAILY_CALL_LIMIT: "300000" }],
    ["CAPTURES_PER_PLAYER_PER_DAY", { CAPTURES_PER_PLAYER_PER_DAY: "many" }],
  ])("AC-012.2 refuses to start and names %s when it is missing or malformed", (key, override) => {
    expect(() => loadServerConfig({ ...serverEnv, ...override })).toThrow(key);
  });

  it("AC-012.2 names server and inference keys together without printing secrets", () => {
    expect(() =>
      loadServerConfig({ INFERENCE_API_KEY: "sk-very-secret-value", INFERENCE_MODEL: "m" }),
    ).toThrow(
      /^Missing or invalid configuration: INFERENCE_BASE_URL, ACTIVE_EXPANSION, DATABASE_PATH$/,
    );
  });
});

import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/server/config.js";

const base = {
  INFERENCE_BASE_URL: "http://localhost:11434/v1/",
  INFERENCE_MODEL: "gemma3:4b",
};

describe("loadConfig", () => {
  it("AC-012.1 reads the inference endpoint, model and optional key from the environment", () => {
    const config = loadConfig({ ...base, INFERENCE_API_KEY: "sk-test-123" });
    expect(config.inference).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "gemma3:4b",
      apiKey: "sk-test-123",
    });
    expect(config.identifyMinConfidence).toBe(0.5);
    expect(config.activeExpansion).toBe("everyday-nature");
  });

  it("AC-012.1 works without an API key", () => {
    expect(loadConfig(base).inference.apiKey).toBeUndefined();
  });

  it("AC-012.2 refuses to start naming each missing setting", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(
      /INFERENCE_BASE_URL \(missing\).*INFERENCE_MODEL \(missing\)/,
    );
  });

  it("AC-012.2 treats a blank value as missing", () => {
    expect(() => loadConfig({ ...base, INFERENCE_MODEL: "  " })).toThrow(
      /INFERENCE_MODEL \(missing\)/,
    );
  });

  it("AC-012.2 names a malformed setting without printing secret values", () => {
    const secret = "sk-super-secret-value";
    let message = "";
    try {
      loadConfig({
        ...base,
        INFERENCE_BASE_URL: `not a url ${secret}`,
        INFERENCE_API_KEY: secret,
        IDENTIFY_MIN_CONFIDENCE: "2",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/INFERENCE_BASE_URL \(invalid\)/);
    expect(message).toMatch(/IDENTIFY_MIN_CONFIDENCE \(invalid\)/);
    expect(message).not.toContain(secret);
  });
});

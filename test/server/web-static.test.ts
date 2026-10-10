import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { fakeIdentifier, testApp } from "./helpers.js";

/** A stand-in for the Vite build output (`dist/web`). */
const webRoot = mkdtempSync(join(tmpdir(), "tcgrass-web-"));
writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>TCGrass</title>");
mkdirSync(join(webRoot, "assets"));
writeFileSync(join(webRoot, "assets", "index-abc123.js"), "console.log('app');");
mkdirSync(join(webRoot, "api"));
writeFileSync(join(webRoot, "api", "shadow.json"), "{}");
mkdirSync(join(webRoot, "cards", "a", "b"), { recursive: true });
writeFileSync(join(webRoot, "cards", "a", "b", "c"), "shadow");
afterAll(() => {
  rmSync(webRoot, { recursive: true, force: true });
});

const identify = fakeIdentifier({ outcome: "none", reason: "no-match" }).identify;
const { app, auth } = testApp(identify, { webRoot });

describe("serving the built PWA", () => {
  it("NFR-011 serves index.html at / with the security headers and CSP", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain("<title>TCGrass</title>");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("permissions-policy")).toBe("camera=(self), geolocation=()");
    // Revalidated on every load so a redeploy never leaves a stale shell pointing at old assets.
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("NFR-011 serves hashed assets as immutable", async () => {
    const response = await app.request("/assets/index-abc123.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/javascript/);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("NFR-001 never serves files for /api or /cards paths, even if the build had them", async () => {
    const api = await app.request("/api/shadow.json", { headers: auth });
    expect(api.status).toBe(404);
    expect(await api.json()).toMatchObject({ error: { code: "not_found" } });
    const cards = await app.request("/cards/a/b/c");
    expect(cards.status).toBe(404);
  });

  it("NFR-001 answers a missing file with the JSON error shape", async () => {
    const response = await app.request("/missing.js");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });

  // URL parsing already collapses these before routing; serveStatic also rejects dot segments.
  it("NFR-001 rejects path traversal out of the web root", async () => {
    const encoded = await app.request("/assets/%2e%2e/%2e%2e/etc/passwd");
    expect(encoded.status).toBe(404);
    const dotted = await app.request("/assets/../../etc/passwd");
    expect(dotted.status).toBe(404);
  });

  it("NFR-011 serves nothing but the API when no web root is configured", async () => {
    const apiOnly = testApp(identify).app;
    const response = await apiOnly.request("/");
    expect(response.status).toBe(404);
  });
});

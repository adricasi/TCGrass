import { describe, expect, it } from "vitest";

import { fakeIdentifier, photoForm, testApp } from "./helpers.js";

const { app } = testApp(fakeIdentifier({ outcome: "none", reason: "no-match" }).identify);

describe("app", () => {
  it("NFR-007 answers /healthz", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("NFR-001 sets the design's security headers and CSP", async () => {
    const response = await app.request("/healthz");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; img-src 'self' blob: data:; connect-src 'self'; script-src 'self'; " +
        "style-src 'self'; frame-ancestors 'none'",
    );
    expect(response.headers.get("strict-transport-security")).toMatch(/max-age=\d+/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toBe("camera=(self), geolocation=()");
  });

  it("NFR-001 sets the security headers on error responses too", async () => {
    const response = await app.request("/api/captures", {
      method: "POST",
      body: photoForm(new Uint8Array([1, 2, 3])),
    });
    expect(response.status).toBe(415);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("NFR-007 returns a fresh request id and ignores one sent by the client", async () => {
    const response = await app.request("/healthz", { headers: { "X-Request-Id": "forged-id" } });
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe("forged-id");
  });

  it("NFR-001 answers unknown routes with the error shape", async () => {
    const response = await app.request("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "Not found." } });
  });

  it("NFR-001 does not accept GET on the capture route", async () => {
    const response = await app.request("/api/captures");
    expect(response.status).toBe(404);
  });
});

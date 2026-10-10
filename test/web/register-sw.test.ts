import { describe, expect, it, vi } from "vitest";

import { registerServiceWorker } from "../../web/src/register-sw.js";

describe("service worker registration", () => {
  it("AC-013.1 registers /sw.js for the whole app", async () => {
    const register = vi.fn(() => Promise.resolve({}));
    await registerServiceWorker({ serviceWorker: { register } }, console);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("AC-013.1 does nothing where service workers are unsupported", async () => {
    await expect(registerServiceWorker({}, console)).resolves.toBeUndefined();
  });

  it("AC-013.1 reports a failed registration without breaking the app", async () => {
    const warn = vi.fn();
    const register = vi.fn(() => Promise.reject(new Error("blocked")));
    await registerServiceWorker({ serviceWorker: { register } }, { warn });
    expect(warn).toHaveBeenCalledWith("Service worker registration failed", "Error");
  });
});

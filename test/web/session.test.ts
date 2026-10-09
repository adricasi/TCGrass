import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../web/src/api.js";
import {
  forgetPlayer,
  resumeSession,
  SECRET_KEY,
  type SecretStore,
  type SessionApi,
  startNewPlayer,
} from "../../web/src/session.js";

function memoryStore(
  initial: Record<string, string> = {},
): SecretStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function fakeApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    getMe: vi
      .fn<SessionApi["getMe"]>()
      .mockResolvedValue({ displayName: "Ada", friendCode: "ABCD2345" }),
    createPlayer: vi
      .fn<SessionApi["createPlayer"]>()
      .mockResolvedValue({ secret: "s3cret", displayName: "Ada", friendCode: "ABCD2345" }),
    ...overrides,
  };
}

describe("session", () => {
  it("AC-002.1 starts as a new player when nothing is stored (first run shows the notice)", async () => {
    const api = fakeApi();
    await expect(resumeSession(memoryStore(), api)).resolves.toEqual({ kind: "new" });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it("AC-002.3 resumes the stored player without asking for anything", async () => {
    const api = fakeApi();
    const session = await resumeSession(memoryStore({ [SECRET_KEY]: "s3cret" }), api);
    expect(session).toEqual({
      kind: "ready",
      secret: "s3cret",
      player: { displayName: "Ada", friendCode: "ABCD2345" },
      remembered: true,
    });
    expect(api.getMe).toHaveBeenCalledWith("s3cret");
  });

  it("AC-002.7 reports a profile that the server no longer knows", async () => {
    const api = fakeApi({
      getMe: vi
        .fn<SessionApi["getMe"]>()
        .mockRejectedValue(new ApiError(401, "unauthenticated", "x")),
    });
    await expect(resumeSession(memoryStore({ [SECRET_KEY]: "old" }), api)).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("AC-002.7 keeps the secret when the server is merely unreachable", async () => {
    const store = memoryStore({ [SECRET_KEY]: "s3cret" });
    const api = fakeApi({
      getMe: vi.fn<SessionApi["getMe"]>().mockRejectedValue(new TypeError("offline")),
    });
    await expect(resumeSession(store, api)).resolves.toEqual({ kind: "unavailable" });
    expect(store.data.get(SECRET_KEY)).toBe("s3cret");
  });

  it("AC-002.7 forgets the rejected secret before a new player is created", () => {
    const store = memoryStore({ [SECRET_KEY]: "old" });
    forgetPlayer(store);
    expect(store.data.has(SECRET_KEY)).toBe(false);
  });

  it("AC-002.10 creates a player and keeps the secret on the device", async () => {
    const store = memoryStore();
    const api = fakeApi();
    const session = await startNewPlayer(store, "Ada", api);
    expect(api.createPlayer).toHaveBeenCalledWith("Ada");
    expect(store.data.get(SECRET_KEY)).toBe("s3cret");
    expect(session).toMatchObject({ kind: "ready", secret: "s3cret", remembered: true });
  });

  it("AC-002.10 still plays, but flags it, when the device refuses to store the secret", async () => {
    const store: SecretStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    await expect(resumeSession(store, fakeApi())).resolves.toEqual({ kind: "new" });
    await expect(startNewPlayer(store, "Ada", fakeApi())).resolves.toMatchObject({
      remembered: false,
    });
    expect(() => {
      forgetPlayer(store);
    }).not.toThrow();
  });
});

import type { MeResponse } from "../../src/shared/schemas/players.js";
import { ApiError, createPlayer, getMe } from "./api.js";

export const SECRET_KEY = "tcgrass.playerSecret";

/** The subset of `localStorage` the session needs; injectable for tests. */
export interface SecretStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Session =
  | { kind: "new" }
  /** `remembered` is false when the device refused to store the secret (private modes). */
  | { kind: "ready"; secret: string; player: MeResponse; remembered: boolean }
  | { kind: "not-found" }
  | { kind: "unavailable" };

export interface SessionApi {
  getMe: typeof getMe;
  createPlayer: typeof createPlayer;
}

const defaultApi: SessionApi = { getMe, createPlayer };

function readSecret(store: SecretStore): string | null {
  try {
    return store.getItem(SECRET_KEY);
  } catch {
    // Storage blocked (e.g. some private modes): behave as a first visit.
    return null;
  }
}

/**
 * On app start: resume the stored player (AC-002.3), or report that it no longer exists
 * (AC-002.7). A network or server error is not "not found": the secret is kept.
 */
export async function resumeSession(store: SecretStore, api = defaultApi): Promise<Session> {
  const secret = readSecret(store);
  if (secret === null) {
    return { kind: "new" };
  }
  try {
    return { kind: "ready", secret, player: await api.getMe(secret), remembered: true };
  } catch (error) {
    return error instanceof ApiError && error.status === 401
      ? { kind: "not-found" }
      : { kind: "unavailable" };
  }
}

/** Creates the player and keeps its secret on the device (AC-002.10). */
export async function startNewPlayer(
  store: SecretStore,
  displayName: string,
  api = defaultApi,
): Promise<Session> {
  const created = await api.createPlayer(displayName);
  let remembered = true;
  try {
    store.setItem(SECRET_KEY, created.secret);
  } catch {
    remembered = false;
  }
  return {
    kind: "ready",
    secret: created.secret,
    player: { displayName: created.displayName, friendCode: created.friendCode },
    remembered,
  };
}

/** Drops a secret the server no longer knows, before creating a new player (AC-002.7). */
export function forgetPlayer(store: SecretStore): void {
  try {
    store.removeItem(SECRET_KEY);
  } catch {
    // Nothing stored or storage blocked: nothing to forget.
  }
}

import { useEffect, useState } from "preact/hooks";

import { Capture } from "./Capture.js";
import { FirstRun } from "./FirstRun.js";
import {
  forgetPlayer,
  resumeSession,
  type SecretStore,
  type Session,
  startNewPlayer,
} from "./session.js";

/** localStorage, or an always-empty store where the browser blocks it. */
function deviceStore(): SecretStore {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
}

/** Created once: the same storage handle for the whole app. */
const store = deviceStore();

export function App() {
  const [session, setSession] = useState<Session | "loading">("loading");

  useEffect(() => {
    void resumeSession(store).then(setSession);
  }, []);

  if (session === "loading") {
    return <p>Loading…</p>;
  }
  if (session.kind === "unavailable") {
    return (
      <section class="notice" role="alert">
        <h2>Can't reach TCGrass</h2>
        <p>Check your connection and reload the page.</p>
      </section>
    );
  }
  if (session.kind === "not-found") {
    return (
      <section class="notice" role="alert">
        <h2>Profile not found</h2>
        <p>This device's player no longer exists on the server. You can start a new player.</p>
        <button
          type="button"
          onClick={() => {
            forgetPlayer(store);
            setSession({ kind: "new" });
          }}
        >
          Create a new player
        </button>
      </section>
    );
  }
  if (session.kind === "new") {
    return (
      <FirstRun
        onCreate={async (displayName) => {
          setSession(await startNewPlayer(store, displayName));
        }}
      />
    );
  }
  return (
    <>
      <p class="player">
        {session.player.displayName} · friend code <strong>{session.player.friendCode}</strong>
      </p>
      {!session.remembered && (
        <p class="notice" role="alert">
          This browser won't remember you: closing it loses this player. Turn off private browsing
          to keep your cards.
        </p>
      )}
      <Capture
        secret={session.secret}
        onUnauthenticated={() => {
          setSession({ kind: "not-found" });
        }}
      />
    </>
  );
}

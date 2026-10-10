import { useEffect, useState } from "preact/hooks";

import { Binder } from "./Binder.js";
import { Capture } from "./Capture.js";
import { getInbox } from "./api.js";
import { FirstRun } from "./FirstRun.js";
import { Friends } from "./Friends.js";
import { Inbox } from "./Inbox.js";
import { Nav, type Tab } from "./Nav.js";
import { Odds } from "./Odds.js";
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
  const [tab, setTab] = useState<Tab>("capture");
  const [captureLocked, setCaptureLocked] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const secret = session !== "loading" && session.kind === "ready" ? session.secret : null;

  function refreshInbox(): void {
    if (secret === null) {
      return;
    }
    getInbox(secret)
      .then((inbox) => {
        setInboxCount(inbox.counts.total);
      })
      .catch(() => undefined);
  }

  // The inbox badge is polled every 20 s (design § Interfaces). refreshInbox reads only
  // `secret`, so `[secret]` is the full dependency list.
  useEffect(() => {
    if (secret === null) {
      return;
    }
    refreshInbox();
    const timer = window.setInterval(refreshInbox, 20_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [secret]);

  useEffect(() => {
    void resumeSession(store).then(setSession);
  }, []);

  function notFound(): void {
    setSession({ kind: "not-found" });
  }

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
      {tab === "capture" && (
        <Capture
          secret={session.secret}
          onUnauthenticated={notFound}
          onLockedChange={setCaptureLocked}
        />
      )}
      {tab === "binder" && (
        <Binder
          secret={session.secret}
          onUnauthenticated={notFound}
          onShowOdds={() => {
            setTab("odds");
          }}
        />
      )}
      {tab === "friends" && (
        <Friends secret={session.secret} player={session.player} onUnauthenticated={notFound} />
      )}
      {tab === "inbox" && (
        <Inbox secret={session.secret} onChanged={refreshInbox} onUnauthenticated={notFound} />
      )}
      {tab === "odds" && <Odds />}
      <Nav current={tab} onChange={setTab} disabled={captureLocked} inboxCount={inboxCount} />
    </>
  );
}

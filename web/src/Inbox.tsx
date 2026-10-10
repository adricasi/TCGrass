import { useEffect, useState } from "preact/hooks";

import type { InboxResponse } from "../../src/shared/schemas/friends.js";
import { answerFriendRequest, ApiError, getInbox } from "./api.js";

/** Inbox: received friend requests to accept or decline (AC-008.6, AC-008.7). */
export function Inbox({
  secret,
  onChanged,
  onUnauthenticated,
}: {
  secret: string;
  onChanged: () => void;
  onUnauthenticated: () => void;
}) {
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answering, setAnswering] = useState<number | null>(null);

  function handle(error: unknown, fallback: string): void {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthenticated();
      return;
    }
    // Server messages are written for players, e.g. "This request was already answered."
    setMessage(error instanceof ApiError ? error.message : fallback);
  }

  function load(): void {
    getInbox(secret)
      .then(setInbox)
      .catch((error: unknown) => {
        handle(error, "Couldn't load the inbox. Check your connection and try again.");
      });
  }

  useEffect(load, [secret]);

  async function answer(requestId: number, accept: boolean): Promise<void> {
    setAnswering(requestId);
    try {
      const result = await answerFriendRequest(secret, requestId, accept);
      setMessage(
        accept
          ? `You and ${result.player.displayName} are now friends.`
          : `Declined ${result.player.displayName}'s request.`,
      );
    } catch (error) {
      handle(error, "Something went wrong. Try again.");
    } finally {
      setAnswering(null);
    }
    load();
    onChanged();
  }

  if (inbox === null) {
    return <p role={message === null ? undefined : "alert"}>{message ?? "Loading…"}</p>;
  }
  return (
    <section class="inbox">
      <h2>Inbox</h2>
      <p class="result" aria-live="polite">
        {message}
      </p>
      {inbox.counts.total === 0 && <p>Nothing waiting for you.</p>}
      <ul class="requests">
        {inbox.friendRequests.map((request) => (
          <li key={request.id}>
            <span>
              <strong>{request.from.displayName}</strong> wants to be friends
            </span>
            <button
              type="button"
              disabled={answering !== null}
              onClick={() => void answer(request.id, true)}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={answering !== null}
              onClick={() => void answer(request.id, false)}
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

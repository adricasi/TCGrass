import { useState } from "preact/hooks";

import type { InboxResponse } from "../../src/shared/schemas/friends.js";
import type { IncomingOffer } from "../../src/shared/schemas/trades.js";
import { answerFriendRequest, answerTradeOffer, ApiError } from "./api.js";
import { rarityPresentation } from "./rarity.js";
import { SentOffers } from "./SentOffers.js";

function cardLabel(card: IncomingOffer["offered"]): string {
  return `${card.name} (${rarityPresentation(card.rarity).label})`;
}

/**
 * Inbox: received trade offers (AC-010.2) and friend requests (AC-008.6) to accept or decline,
 * followed by the offers the player sent (AC-009.6). App owns and refreshes the data.
 */
export function Inbox({
  secret,
  inbox,
  version,
  onChanged,
  onUnauthenticated,
}: {
  secret: string;
  inbox: InboxResponse | null;
  version: number;
  /** Asks App to refresh the inbox (and with it the badge and the sent list). */
  onChanged: () => void;
  onUnauthenticated: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handle(error: unknown, fallback: string): void {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthenticated();
      return;
    }
    // Server messages are written for players, e.g. "One of the cards changed hands…".
    setMessage(error instanceof ApiError ? error.message : fallback);
  }

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    try {
      setMessage(await action());
    } catch (error) {
      handle(error, "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
    onChanged();
  }

  function answerOffer(offer: IncomingOffer, accept: boolean): Promise<void> {
    return run(async () => {
      await answerTradeOffer(secret, offer.id, accept);
      return accept
        ? `Trade done: you gave ${cardLabel(offer.requested)} and got ${cardLabel(offer.offered)}.`
        : `Declined ${offer.from.displayName}'s offer.`;
    });
  }

  function answerRequest(requestId: number, accept: boolean): Promise<void> {
    return run(async () => {
      const result = await answerFriendRequest(secret, requestId, accept);
      return accept
        ? `You and ${result.player.displayName} are now friends.`
        : `Declined ${result.player.displayName}'s request.`;
    });
  }

  if (inbox === null) {
    return <p>Loading…</p>;
  }
  return (
    <section class="inbox">
      <h2>Inbox</h2>
      <p class="result" aria-live="polite">
        {message}
      </p>
      {inbox.counts.total === 0 && <p>Nothing waiting for you.</p>}
      <ul class="requests">
        {inbox.tradeOffers.map((offer) => (
          <li key={`offer-${offer.id}`} class="offer">
            <span>
              <strong>{offer.from.displayName}</strong> offers their{" "}
              <strong>{cardLabel(offer.offered)}</strong> for your{" "}
              <strong>{cardLabel(offer.requested)}</strong>
            </span>
            <span class="offer-cards">
              <img class="instance-art" src={offer.offered.imageUrl} alt="" />
              <span aria-hidden="true">⇄</span>
              <img class="instance-art" src={offer.requested.imageUrl} alt="" />
            </span>
            <button type="button" disabled={busy} onClick={() => void answerOffer(offer, true)}>
              Accept
            </button>
            <button type="button" disabled={busy} onClick={() => void answerOffer(offer, false)}>
              Decline
            </button>
          </li>
        ))}
        {inbox.friendRequests.map((request) => (
          <li key={`request-${request.id}`}>
            <span>
              <strong>{request.from.displayName}</strong> wants to be friends
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answerRequest(request.id, true)}
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void answerRequest(request.id, false)}
            >
              Decline
            </button>
          </li>
        ))}
      </ul>
      <SentOffers secret={secret} version={version} onUnauthenticated={onUnauthenticated} />
    </section>
  );
}

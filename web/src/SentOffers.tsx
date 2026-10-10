import { useEffect, useState } from "preact/hooks";

import type { SentOffer } from "../../src/shared/schemas/trades.js";
import { ApiError, cancelTradeOffer, getSentOffers } from "./api.js";
import { rarityPresentation } from "./rarity.js";
import { tradeStatusLabel } from "./trade-view.js";

/** Offers I sent, with both cards, the friend and the status; pending ones can be cancelled (AC-009.5, AC-009.6). */
export function SentOffers({
  secret,
  onUnauthenticated,
}: {
  secret: string;
  onUnauthenticated: () => void;
}) {
  const [offers, setOffers] = useState<SentOffer[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function handle(error: unknown, fallback: string): void {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthenticated();
      return;
    }
    setMessage(error instanceof ApiError ? error.message : fallback);
  }

  function load(): void {
    getSentOffers(secret)
      .then((response) => {
        setOffers(response.offers);
      })
      .catch((error: unknown) => {
        handle(error, "Couldn't load your sent offers.");
      });
  }

  useEffect(load, [secret]);

  async function cancel(offerId: number): Promise<void> {
    setBusy(true);
    try {
      await cancelTradeOffer(secret, offerId);
      setMessage("Offer cancelled; your card is free again.");
    } catch (error) {
      handle(error, "Something went wrong. Try again.");
      if (error instanceof ApiError && error.status === 401) {
        return; // The player is gone: don't reload with a dead secret.
      }
    } finally {
      setBusy(false);
    }
    load();
  }

  return (
    <section class="sent-offers">
      <h2>Sent offers</h2>
      <p class="result" aria-live="polite">
        {message}
      </p>
      {offers !== null && offers.length === 0 && <p>You haven't offered any trades yet.</p>}
      <ul class="requests">
        {offers?.map((offer) => (
          <li key={offer.id} class={`offer offer-${offer.status}`}>
            <span>
              Your <strong>{offer.offered.name}</strong> (
              {rarityPresentation(offer.offered.rarity).label}) for {offer.to.displayName}'s{" "}
              <strong>{offer.requested.name}</strong> (
              {rarityPresentation(offer.requested.rarity).label})
            </span>
            <span class="offer-status">{tradeStatusLabel(offer.status)}</span>
            {offer.status === "pending" && (
              <button type="button" disabled={busy} onClick={() => void cancel(offer.id)}>
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

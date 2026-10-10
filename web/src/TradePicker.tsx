import { useEffect, useState } from "preact/hooks";

import type { TradeCard } from "../../src/shared/schemas/trades.js";
import { ApiError, createTradeOffer, getBinder } from "./api.js";
import { type OfferableCard, offerableCards } from "./trade-view.js";
import { rarityPresentation } from "./rarity.js";

/**
 * Pick one of my cards to offer for a friend's card, then send the offer (AC-009.1). Sending
 * returns at once; the friend answers later from their inbox.
 */
export function TradePicker({
  secret,
  wanted,
  friendName,
  onDone,
  onUnauthenticated,
}: {
  secret: string;
  wanted: TradeCard;
  friendName: string;
  onDone: (message: string | null) => void;
  onUnauthenticated: () => void;
}) {
  const [mine, setMine] = useState<OfferableCard[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handle(error: unknown, fallback: string): void {
    if (error instanceof ApiError && error.status === 401) {
      onUnauthenticated();
      return;
    }
    // Server messages for offers are written for players (e.g. "card is locked").
    setMessage(error instanceof ApiError ? error.message : fallback);
  }

  useEffect(() => {
    getBinder(secret)
      .then((binder) => {
        setMine(offerableCards(binder));
      })
      .catch((error: unknown) => {
        handle(error, "Couldn't load your cards. Try again.");
      });
  }, [secret]);

  async function send(): Promise<void> {
    if (chosen === null) {
      return;
    }
    setBusy(true);
    try {
      await createTradeOffer(secret, {
        offeredInstanceId: chosen,
        requestedInstanceId: wanted.instanceId,
      });
      onDone(`Offer sent to ${friendName}.`);
    } catch (error) {
      handle(error, "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const wantedRarity = rarityPresentation(wanted.rarity);
  return (
    <section class="trade-picker">
      <button
        type="button"
        class="back"
        onClick={() => {
          onDone(null);
        }}
      >
        ← Back
      </button>
      <h2>Trade for {friendName}'s card</h2>
      <p class={`instance ${wantedRarity.frameClass}`}>
        <img class="instance-art" src={wanted.imageUrl} alt="" />
        <span class="binder-name">{wanted.name}</span>
        <span class="card-rarity">{wantedRarity.label}</span>
      </p>
      <h3>Offer one of yours</h3>
      {mine === null && message === null && <p>Loading your cards…</p>}
      {mine !== null && mine.length === 0 && <p>You have no cards free to offer.</p>}
      <ul class="instances">
        {mine?.map((card) => {
          const rarity = rarityPresentation(card.rarity);
          return (
            <li key={card.instanceId}>
              <label class={`instance pick ${rarity.frameClass}`}>
                <input
                  type="radio"
                  name="offered"
                  checked={chosen === card.instanceId}
                  onChange={() => {
                    setChosen(card.instanceId);
                  }}
                />
                <img class="instance-art" src={card.imageUrl} alt="" loading="lazy" />
                <span class="binder-name">{card.name}</span>
                <span class="card-rarity">{rarity.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p class="result" role="alert">
        {message}
      </p>
      <button type="button" disabled={chosen === null || busy} onClick={() => void send()}>
        {busy ? "Sending…" : "Send offer"}
      </button>
    </section>
  );
}

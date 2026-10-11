import { useEffect, useState } from "preact/hooks";

import type { BinderCard, BinderResponse } from "../../src/shared/schemas/binder.js";
import { ApiError, getBinder } from "./api.js";
import { catalogueNumber, countBadges, progressLabel, rarestOwned } from "./binder-view.js";
import { CardDetail } from "./CardDetail.js";
import { rarityPresentation } from "./rarity.js";

/** Binder (REQ-007): every catalogue card, owned with counts, missing as silhouettes. */
export function Binder({
  secret,
  onUnauthenticated,
  onShowOdds,
}: {
  secret: string;
  onUnauthenticated: () => void;
  onShowOdds: () => void;
}) {
  const [binder, setBinder] = useState<BinderResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<BinderCard | null>(null);

  useEffect(() => {
    getBinder(secret)
      .then(setBinder)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthenticated();
        } else {
          setFailed(true);
        }
      });
    // onUnauthenticated is left out on purpose: App's callback only flips a state flag, and
    // re-fetching the binder whenever a parent re-renders would be wasteful.
  }, [secret]);

  if (failed) {
    return <p role="alert">Couldn't load your binder. Check your connection and try again.</p>;
  }
  if (binder === null) {
    return <p>Loading your binder…</p>;
  }
  if (selected !== null) {
    return (
      <CardDetail
        card={selected}
        onBack={() => {
          setSelected(null);
        }}
      />
    );
  }
  return (
    <section class="binder">
      <div class="section-head">
        <h2>
          Binder <span class="progress">{progressLabel(binder)}</span>
        </h2>
        <button type="button" class="link" onClick={onShowOdds}>
          Rarity odds
        </button>
      </div>
      <ul class="progress-leaves" aria-hidden="true">
        {binder.cards.map((card) => (
          <li key={card.id} class={card.owned ? "found" : undefined} />
        ))}
      </ul>
      <ul class="binder-grid">
        {binder.cards.map((card, index) => {
          const rarest = rarestOwned(card.counts);
          return (
            <li key={card.id}>
              {card.owned && rarest !== null ? (
                <button
                  type="button"
                  class={`binder-card owned ${rarityPresentation(rarest).frameClass}`}
                  onClick={() => {
                    setSelected(card);
                  }}
                >
                  <span class="binder-number">{catalogueNumber(index)}</span>
                  <img src={card.imageUrl} alt={card.name} loading="lazy" />
                  <span class="binder-name">{card.name}</span>
                  <span class="binder-counts">
                    {countBadges(card.counts).map((badge) => (
                      <span key={badge.rarity} class={`count count-${badge.rarity}`}>
                        {badge.count} {badge.label}
                      </span>
                    ))}
                  </span>
                </button>
              ) : (
                <div class="binder-card missing">
                  <span class="binder-number">{catalogueNumber(index)}</span>
                  <img src={card.imageUrl} alt="" loading="lazy" />
                  <span class="binder-name">
                    {card.name}
                    <span class="visually-hidden"> (not found yet)</span>
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { useEffect, useState } from "preact/hooks";

import type { FriendBinderResponse } from "../../src/shared/schemas/friends.js";
import { ApiError, getFriendBinder } from "./api.js";
import { formatCaptureDate, progressLabel } from "./binder-view.js";
import { rarityPresentation } from "./rarity.js";

/**
 * A friend's cards (AC-008.5). Instances the friend has locked in their own pending offers
 * are shown as unavailable and can't be requested (A-8).
 */
export function FriendBinder({
  secret,
  friendCode,
  onBack,
  onUnauthenticated,
}: {
  secret: string;
  friendCode: string;
  onBack: () => void;
  onUnauthenticated: () => void;
}) {
  const [data, setData] = useState<FriendBinderResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getFriendBinder(secret, friendCode)
      .then(setData)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          onUnauthenticated();
        } else {
          setFailed(true);
        }
      });
    // onUnauthenticated only flips App state; re-fetching on parent re-renders is not wanted.
  }, [secret, friendCode]);

  return (
    <section class="friend-binder">
      <button type="button" class="back" onClick={onBack}>
        ← Friends
      </button>
      {failed && <p role="alert">Couldn't load this binder. Try again later.</p>}
      {data === null && !failed && <p>Loading…</p>}
      {data !== null && (
        <>
          <h2>
            {data.friend.displayName} <span class="progress">{progressLabel(data.binder)}</span>
          </h2>
          {data.binder.owned === 0 && <p>No cards yet.</p>}
          <ul class="instances">
            {data.binder.cards
              .filter((card) => card.owned)
              .flatMap((card) =>
                card.instances.map((instance) => {
                  const rarity = rarityPresentation(instance.rarity);
                  return (
                    <li
                      key={instance.id}
                      class={`instance ${rarity.frameClass}${instance.locked ? " unavailable" : ""}`}
                    >
                      <img class="instance-art" src={card.imageUrl} alt="" loading="lazy" />
                      <span class="binder-name">{card.name}</span>
                      <span class="card-rarity">{rarity.label}</span>
                      <span class="instance-date">{formatCaptureDate(instance.capturedAt)}</span>
                      {instance.locked && <span class="locked">Unavailable: in a trade offer</span>}
                    </li>
                  );
                }),
              )}
          </ul>
        </>
      )}
    </section>
  );
}

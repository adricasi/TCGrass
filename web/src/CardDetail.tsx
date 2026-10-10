import type { BinderCard } from "../../src/shared/schemas/binder.js";
import { formatCaptureDate } from "./binder-view.js";
import { rarityPresentation } from "./rarity.js";

/** An owned card's instances with rarity, capture date and lock state (AC-007.2). */
export function CardDetail({ card, onBack }: { card: BinderCard; onBack: () => void }) {
  return (
    <section class="card-detail">
      <button type="button" class="back" onClick={onBack}>
        ← Binder
      </button>
      <img class="detail-art" src={card.imageUrl} alt={card.name} />
      <h2>{card.name}</h2>
      <p class="card-category">{card.category}</p>
      <ul class="instances">
        {card.instances.map((instance) => {
          const rarity = rarityPresentation(instance.rarity);
          return (
            <li key={instance.id} class={`instance ${rarity.frameClass}`}>
              <span class="card-rarity">{rarity.label}</span>
              <span class="instance-date">{formatCaptureDate(instance.capturedAt)}</span>
              {instance.locked && <span class="locked">Locked in a trade offer</span>}
              {instance.flavorLine !== null && <p class="card-flavor">{instance.flavorLine}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

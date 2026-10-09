import { useEffect, useRef } from "preact/hooks";

import type { CapturedCard } from "../../src/shared/schemas/captures.js";
import { rarityPresentation } from "./rarity.js";

/**
 * Card reveal (AC-006.1–006.5): art, name, category, rarity frame + label, and the model's
 * flavor line as plain text. Dismissing returns to the live camera underneath.
 */
export function Reveal({ card, onDismiss }: { card: CapturedCard; onDismiss: () => void }) {
  const rarity = rarityPresentation(card.rarity);
  const dismissRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Move focus into the dialog so keyboard and screen-reader users land on it.
    dismissRef.current?.focus();
  }, []);
  return (
    <div class="reveal" role="dialog" aria-modal="true" aria-labelledby="reveal-name">
      <article class={`card ${rarity.frameClass}${rarity.foil ? " foil" : ""}`}>
        <img class="card-art" src={card.imageUrl} alt={card.name} />
        <h2 id="reveal-name" class="card-name">
          {card.name}
        </h2>
        <p class="card-meta">
          <span class="card-category">{card.category}</span>
          <span class="card-rarity">{rarity.label}</span>
        </p>
        {/* Model output: rendered as text, never as markup (AC-006.4). */}
        {card.flavorLine !== null && <p class="card-flavor">{card.flavorLine}</p>}
      </article>
      <button ref={dismissRef} type="button" class="dismiss" onClick={onDismiss}>
        Keep exploring
      </button>
    </div>
  );
}

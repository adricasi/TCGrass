import { useEffect, useRef, useState } from "preact/hooks";

import type { CapturedCard } from "../../src/shared/schemas/captures.js";
import { rarityPresentation } from "./rarity.js";
import {
  ENTRY_FALLBACK_MS,
  cardClass,
  entryAnimation,
  isEntryAnimation,
  revealClass,
} from "./reveal-entry.js";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Card reveal (AC-006.1–006.6): art, name, category, rarity frame + label, and the model's
 * flavor line as plain text, opened by an entry animation that a tap skips. The dismiss button
 * is hidden during the entry, so a tap there skips instead of dismissing. Dismissing returns to
 * the live camera underneath.
 */
export function Reveal({ card, onDismiss }: { card: CapturedCard; onDismiss: () => void }) {
  const rarity = rarityPresentation(card.rarity);
  const [entry] = useState(() => entryAnimation(card.rarity, prefersReducedMotion()));
  const [entering, setEntering] = useState(entry !== null);
  const [foundAt] = useState(() =>
    new Date().toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Move focus into the dialog so keyboard and screen-reader users land on it; the button
    // can't take focus while hidden, so the dialog holds it during the entry.
    if (entering) dialogRef.current?.focus();
    else dismissRef.current?.focus();
  }, [entering]);
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => {
      setEntering(false);
    }, ENTRY_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [entering]);

  const skipEntry = () => {
    setEntering(false);
  };
  return (
    <div
      ref={dialogRef}
      class={revealClass(entering)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-name"
      tabIndex={-1}
      onClick={entering ? skipEntry : undefined}
      onKeyDown={(event) => {
        if (entering && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          skipEntry();
        }
      }}
    >
      <article
        class={cardClass(card.rarity, entry)}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && isEntryAnimation(event.animationName)) {
            skipEntry();
          }
        }}
      >
        <p class="card-head">
          <span class="card-category">{card.category}</span>
          <span class="card-found">found {foundAt}</span>
        </p>
        <div class="card-plate">
          <img class="card-art" src={card.imageUrl} alt={card.name} />
          {/* The rarity in words on a stamp whose shape changes too: not colour alone (AC-006.2). */}
          <span class="card-stamp">{rarity.label}</span>
        </div>
        <h2 id="reveal-name" class="card-name">
          {card.name}
        </h2>
        {/* Model output: rendered as text, never as markup (AC-006.4). */}
        {card.flavorLine !== null && <p class="card-flavor">{card.flavorLine}</p>}
      </article>
      <button ref={dismissRef} type="button" class="dismiss" onClick={onDismiss}>
        Keep exploring
      </button>
    </div>
  );
}

import type { BinderResponse } from "../../src/shared/schemas/binder.js";
import type { TradeStatus } from "../../src/shared/schemas/trades.js";

export interface OfferableCard {
  instanceId: number;
  cardId: string;
  name: string;
  rarity: BinderResponse["cards"][number]["instances"][number]["rarity"];
  imageUrl: string;
}

/**
 * My cards I can offer: every instance not already locked in one of my pending offers
 * (AC-009.2, AC-009.3), rarest first so duplicates of rare cards are easy to find.
 */
export function offerableCards(binder: BinderResponse): OfferableCard[] {
  const rank = { legendary: 0, epic: 1, rare: 2, common: 3 } as const;
  return binder.cards
    .flatMap((card) =>
      card.instances
        .filter((instance) => !instance.locked)
        .map((instance) => ({
          instanceId: instance.id,
          cardId: card.id,
          name: card.name,
          rarity: instance.rarity,
          imageUrl: card.imageUrl,
        })),
    )
    .sort((a, b) => rank[a.rarity] - rank[b.rarity] || a.name.localeCompare(b.name));
}

const STATUS_LABEL: Record<TradeStatus, string> = {
  pending: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  failed: "Failed: a card changed hands",
};

export function tradeStatusLabel(status: TradeStatus): string {
  return STATUS_LABEL[status];
}

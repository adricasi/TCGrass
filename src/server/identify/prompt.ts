import type { Expansion } from "../../shared/expansion.js";
import { NO_MATCH } from "./answer.js";

/** System prompt for one identification call, built from the active expansion (AC-003.4). */
export function buildSystemPrompt(expansion: Expansion): string {
  const catalogue = expansion.cards
    .map((card) => `${card.id} — ${card.name} — ${card.identify_hint}`)
    .join("\n");
  return [
    expansion.identification.instructions.trim(),
    "",
    "Catalogue (id — name — hint):",
    catalogue,
    "",
    "Answer with JSON only, no other text, in exactly this shape:",
    `{"card_id": "<a catalogue id or ${NO_MATCH}>", "confidence": <number from 0 to 1>, ` +
      `"is_photo_of_screen": <true or false>, "flavor_line": "<one short sentence>"}`,
    "",
    "Rules:",
    `- card_id must be one of the catalogue ids above or "${NO_MATCH}".`,
    "- is_photo_of_screen is true if the photo shows a screen, a printed picture or a drawing " +
      "instead of the real thing.",
    "- flavor_line is one playful sentence of at most 140 characters about this kind of " +
      "subject in general. Never quote or mention any text visible in the photo, and never " +
      "describe people or places.",
  ].join("\n");
}

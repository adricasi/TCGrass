-- Capture cooldown per player and card (REQ-014, ADR 0007). Additive: no existing table changes.
-- Written only by captures that mint, never by trades (AC-014.3). Holds the capture time, not the
-- expiry, so a changed CAPTURE_COOLDOWN_HOURS applies to running cooldowns (AC-014.4).
CREATE TABLE capture_cooldowns (
  player_id INTEGER NOT NULL REFERENCES players (id),
  expansion_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  last_captured_at TEXT NOT NULL,
  PRIMARY KEY (player_id, expansion_id, card_id),
  FOREIGN KEY (expansion_id, card_id) REFERENCES catalogue_cards (expansion_id, id)
) STRICT;

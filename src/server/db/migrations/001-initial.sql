-- Initial schema (design.md § Data model). Photos are never stored (REQ-004).

CREATE TABLE expansions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  style_prompt TEXT NOT NULL,
  identification_instructions TEXT NOT NULL,
  rarity_odds TEXT NOT NULL, -- JSON {common, rare, epic, legendary}, as loaded from the file
  license_data TEXT NOT NULL,
  license_images TEXT NOT NULL,
  loaded_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalogue_cards (
  expansion_id TEXT NOT NULL REFERENCES expansions (id),
  id TEXT NOT NULL,
  position INTEGER NOT NULL, -- order in the expansion file
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  identify_hint TEXT NOT NULL,
  art_prompt TEXT NOT NULL,
  image_path TEXT NOT NULL,
  is_placeholder INTEGER NOT NULL CHECK (is_placeholder IN (0, 1)),
  PRIMARY KEY (expansion_id, id)
) STRICT;

CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  secret_hash TEXT NOT NULL UNIQUE, -- SHA-256 of the player secret; never the secret itself
  display_name TEXT NOT NULL,
  friend_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE friend_requests (
  id INTEGER PRIMARY KEY,
  from_player_id INTEGER NOT NULL REFERENCES players (id),
  to_player_id INTEGER NOT NULL REFERENCES players (id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (from_player_id <> to_player_id)
) STRICT;
CREATE INDEX friend_requests_to ON friend_requests (to_player_id, status);
-- One pending request per pair, in either direction (design.md § Data model).
CREATE UNIQUE INDEX friend_requests_one_pending_per_pair
  ON friend_requests (min(from_player_id, to_player_id), max(from_player_id, to_player_id))
  WHERE status = 'pending';

CREATE TABLE friendships (
  player_a_id INTEGER NOT NULL REFERENCES players (id),
  player_b_id INTEGER NOT NULL REFERENCES players (id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (player_a_id, player_b_id),
  CHECK (player_a_id < player_b_id)
) STRICT;

CREATE TABLE card_instances (
  id INTEGER PRIMARY KEY,
  expansion_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  owner_id INTEGER NOT NULL REFERENCES players (id),
  -- No image data or image-derived metadata (AC-004.3); truncated to 140 at write (AC-006.3).
  flavor_line TEXT CHECK (flavor_line IS NULL OR length(flavor_line) <= 140),
  captured_at TEXT NOT NULL,
  FOREIGN KEY (expansion_id, card_id) REFERENCES catalogue_cards (expansion_id, id)
) STRICT;
CREATE INDEX card_instances_owner ON card_instances (owner_id);
CREATE INDEX card_instances_card ON card_instances (expansion_id, card_id);

CREATE TABLE trade_offers (
  id INTEGER PRIMARY KEY,
  from_player_id INTEGER NOT NULL REFERENCES players (id),
  to_player_id INTEGER NOT NULL REFERENCES players (id),
  offered_instance_id INTEGER NOT NULL REFERENCES card_instances (id),
  requested_instance_id INTEGER NOT NULL REFERENCES card_instances (id),
  source TEXT NOT NULL CHECK (source IN ('friend', 'daily_pack')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'failed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (from_player_id <> to_player_id),
  CHECK (offered_instance_id <> requested_instance_id)
) STRICT;
-- A card in a pending offer is locked: at most one pending offer per offered card (AC-009.2).
CREATE UNIQUE INDEX trade_offers_one_pending_per_offered_card
  ON trade_offers (offered_instance_id) WHERE status = 'pending';
CREATE INDEX trade_offers_to ON trade_offers (to_player_id, status);
CREATE INDEX trade_offers_from ON trade_offers (from_player_id, status);

CREATE TABLE daily_packs (
  player_id INTEGER NOT NULL REFERENCES players (id),
  day TEXT NOT NULL, -- UTC YYYY-MM-DD
  created_at TEXT NOT NULL,
  PRIMARY KEY (player_id, day)
) STRICT;

CREATE TABLE daily_pack_cards (
  player_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  position INTEGER NOT NULL,
  instance_id INTEGER NOT NULL REFERENCES card_instances (id),
  original_owner_id INTEGER NOT NULL REFERENCES players (id),
  PRIMARY KEY (player_id, day, position),
  UNIQUE (player_id, day, instance_id),
  FOREIGN KEY (player_id, day) REFERENCES daily_packs (player_id, day)
) STRICT;

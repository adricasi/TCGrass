# 0007. Limit captures with a per-player, per-card cooldown stored in the database

- Status: Accepted (2026-10-10, author decision)
- Date: 2026-10-10
- Deciders: adricasi

## Context
A player can photograph the same subject over and over (their own dog, the oak in front of the
house) and roll rarity on every capture until a Legendary comes up. That rewards farming one
subject instead of going out and looking around, which is the point of the game (G-2). The
author decided on 2026-10-10 that after capturing a card a player waits **5 hours** before
capturing the same card again, and that an admin can change the 5 hours without a code change
(REQ-014).

Facts that shape the design:
- Which card a photo shows is only known from the model's answer, so the cooldown can't be
  checked before the model call. It blocks the mint, not the cost; the daily caps (NFR-012,
  ADR 0006) still bound the cost.
- `card_instances` has no "captured by" column: `owner_id` changes on trade (AC-010.3), so the
  captor of a traded card is lost.
- Cards received in a trade must not start a cooldown (author decision): trading is the quick
  way to get a second copy, which supports G-5.
- Every state change already runs in one IMMEDIATE SQLite transaction (ADR 0004); migrations are
  additive only during the challenge week.

## Options considered
1. **New table `capture_cooldowns (player_id, expansion_id, card_id, last_captured_at)`**,
   read and written in the mint transaction. Pros: additive; one primary-key lookup; keyed on
   captures, so trades can't affect it; storing the capture time (not the expiry) means a new
   setting applies to existing cooldowns at once. Cons: one more table to keep in step with
   minting.
2. **Add `captured_by` to `card_instances`** and look up the latest capture of that card.
   Pros: also records provenance. Cons: changes the hottest table; old rows have no value; needs
   a new index; the query is a `MAX` over instances instead of a key lookup.
3. **In-memory map in the API process.** Pros: no migration. Cons: lost on every restart or
   redeploy, so a restart resets everyone's cooldowns.
4. **`cooldown_hours` in `expansion.yaml`.** Pros: forkable per expansion (G-4). Cons: an admin
   change needs a file edit and a re-seed; the author asked for an admin setting.

## Decision
We will store the last capture time per player and card in a new `capture_cooldowns` table
(option 1). The length comes from the environment variable `CAPTURE_COOLDOWN_HOURS` (default
`5`, a number from 0 to 168; `0` turns the cooldown off), parsed at startup with the rest of the
configuration. Inside the mint transaction, after a valid match and **before** the rarity roll,
the API reads the row: if the last capture is less than the cooldown ago it mints nothing and
answers `cooldown` with the time the card can be captured again; otherwise it upserts the row
and mints. Trades never read or write the table.

## Consequences
- Positive: farming one subject stops paying; exploring and trading become the ways to grow a
  collection; the check is atomic with the mint, so two parallel captures of the same card mint
  at most one; the admin changes the cooldown by editing `.env` and restarting
  (`docker compose up -d`), steps in `docs/deploy.md`.
- Negative / risks:
  - A capture that ends in `cooldown` still used a model call and counts toward the daily
    caps (AC-014.5). The PWA's message names the card and the time, so the player learns
    quickly.
  - With 5 hours, a player cannot capture a duplicate during the 2.5-hour field test (T-014),
    so trades in the test are of different cards; the human may lower the value for the test
    (product.md Q-12).
  - Cards captured before the migration have no row, so they start no cooldown.
- Follow-ups: T-019 builds it (migration `003`, config, outcome in `src/shared/`, PWA message,
  runbook line); `game-invariants-reviewer` reviews it because it touches minting.

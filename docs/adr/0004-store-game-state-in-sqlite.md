# 0004. Store game state in SQLite with better-sqlite3

- Status: Proposed
- Date: 2026-10-07
- Deciders: adricasi

## Context
Game state (players, friendships, card instances, trade offers, daily packs) is small
(≤ 5,000 card instances, NFR-005) and lives on one Droplet (ADR 0002). Trades must swap
ownership atomically and apply exactly one of concurrent actions (AC-010.3–010.8, NFR-009).

## Options considered
1. **SQLite via better-sqlite3** (file on a volume, WAL mode). Pros: no extra service or
   cost; synchronous API makes `BEGIN IMMEDIATE` transactions simple and serialises writers,
   which gives the atomic swap for free; fast tests with an in-memory DB. Cons: single
   writer process; native module build in Docker.
2. **Managed Postgres.** Pros: managed backups, multi-instance. Cons: ~$15/month, network
   dependency, more setup.
3. **Built-in `node:sqlite`.** Pros: no native dependency. Cons: still marked experimental.

## Decision
We will use SQLite through better-sqlite3 with WAL mode and run every state change (capture
mint, trade create/accept/decline/cancel, friend request accept) in an IMMEDIATE transaction
that re-checks ownership and status inside the transaction, because it meets the integrity
requirements at zero cost with the least code.

## Consequences
- Positive: atomicity and serialisation without locks in app code; trivial local setup.
- Negative / risks: one API process only (fine for NFR-005); backups are file copies via the
  SQLite backup API during the challenge week.
- Follow-ups: schema migrations as ordered SQL files applied at startup.

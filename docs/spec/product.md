# Product: TCGrass

- Status: Approved (2026-10-08) <!-- Draft | In review | Approved -->
- Last updated: 2026-10-10 (Q-7/Q-10 closed: DO serverless Gemma 4; earlier: G-7, ADR 0006)
- Input: [idea brief](../discovery/idea-brief.md) (verdict Go, 2026-10-07) ·
  [research notes](../discovery/research-notes.md)

> Photograph the real world to collect its illustrated cards, then trade with your friends.
> Gemma recognises what you photographed (on a server you control, or a provider whose retention
> terms are published) and the photo is deleted. The
> whole expansion (cards, odds, prompts, art) is an open file anyone can fork.

## Problem
People mean to walk, garden and notice nature more, but the phone wins. Existing apps are
either serious identification tools (iNaturalist, Seek, Merlin) or AR games set in a fictional
world (Pokémon GO). Apps that already turn nature photos into cards (Snappit, Wildex, BioSnap)
are closed: photos go to a third-party AI, odds are hidden and the decks cannot be changed.
TCGrass makes photographing the real world the **only** way to get a card, never stores photos
and identifies them with open weights, on our own server or on a provider whose retention terms
we publish (G-3, G-7), and puts the whole deck in an open, forkable file.

This is a motivation problem, not a pain point: TCGrass is a hackathon entry and portfolio
project (DEV *Hacktoberfest Open-Source AI Challenge, Week 1 "Touch Grass"*, event #79).

## Users and personas
| Persona | Needs | Current pain |
|---|---|---|
| **Player** (the author + 1–2 friends/family; later DEV readers) | A reason to go outside, a collection to complete, friends to trade with | Camera-roll photos give no reward loop; card apps are closed and send photos to third parties |
| **Expansion author** (the author now; later clubs, schools, families) | Make a deck with their own cards, odds and art without writing code | Printed scavenger sheets; no app lets you fork the deck |
| **DEV judge / reader** | See a working, fun build where open AI is essential, with a convincing "why open" story | Many entries are thin wrappers around a closed API |

## Goals
- **G-1**: Submit a complete challenge entry (working app, post, 60-s video) before the
  deadline, competing for the overall prize, **Best Use of Gemma** and **Best Use of DigitalOcean**.
- **G-2**: Make the real world the only source of cards: a card is earned by photographing a
  real subject, which Gemma matches to the expansion's catalogue.
- **G-3**: Privacy by design: photos are never stored by TCGrass, and identification runs on
  open weights (Gemma) on infrastructure we control or a provider whose retention terms we
  state (see Q-9).
- **G-4**: Open, forkable content: an expansion (cards, odds, identification hints, art
  prompts, art) is one folder that anyone can copy and load without code changes.
- **G-5**: Social play: players add friends and trade duplicate cards 1:1.
- **G-6**: Near-zero running cost when idle; GPU resources exist only for short tests or bursts (destroyed, not powered off).
- **G-7** (added 2026-10-10, author decision): After the challenge the same build stays online
  as a public product anyone can play, with pay-per-use inference and a hard daily cap on
  model calls so cost stays bounded (ADR 0006).

## Success metrics
| Metric | Target | How it is measured |
|---|---|---|
| Entry submitted (G-1) | Published post + video submitted by **Sun 2026-10-11 22:00 CEST** (hard deadline Sun 23:59 PDT = Mon 2026-10-12 08:59 CEST) | DEV submission timestamp |
| Field test (G-2, G-5) | ≥ 2 players (author included), ≥ 10 cards captured in total, ≥ 1 completed trade between friends, on Sun 2026-10-11 10:00–12:30 CEST | Database counts after the test; documented in the post |
| Identification quality (G-2) | On a 20-photo test set (12 catalogue subjects, 5 non-catalogue, 3 screens/prints): ≥ 80 % correct outcome, 100 % parseable responses, screen rejection reported (best effort; a miss is a stated limitation) | Spike script run against the draft expansion |
| Photo retention (G-3) | 0 photos persisted by TCGrass (DB, API filesystem, API/Caddy logs); self-hosted inference: request logging off; provider inference: its retention and training-use terms cited (Q-9) | Test + manual check after the field test |
| Forkability (G-4) | A second expansion folder (test fixture) loads with **zero code changes** | Seed script test |
| Model swap (G-3) | The same build runs against Gemma on DigitalOcean and Ollama on a laptop by changing env vars only | Shown in the video |
| Cost (G-6) | ≤ $25 total cloud spend for the challenge week; GPU Droplet destroyed after the deadline | DigitalOcean billing |
| Production cost (G-7) | ≤ $50/month total at the default daily call cap, $0 GPU spend in steady state [ASSUMPTION A-13] | DigitalOcean billing, monthly |

## Scope
### In scope (this version)
- Installable web app (PWA) for phones with live camera capture (online only).
- Photo → Gemma identification against the expansion's **closed catalogue**, rejection of
  screens/prints and "no match"; photo deleted right after identification.
- Server-side rarity roll on every capture with published odds; instant card reveal.
- Binder: the expansion catalogue with owned cards (and duplicates) and missing cards.
- Anonymous players, no login: on first launch the app creates a player identity stored
  locally on the device, plus a display name and a friend code. The server keeps the
  collection, friends and trades for that identity, which is the source of truth for ownership.
- Friends: send a request by friend code, the other player accepts or declines; see friends
  and their collections.
- One trading flow: 1:1 offer → recipient inbox with badge (polling) → accept/decline;
  atomic swap on accept; sender can cancel.
- Daily trading pack: 5 cards owned by other players that you can request in a trade.
- First expansion **"Everyday Nature"**: 15 cards (5 trees, 5 flowers, 5 domestic animals),
  one hand-generated watercolour image per card, rarity shown by frame + CSS effect.
- Expansion as a YAML file + images folder, validated and loaded by a seed script.
- Self-hostable deployment (`docker compose up` + env vars) on one DigitalOcean Droplet with HTTPS.

Build priority (cut from the bottom when time runs out): (1) expansion + seed + card frame,
(2) capture → identify → roll → reveal → binder, (3) friends + trading, (4) daily trading pack.

### Non-goals (explicitly out of scope)
- Card Forge (in-app expansion editor or AI image generation).
- Offline capture or offline mode.
- Weather bounties, pack opening, free/daily card drops, stats, leaderboards.
- Web Push or any notification with the app closed.
- In-person trading by QR.
- More than one expansion in the shipped game; per-card rarity modifiers.
- Living cards, duels, narrator voice.
- Login of any kind (password, OAuth, magic link), account recovery, multi-device sync,
  a delete-my-data UI.
- Purchases, currencies or cash-out of any kind.
- ~~An always-on public live demo after the deadline (judges get the video and repo).~~
  Reversed 2026-10-10 by G-7: the game stays online as a public product.
- Native mobile apps.

## Constraints
- **Deadline**: Sun **2026-10-11 23:59 PDT** = Mon 2026-10-12 08:59 CEST; aim to submit by Sun
  22:00 CEST, draft done Sun 18:00 CEST.
- **Availability**: build starts Fri 2026-10-09 afternoon (schedule in tasks.md).
- **Budget**: 14 h total (≈ 8 h of build); ≤ $25 cloud spend for the challenge week; after it,
  ≤ $50/month in production (G-7, A-13).
- **Mandated technology**: Gemma (open weights, Apache 2.0) for identification;
  **DigitalOcean** hosting (prize track; deliberate deviation from the toolkit's GCP default,
  to be recorded as an ADR in the design phase).
- **Stack**: TypeScript on Node.js LTS, ESM (repository scaffold) [ASSUMPTION A-1].
- **HTTPS** is required for camera access in browsers.
- **Age**: demo audience 16+.
- **Image rights**: the image tool's terms must allow publishing the art in an open repo;
  the tool and model are recorded in the expansion's `license.images`.
- Toolkit rules still apply: least privilege, no secrets in code, no push or deploy by agents.

## Glossary
| Term | Meaning |
|---|---|
| Expansion | A themed deck defined by one folder: `expansion.yaml` (cards, odds, prompts, identification instructions) + `images/` |
| Catalogue card | A card type in an expansion (e.g. *Oak*), with name, category, identification hint, art prompt and image |
| Card instance | One copy owned by a player: catalogue card + rarity + owner |
| Rarity | Common, Rare, Epic or Legendary; rolled on capture using the expansion's published odds |
| Capture | Taking a photo that Gemma matches to a catalogue card, minting a new card instance |
| Binder | A player's view of the catalogue: owned cards (with counts) and missing ones |
| Player | An anonymous identity created on first launch and stored on the device; no login |
| Friend code | A short shareable code used to add another player as a friend |
| Trade offer | A 1:1 proposal: one of my card instances for one of theirs |
| Inbox | Received pending trade offers and friend requests, with a badge counting them |
| Available (card instance) | Owned by the shown player at read time and not locked; only available instances can be requested (A-8) |
| Locked | A card instance that its owner has offered in a `pending` trade; the owner cannot offer it again |
| Daily trading pack | 5 card instances owned by other players, offered each day as trade targets |
| Flavor line | A short line of text Gemma writes about the photographed subject, shown on reveal |

## Open questions
Resolved: brief Q-1 (name: TCGrass) and brief Q-3 (anonymous device identity, no login;
reconfirmed 2026-10-07).
- [ ] Q-1 (brief Q-2): Who are the 1–2 other players for the field test?
- [ ] Q-2 (brief Q-4): Final list of the 15 cards. Draft in `~/ideas/tcgrass/everyday-nature.draft.yaml`; adjust after the identification spike.
- [x] Q-3 (brief Q-5): Do trade offers expire? → **No**; offers stay pending until accepted, declined, cancelled or failed (2026-10-07).
- [x] Q-4 (brief Q-6): Can a card in a `pending` offer be offered in another trade? → **No**; a card is locked while it is in a pending offer (2026-10-07).
- [x] Q-5 (brief Q-7): Daily trading pack shared or per player? → **Per player**, fixed for the UTC day (2026-10-07).
- [x] Q-6 (brief Q-8): Which tool/model generates the art (terms allow publication; ideally open)? → **Gemini app (Google), model "Gemini"** (2026-10-09). Google ToS (effective 2026-07-30): Google won't claim ownership of generated content; AI content must not be presented as human-made, so the art is labelled AI-generated (`license.images`, post).
- [x] Q-7: Which inference path is used: DO serverless Gemma, vLLM on a GPU Droplet, or Ollama on a laptop? → **DO serverless `gemma-4-31B-it`** for the field test and production (2026-10-10, ADR 0006 accepted). Earlier: `gemma4:e4b` on laptop Ollama scored 18/18 but p95 14.8 s.
- [x] Q-8: Which hostname is used for HTTPS? → free `<droplet-ip>.sslip.io` name (2026-10-07).
- [~] Q-9: DO serverless is **allowed** (decided 2026-10-07) and is the production path (ADR 0006, 2026-10-10); still open: cite DigitalOcean's data-use, retention and training-use terms for prompts/images in the privacy notice, the post and design.md. Part of accepting ADR 0006.
- [x] Q-10 (added 2026-10-10): Does DO serverless Gemma 4 accept images and pass the spike? → **Yes, with latency accepted** (2026-10-10): DO serverless `gemma-4-31B-it`, 19 spike photos (2026-10-10): 89 % correct (17/19; 12/13 catalogue, 3/3 none, 2/3 screens — the miss became `none`, nothing minted), 100 % parseable, 1 timeout, latency p50 9.1 s / p95 26.4 s; flavor lines clean. The author accepted the latency; NFR-004 revised.
- [ ] Q-11 (added 2026-10-10): Privacy notice and terms for the public product: photos sent to
  the inference provider (DigitalOcean), data kept while the service runs, no account recovery
  (A-2), who the data controller is and a contact address, how a player erases their data
  (GDPR applies: the author is in the EU), and how to report an offensive display name. Needed
  before the public launch, not for the field test (AC-002.11, T-017).

## Assumptions
<!-- Anything decided without confirmation. Mark in text as [ASSUMPTION A-n]. -->
- A-1: The backend is TypeScript/Node (the repo is a TS scaffold), not FastAPI as the brief also allowed.
- A-2: One device = one player. Clearing browser data or losing the phone loses access to that player's cards; acceptable for a hackathon. Re-affirmed 2026-10-10 for the public product (G-7): stated in the privacy notice (Q-11), revisited if players ask for recovery.
- A-3: Exactly one expansion is active in the deployed game.
- A-6: Friendship needs a request + accept (confirmed 2026-10-07); removing friends, blocking and cancelling a sent request are not supported.
- ~~A-7: Server-side capture p95 ≤ 8 s is achievable with the chosen inference path; revisit after the spike.~~
  Superseded 2026-10-10: DO serverless measured p50 9.1 s / p95 26.4 s; the author accepted it
  and NFR-004 was revised to p50 ≤ 10 s, p95 ≤ 30 s.
- A-8: Confirmed 2026-10-07: a locked instance is shown as unavailable and cannot be requested by others until its offer resolves.
- A-9: Confirmed 2026-10-07: the field test runs in Europe (CEST); the daily pack rolls over at 00:00 UTC = 02:00 CEST, outside the test window (Sun 10:00–12:30 CEST).
- A-10: Ollama fallback is reached via an SSH reverse tunnel to the Droplet (end-to-end encrypted, no third party), not ngrok/Cloudflare.
- ~~A-11: Game data is retained until 2026-11-30, then the Droplet and volume are destroyed unless the project continues.~~
  Superseded 2026-10-10 by G-7: the project continues; game data is kept while the production
  service runs.
- A-12 (added 2026-10-10): Production audience for the first months: up to 1,000 players,
  100,000 card instances and about 10,000 captures a month (NFR-013). Revisit with real usage.
- A-13 (added 2026-10-10): Production budget ≤ $50/month: app Droplet + Volume ≈ $13, at
  most ≈ $30 of inference at the default cap of 3,000 model calls per UTC day (≈ $1/day at DO's
  Gemma 4 prices on 2026-10-10), off-box backup storage ≈ $5 (to be confirmed). The author
  adjusts the caps, not the code; the DO inference prepaid balance is kept small as a second stop.

# Requirements: TCGrass

- Status: Approved (2026-10-08) <!-- Draft | In review | Approved -->
- Last updated: 2026-10-10 (AC-003.13 and NFR-012–015 added for public production, ADR 0006)
- Input: [product.md](product.md)

IDs are permanent: never renumber or reuse. Deprecate with ~~strikethrough~~ and a note.
Acceptance criteria use EARS style: `WHEN <trigger> [WHILE <state>] THE SYSTEM SHALL <response>`
(or `IF <unwanted condition> THEN THE SYSTEM SHALL <response>`). Each one must be testable.

Priority follows the build order in product.md: Must = priorities 1–3, Should = priority 4
(cut first), Could = only if time remains.

## Functional requirements

### REQ-001: Load an expansion from its folder
- Story: As an expansion author, I want to describe a deck in one YAML file plus an images
  folder and load it with one command, so that anyone can fork a deck without changing code.
- Priority: Must
- Goals: G-4
- Acceptance criteria:
  - AC-001.1: WHEN the seed command runs on a valid expansion folder THE SYSTEM SHALL store the
    expansion, its catalogue cards, rarity odds, style prompt and identification instructions,
    and report how many cards were loaded.
  - AC-001.2: IF the rarity odds are missing a rarity, contain a negative or non-integer value
    or do not sum to exactly 100 THEN THE SYSTEM SHALL reject the expansion, name the problem and store nothing.
  - AC-001.3: IF two cards share an id, a card id is not lowercase letters, digits and hyphens,
    a required card field (id, name, category, identify_hint, art_prompt) is missing or empty,
    or the expansion's style_prompt or identification.instructions is missing or empty
    THEN THE SYSTEM SHALL reject the expansion, name the card and field, and store nothing.
  - AC-001.4: IF a card has no image at `images/<card id>.png` THEN THE SYSTEM SHALL reject the
    expansion naming the card, unless placeholder mode is enabled, in which case it SHALL load
    the card with a placeholder image for its category and print a warning.
  - AC-001.5: WHEN the seed command runs again for an expansion that is already loaded THE
    SYSTEM SHALL update its data without duplicating catalogue cards and without changing
    existing card instances.
  - AC-001.6: IF a reload would remove a catalogue card that players already own THEN THE SYSTEM
    SHALL reject the reload, name the card and change nothing; IF the removed card is owned
    by nobody THEN THE SYSTEM SHALL delete it.
  - AC-001.7: WHEN a second expansion folder with different cards (test fixture) is seeded THE
    SYSTEM SHALL load it with no code changes.

### REQ-002: Anonymous player identity
- Story: As a player, I want to start playing without signing up, so that I can capture my
  first card within a minute of opening the app.
- Priority: Must
- Goals: G-2, G-5
- Acceptance criteria:
  - AC-002.1: WHEN the app is opened for the first time on a device THE SYSTEM SHALL show a
    notice that the game is for ages 16+ and that photos are deleted after identification.
    (Amended 2026-10-10 for G-7: the notice also says photos are sent to the identification
    service, naming the provider when one is used, and links the privacy notice, AC-002.11.)
  - AC-002.2: WHEN a player is created THE SYSTEM SHALL assign a random secret identifier of
    256 bits and a unique public friend code of 8 uppercase characters from the alphabet
    `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O, 1/I/L); IF a generated friend code already
    exists THEN THE SYSTEM SHALL generate another.
  - AC-002.3: WHEN the app is reopened on the same device THE SYSTEM SHALL resume the same
    player without asking for anything.
  - AC-002.4: IF a display name is empty after trimming, longer than 20 characters or contains
    control characters THEN THE SYSTEM SHALL reject it and explain the rule.
  - AC-002.5: IF a request carries no player identifier or an unknown one THEN THE SYSTEM SHALL
    refuse it as unauthenticated and not reveal whether the identifier exists.
  - AC-002.6: WHEN any player data is shown to another player THE SYSTEM SHALL expose only the
    display name and friend code, never the secret identifier.
  - AC-002.7: IF the secret stored on the device is rejected as unauthenticated THEN THE SYSTEM
    SHALL tell the player their profile was not found and offer to create a new player.
  - AC-002.8: IF more than 10 players are created from one client IP within 60 minutes THEN THE
    SYSTEM SHALL reject further creations from that IP until the window passes.
  - AC-002.9: WHEN a player is created THE SYSTEM SHALL store only a SHA-256 hash of the secret
    identifier on the server.
  - AC-002.10: WHEN the player confirms the notice and enters a valid display name THE SYSTEM
    SHALL create a player, return its secret identifier exactly once in the creation response
    and keep it in the device's storage.
  - AC-002.11 (added 2026-10-10, G-7): WHEN the first-run screen or the profile is shown THE
    SYSTEM SHALL show a link to the privacy notice (Q-11).

### REQ-003: Capture a card by photographing something real
- Story: As a player, I want to photograph a real subject and get the matching card, so that
  going out and looking around is how I grow my collection.
- Priority: Must
- Goals: G-2, G-3, G-7
- Acceptance criteria:
  - AC-003.1: WHEN the player opens the capture screen and grants camera access THE SYSTEM
    SHALL show a live camera preview and a shutter button.
  - AC-003.2: IF camera access is denied or unavailable THEN THE SYSTEM SHALL explain how to
    enable it and SHALL NOT offer file upload as an alternative.
  - AC-003.3: WHEN the player takes a photo THE SYSTEM SHALL downscale it on the device to at
    most 1024 px on the long edge and send it to the server.
  - AC-003.4: WHEN the server receives a photo THE SYSTEM SHALL ask the model to choose one card
    from the active expansion's catalogue (using each card's identify_hint and the expansion's
    instructions) or "none", to report whether the photo shows a screen or print, and to write
    a flavor line about the kind of subject that does not quote text visible in the photo or
    describe people or places.
  - AC-003.5: WHEN the model returns a catalogue card id with confidence at or above the
    configured threshold (default 0.5) and the photo is not of a screen or print THE SYSTEM
    SHALL mint a new card instance of that card for the player.
  - AC-003.6: IF the model returns "none" or a confidence below the threshold THEN THE SYSTEM
    SHALL mint nothing and tell the player "No card here — try something else".
  - AC-003.7: IF the model reports a screen, printed picture or drawing THEN THE SYSTEM SHALL
    mint nothing and tell the player to photograph the real thing.
  - AC-003.8: IF the model response is not valid against the response schema, or names a card
    id not in the catalogue, THEN THE SYSTEM SHALL mint nothing and treat it as "none".
  - AC-003.9: IF the model does not answer within 30 seconds or returns an error THEN THE SYSTEM
    SHALL mint nothing and answer with the outcome `retry`, telling the player to try again.
  - AC-003.10: IF the upload is not a JPEG, PNG or WebP image, or is larger than 5 MB, THEN THE
    SYSTEM SHALL reject it without calling the model.
  - AC-003.11: IF a player submits more than 10 photos that pass the type and size checks within
    60 seconds THEN THE SYSTEM SHALL reject further photos until the window passes and SHALL
    NOT call the model for them.
  - AC-003.12: IF 5 identification calls are already in progress THEN THE SYSTEM SHALL reject the
    capture as temporarily unavailable without calling the model, and the player SHALL see a
    try-again message.
  - AC-003.13 (added 2026-10-10, ADR 0006): IF the model calls counted for the current UTC day
    equal `INFERENCE_DAILY_CALL_LIMIT` (NFR-012) THEN THE SYSTEM SHALL reject further captures
    until 00:00 UTC without calling the model, and SHALL tell the player when captures resume,
    in their local time. Checks run in this order: type and size, per-player limits
    (AC-003.11, AC-003.14), in-flight slot (AC-003.12), then an atomic check-and-increment of
    the daily count just before the call, so rejected photos never use the cap.
  - AC-003.14 (added 2026-10-10, spec review): IF a player has made
    `CAPTURES_PER_PLAYER_PER_DAY` model calls in the current UTC day (default 30) THEN THE
    SYSTEM SHALL reject that player's further captures until 00:00 UTC without calling the
    model, so one player can't use up the shared daily cap.

### REQ-004: Photos are never stored
- Story: As a player, I want my photos deleted right after identification, so that pictures of
  my home and street never accumulate anywhere.
- Priority: Must
- Goals: G-3
- Acceptance criteria:
  - AC-004.1: WHEN identification finishes, with any outcome including errors and timeouts, THE
    SYSTEM SHALL discard the photo so that it does not exist in the TCGrass database, the API
    container's filesystem, or the API and Caddy logs.
  - AC-004.2: WHEN a photo is processed THE SYSTEM SHALL send it only to the configured
    inference endpoint and to no other service.
  - AC-004.3: WHEN a card instance is minted THE SYSTEM SHALL store only the catalogue card,
    rarity, owner, capture time and flavor line, with no image data or image-derived metadata
    (such as EXIF or location).
  - AC-004.4: WHERE the inference server is self-hosted (vLLM or Ollama) THE deployment SHALL
    run it with request-content logging disabled and SHALL reach it only over a private
    network or an end-to-end encrypted tunnel that no third party terminates.

### REQ-005: Server-side rarity roll with published odds
- Story: As a player, I want rarity rolled fairly by odds I can read, so that the random
  reward is trustworthy.
- Priority: Must
- Goals: G-2, G-4
- Acceptance criteria:
  - AC-005.1: WHEN a card instance is minted THE SYSTEM SHALL roll its rarity on the server
    using the active expansion's odds and a cryptographically secure random source.
  - AC-005.2: WHEN 100,000 rolls are drawn from the rarity function THE SYSTEM SHALL produce each
    rarity's share within ±1 percentage point of its published odds.
  - AC-005.3: IF a capture request includes a rarity, card id or any other outcome field THEN
    THE SYSTEM SHALL ignore it.
  - AC-005.4: WHEN the player opens the odds view THE SYSTEM SHALL show the active expansion's
    odds exactly as loaded from its file.

### REQ-006: Instant card reveal
- Story: As a player, I want to see my new card immediately, so that every find feels rewarding.
- Priority: Must
- Goals: G-2
- Acceptance criteria:
  - AC-006.1: WHEN a card instance is minted THE SYSTEM SHALL show a reveal with the card's art,
    name, category, rarity frame and the model's flavor line.
  - AC-006.2: WHEN the revealed card is Epic or Legendary THE SYSTEM SHALL show it with an
    animated foil effect; Common and Rare SHALL use static frames, each rarity distinguishable
    by frame color and label (not color alone).
  - AC-006.3: IF the flavor line is missing or empty THEN THE SYSTEM SHALL show the reveal
    without it; IF it is longer than 140 characters THEN THE SYSTEM SHALL truncate it to 140
    before storing it.
  - AC-006.4: WHEN the flavor line is shown THE SYSTEM SHALL render it as plain text, never as
    markup.
  - AC-006.5: WHEN the player dismisses the reveal THE SYSTEM SHALL return to the live camera
    preview.

### REQ-007: Binder
- Story: As a player, I want to see which cards I have and which I'm missing, so that I know
  what to look for next and what I can trade.
- Priority: Must
- Goals: G-2, G-5
- Acceptance criteria:
  - AC-007.1: WHEN the player opens the binder THE SYSTEM SHALL list every catalogue card of the
    active expansion, showing owned cards with art and the number owned per rarity, and missing
    cards as greyed-out silhouettes with their name.
  - AC-007.2: WHEN the player opens an owned card THE SYSTEM SHALL list each instance with its
    rarity, capture date and whether it is locked in a pending offer.
  - AC-007.3: WHEN the binder is shown THE SYSTEM SHALL show the count of distinct cards owned
    out of the catalogue total (e.g. "7 / 15").

### REQ-008: Friends
- Story: As a player, I want to add friends by code and see their collections, so that I know
  who has what and can trade with them.
- Priority: Must
- Goals: G-5
- Acceptance criteria:
  - AC-008.1: WHEN the player opens their profile THE SYSTEM SHALL show their friend code and a
    way to copy or share it.
  - AC-008.2: WHEN the player enters a friend code THE SYSTEM SHALL trim whitespace and convert
    it to uppercase before matching, and WHEN it matches an existing player who is not the
    sender THE SYSTEM SHALL create a `pending` friend request to that player. Subject to AC-008.3 and
    AC-008.10.
  - AC-008.3: IF the code does not exist THEN THE SYSTEM SHALL say "No player with that code";
    IF it is the player's own code THEN THE SYSTEM SHALL reject it; IF they are already
    friends or a pending request already exists between them in either direction THEN THE
    SYSTEM SHALL create nothing and say so.
  - AC-008.4: IF a player submits more than 10 unknown friend codes within 10 minutes THEN THE
    SYSTEM SHALL reject further attempts until the window passes.
  - AC-008.5: WHEN the player opens a friend THE SYSTEM SHALL show the friend's binder with the
    card instances they own, marking instances the friend has locked in their own pending
    offers as unavailable and not requestable (product.md A-8).
  - AC-008.6: WHEN the player opens the inbox THE SYSTEM SHALL list received `pending` friend
    requests with the sender's display name, and the inbox badge (AC-010.1) SHALL count them.
  - AC-008.7: WHEN the recipient accepts a `pending` friend request THE SYSTEM SHALL make both
    players friends of each other and set the request to `accepted`; WHEN the recipient
    declines it THE SYSTEM SHALL set it to `declined` and create no friendship.
  - AC-008.8: IF an accept or decline targets a request that is not `pending` or comes from a
    player who is not its recipient THEN THE SYSTEM SHALL reject it and change nothing.
  - AC-008.9: WHILE a friend request is `pending` THE SYSTEM SHALL NOT let either player see the
    other's binder or send them trade offers as friends.
  - AC-008.10 (added 2026-10-10, revised the same day): WHEN the recipient declines a friend
    request THE SYSTEM SHALL let the sender send them a new one at once, up to 3 re-sends; IF
    the recipient has declined 4 requests from the sender (the first plus 3 re-sends) within
    24 hours THEN THE SYSTEM SHALL create nothing until 24 hours after the last decline, and
    say when the sender can ask again. After that the count starts over.

### REQ-009: Propose a 1:1 trade
- Story: As a player, I want to offer one of my cards for one of another player's cards and
  keep playing, so that I can complete my collection with my duplicates.
- Priority: Must
- Goals: G-5
- Acceptance criteria:
  - AC-009.1: WHEN the player picks one of their own card instances and one card instance of a
    friend, or of a card in their daily trading pack, and sends the offer THE SYSTEM SHALL
    create the offer with status `pending` and respond within 500 ms server-side without
    waiting for the recipient.
  - AC-009.2: WHEN an offer is created THE SYSTEM SHALL lock the offered card instance so that
    its owner cannot offer it in another trade until the offer leaves `pending`.
  - AC-009.3: IF the offered instance is not owned by the sender, is already locked, or the
    requested instance is not owned by the recipient or is locked THEN THE SYSTEM SHALL reject the offer
    and create nothing.
  - AC-009.4: IF the recipient is the sender, or the requested instance belongs to a player who
    is not a friend and is not in the sender's current daily trading pack, THEN THE SYSTEM
    SHALL reject the offer. The offer's source (friend or daily pack) is decided by the
    server, preferring friend when both apply.
  - AC-009.5: WHEN the sender cancels a `pending` offer THE SYSTEM SHALL set it to `cancelled`
    and unlock the offered card.
  - AC-009.6: WHEN the player opens their sent offers THE SYSTEM SHALL list each with both
    cards, the other player's display name and its status.
  - AC-009.7: WHILE an offer is `pending` THE SYSTEM SHALL keep it pending with no expiry until
    it is accepted, declined, cancelled or failed.
  - AC-009.8 (added 2026-10-10): IF the sender already has 10 `pending` offers to the same
    recipient THEN THE SYSTEM SHALL reject a new offer to them until one of those leaves
    `pending`.

### REQ-010: Inbox, accept and decline
- Story: As a player, I want to see trade offers I've received and accept or decline them, so
  that trades complete while we both keep playing.
- Priority: Must
- Goals: G-5
- Acceptance criteria:
  - AC-010.1: WHILE the app is visible THE SYSTEM SHALL show a badge with the number of received
    `pending` offers and friend requests, refreshed at least every 30 seconds.
  - AC-010.2: WHEN the player opens the inbox THE SYSTEM SHALL list received `pending` offers
    with both cards (including rarity) and the sender's display name.
  - AC-010.3: WHEN the recipient accepts a `pending` offer THE SYSTEM SHALL, in one atomic
    operation, swap the owners of both card instances, set the offer to `accepted` and unlock
    the offered card.
  - AC-010.4: WHEN an offer is accepted THE SYSTEM SHALL set every other `pending` offer that
    involves either of the two card instances to `failed` and unlock their offered cards.
  - AC-010.5: IF, at accept time, either card instance is no longer owned by the expected player
    THEN THE SYSTEM SHALL set the offer to `failed` and change no ownership.
  - AC-010.6: WHEN the recipient declines a `pending` offer THE SYSTEM SHALL set it to
    `declined` and unlock the offered card.
  - AC-010.7: IF an accept, decline or cancel targets an offer that is not `pending`, or comes
    from a player who is not the recipient (accept/decline) or the sender (cancel), THEN THE
    SYSTEM SHALL reject it and change nothing.
  - AC-010.8: WHEN two accepts, or an accept and a cancel, for the same pending offer are
    processed in either order THE SYSTEM SHALL apply the first, reject the second as a state
    conflict, and leave ownership as it was after the first.

### REQ-011: Daily trading pack
- Story: As a player, I want a daily selection of cards owned by other players, so that I can
  trade with people beyond my friends.
- Priority: Should
- Goals: G-5
- Acceptance criteria:
  - AC-011.1: WHEN the player opens the daily trading pack THE SYSTEM SHALL show up to 5 card
    instances owned by other players when the pack was chosen, chosen at random for that
    player.
  - AC-011.2: WHILE the UTC day is the same THE SYSTEM SHALL show the player the same pack;
    WHEN a new UTC day starts THE SYSTEM SHALL choose a new pack.
  - AC-011.3: IF fewer than 5 card instances are owned by other players THEN THE SYSTEM SHALL
    show those that exist, and IF there are none THEN THE SYSTEM SHALL say the pack is empty.
  - AC-011.4: WHEN a pack card changes owner during the day, or is locked in its owner's
    pending offer, THE SYSTEM SHALL show it as unavailable and SHALL NOT allow requesting it.
  - AC-011.5: WHEN the player requests a pack card THE SYSTEM SHALL start the REQ-009 offer
    flow with that card's owner as recipient.

### REQ-012: Swappable model endpoint
- Story: As a self-hoster, I want to point the app at any OpenAI-compatible Gemma endpoint by
  configuration, so that it runs on DigitalOcean or on my laptop with Ollama.
- Priority: Must
- Goals: G-3, G-1
- Acceptance criteria:
  - AC-012.1: WHEN the inference base URL, model name and optional API key are set in the
    environment THE SYSTEM SHALL use that endpoint for identification with no code changes.
  - AC-012.2: IF a required inference setting is missing or malformed at startup THEN THE
    SYSTEM SHALL refuse to start and name the missing setting without printing secret values.
  - AC-012.3: IF the active expansion is not loaded in the database at startup THEN THE SYSTEM
    SHALL refuse to start and name the expansion.

### REQ-013: Installable app
- Story: As a player, I want to add TCGrass to my home screen, so that it opens like an app on
  a walk.
- Priority: Could
- Goals: G-2
- Acceptance criteria:
  - AC-013.1: WHEN the app is opened in Chrome on Android or Safari on iOS THE SYSTEM SHALL be
    installable to the home screen and open full-screen with the TCGrass name and icon.
  - AC-013.2: WHEN the app runs in a Safari tab on iOS (not installed) THE SYSTEM SHALL show,
    before the player is created, a hint to install it to the home screen first, because
    progress does not carry over from the tab to the installed app.

## Non-functional requirements
| ID | Category | Requirement (measurable) | Verification |
|---|---|---|---|
| NFR-001 | Security | All traffic over HTTPS (TLS 1.2+), HTTP redirected (301 or 308) to HTTPS. Player secrets sent only in a request header, never in URLs, never logged. Every API input validated against a schema at the boundary; model output validated against a schema and the catalogue ids. No secrets in the repo (gitleaks in pre-commit and CI). `npm audit --audit-level=high` reports 0. | Tests; CI; manual TLS check (`curl -I http://…` → 301/308 to https) |
| NFR-002 | Privacy / data classification | 0 photos persisted (REQ-004). Stored personal data limited to display name; player secret is a credential (Confidential). No analytics, trackers or third-party scripts. | Tests for REQ-004; grep of DB/disk/logs after field test; review of served HTML |
| NFR-003 | Availability (SLO) | (Challenge week; production: no SLO, best effort, monitored per T-017.) During the field test (Sun 2026-10-11, 10:00–12:30 CEST) ≥ 95 % of API requests succeed (HTTP < 500) and ≥ 90 % of captures end in `card`, `none` or `screen` (not `retry`). No redeploys during the test. Daily DB backup kept 7 days on the same volume (no off-box copy). No SLO after the deadline. | Request log file on the volume; backup test |
| NFR-004 | Performance | Capture: server-side p95 ≤ 8 s (request received → response sent) [ASSUMPTION A-7]. Other API calls: p95 ≤ 500 ms server-side. Upload ≤ 1 MB after on-device downscale. | Per-request latency in the field-test log file; unit test for downscale size |
| NFR-005 | Scalability | Designed for ≤ 50 players, ≤ 5,000 card instances and ≤ 5 concurrent captures. No more. (Challenge week; production target in NFR-013.) | Load script with 5 parallel captures against a stub model |
| NFR-006 | Cost | (Challenge week; production cost in NFR-015.) ≤ $25 total cloud spend for the challenge week. With no GPU resources, idle cost ≤ $12/month. A GPU Droplet is destroyed (not just powered off, which still bills) whenever testing stops and by 2026-10-12 at the latest. | DigitalOcean billing |
| NFR-007 | Observability | Structured JSON logs per request: request id, route, status, latency; per capture: outcome (card id / none / screen / invalid / error) and model latency. Never photo bytes, player secrets or API keys. Health endpoint reporting DB reachability. Request logs also written to a file on the volume so they survive redeploys. | Log-redaction test; manual check of health endpoint |
| NFR-008 | Compliance / licensing | Code and expansion data Apache-2.0; image tool, model and terms recorded in `license.images`; Gemma terms respected; 16+ notice (AC-002.1); no purchases or cash-out. | Review before submission |
| NFR-009 | Data integrity | Card instances are created only by captures and never destroyed or duplicated by trades: every instance has exactly one owner at all times. | Seeded randomized test: 500 interleaved trade actions (create, accept, decline, cancel) across 5 players; invariants checked after every action |
| NFR-010 | Compatibility | Works on the current Chrome for Android and Safari on iOS 17+ phones, portrait, 360–430 px wide. | Manual check on 2 real phones before the field test |
| NFR-011 | Portability | The whole stack starts with `docker compose up` plus env vars, against either DigitalOcean Gemma or local Ollama. | Run once locally with Ollama; once on the Droplet |
| NFR-012 | Cost guardrail (added 2026-10-10) | At most `INFERENCE_DAILY_CALL_LIMIT` model calls per UTC day across all players (default 3,000 ≈ $1/day at DO Gemma 4 prices) and `CAPTURES_PER_PLAYER_PER_DAY` per player (default 30); counts kept in the DB and incremented atomically so restarts and concurrent captures can't exceed them; past a cap, captures are rejected without a model call (AC-003.13, AC-003.14). Each capture log line also records the prompt and completion tokens the endpoint reports (`usage`), so the daily cost can be computed. | Tests with a fake clock, low caps and parallel captures; daily call and token totals from the log file |
| NFR-013 | Scalability, production (added 2026-10-10) | With a DB seeded with 1,000 players, 100,000 card instances and 10,000 offers, `GET /api/binder`, `GET /api/inbox`, `GET /api/daily-pack` and `POST /api/trades` have server-side p95 ≤ 500 ms, and 5 parallel captures against a stub model give no 5xx [ASSUMPTION A-12]. | Load script against a seeded DB (T-017) |
| NFR-014 | Backups, production (added 2026-10-10) | The daily DB backup is also copied off the Droplet, encrypted (it holds secret hashes), kept 7 days, RPO ≤ 24 h; the mechanism uses a credential limited to one bucket or a pull from outside the Droplet (design § Security, T-017); a restore is tested once before the public launch. | Restore drill, documented in the runbook |
| NFR-015 | Cost, production (added 2026-10-10) | ≤ $50/month total in steady state (app Droplet + Volume ≈ $13, inference at the default cap ≈ $30, off-box backup storage ≈ $5 to be confirmed); no GPU resources in steady state [ASSUMPTION A-13]. | DigitalOcean billing, monthly |

## Out of scope
- Login, account recovery, multi-device sync: rejected 2026-10-07 in favour of an anonymous
  device identity (product.md A-2).
- Trade offer expiry: rejected (Q-3); offers stay pending until resolved.
- File upload from the gallery: rejected; cards must come from a live photo (G-2), although
  this cannot prove the photo is new.
- Removing friends, blocking players, cancelling a sent friend request: not needed for 2–3
  known players [ASSUMPTION A-6].
- Everything listed under Non-goals in product.md.

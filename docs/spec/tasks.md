# Tasks: TCGrass

- Status: Approved (2026-10-08) <!-- Draft | In review | Approved -->
- Last updated: 2026-10-10 (T-018 done: DO serverless chosen; earlier: T-016–T-018 added)

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
Order = implementation order. Each task is a small vertical slice (≤ ~1 day), references
the requirements it serves, and has an objective "Done when". 👤 = steps only the human can
do (create/destroy infrastructure, deploy, secrets, image generation, field test).

Time budget: ≈ 8 h of build (product.md). Estimates below: M1–M3 ≈ 9.5 h, i.e. **over
budget by ~1.5 h** (accepted 2026-10-07; the overrun comes out of the cut list or Sat afternoon).

### Schedule (all times CEST; work starts Fri 2026-10-09 afternoon)
| When | Work | Checkpoint |
|---|---|---|
| Before Fri (optional, ≈ 30 min, not build time) | 👤 recruit field-test players (Q-1); pick the image tool and make 3 test images (Q-6, T-012); check the DO account can create a GPU Droplet | — |
| **Fri 10-09, 14:00–19:00** (≈ 5 h) | M1: T-001, T-002a, T-002b; then T-003 | **≈ 16:00 (hour 2)**: inference path chosen, else Ollama fallback. **Kill**: no working Gemma endpoint by Fri 20:00 → skip this week |
| Fri evening (not build time) | 👤 T-012: generate the remaining card art | — |
| **Sat 10-10, 09:00–13:00** (≈ 3–4 h) | T-004, T-005, T-006, T-013 → minimum submittable | **≈ 13:00 (hour 8)**: apply the cut list |
| Sat 10-10, 14:00–17:30 (accepted overrun) | M3: T-007, T-008, T-009; T-011; T-010 only if M3 is done by 16:30 | Deploy the final build by 18:00; no redeploys after that |
| **Sun 10-11, 10:00–12:30** | 👤 T-014 field test, **regardless of state** | — |
| Sun 10-11, 13:00–21:00 | T-015: fixes, 60-s video, post; destroy the GPU Droplet | Draft done 18:00; **submit by 22:00 CEST** (13:00 PDT) |
| Mon 10-12, 08:59 CEST | — | **Hard deadline** (Sun 23:59 PDT) |

- **Minimum submittable**: T-001–T-006 + T-012 (capture, reveal, binder; ≈ 6.5 h).
- **Needed for the field-test trade metric**: T-007–T-009 (Must, but cuttable for submission).
- **Added 2026-10-10 (G-7):** T-016 (0.75 h) is not cuttable when the deploy uses pay-per-use
  inference; T-018 (👤 DO check, ~10 min) runs before T-002b.
- **Cut list, in order**: T-010 (daily pack) → AC-009.6 sent-offers screen → UI component
  tests → T-011 backups and load script → T-013 install (keep the AC-013.2 hint).

## Milestone 1: Walking skeleton (Fri 10-09 afternoon)
- [x] T-001: Inference client + identification spike
  - Estimate: 1 h
  - Requirements: REQ-003 (AC-003.4, 003.8, 003.9), REQ-012
  - Depends on: —
  - Scope: copy `~/ideas/tcgrass/everyday-nature.draft.yaml` to
    `expansions/everyday-nature/expansion.yaml`; `src/shared/` zod schemas for the expansion
    file and the model answer; `src/server/identify/` OpenAI-compatible client (`fetch`, 30-s
    `AbortSignal.timeout`, prompt from the catalogue); `src/server/config.ts` env parsing;
    `scripts/spike-identify.ts` (folder of labelled photos → accuracy report).
    👤 smoke-test DO serverless Gemma with one image; if it fails, create a GPU Droplet with
    vLLM (`--api-key`, firewall) or start Ollama locally; take 20 labelled photos (12 catalogue,
    5 non-catalogue, 3 screen/print) into `spike-photos/` and run the spike script yourself
    (agents are denied that folder); check request logging is off on a self-hosted server
    (AC-004.4); for DO serverless, look up its data terms (Q-9).
  - Done when: unit tests for AC-003.8, AC-003.9, AC-012.1, AC-012.2 pass with a fake
    endpoint; the spike report shows ≥ 80 % correct outcomes and 100 % parseable (cards that
    fail are swapped in the YAML); screen rejection rate recorded (a miss becomes a stated
    limitation); Q-7 resolved and the chosen path + model id recorded in design.md.
  - Result (2026-10-09): done. Spike 18/18 with Ollama + `gemma4:e4b` (design.md § Options
    considered). Deviation approved by the author: the production path part of Q-7 is
    deferred; only the model and local path are recorded. 18 photos, not 20 (2 non-catalogue
    photos missing).
  - Note (2026-10-10): the spike photos are AI-generated (committed on purpose, see AGENTS.md),
    so the spike measures the model on synthetic images; real-world accuracy and screen
    rejection are confirmed by the T-014 field test.

- [x] T-002a: Local skeleton: camera photo → API → Gemma → result on screen
  - Estimate: 1 h
  - Requirements: REQ-003 (AC-003.1–003.3, 003.9, 003.10, 003.12), REQ-012, NFR-001, NFR-007
  - Depends on: T-001
  - Scope: Hono app (`src/server/`) with `/healthz`, security headers + CSP, pino JSON logs
    (stdout + file) with redaction and request id, body limit + magic-byte check, in-flight
    cap, temporary `POST /api/captures` returning the identification outcome (no DB yet);
    Vite + Preact PWA (`web/`) with camera preview, permission-denied message, canvas
    downscale ≤ 1024 px, result text; tsconfig/ESLint split for Node and DOM.
  - Done when: tests for AC-003.3 (downscale size), AC-003.10, AC-003.12 and the
    log-redaction rule pass; on the laptop (localhost) a photo of an oak returns `oak`.
  - Result (2026-10-09): done. Laptop test by the author: webcam photo of a dog returned `dog`
    via Ollama + `gemma4:e4b` (dog instead of oak; same code path, oak verified in the T-001 spike).

- [~] T-002b: Deploy skeleton to the Droplet over HTTPS
  - Estimate: 1 h
  - Requirements: NFR-001, NFR-011, AC-004.4
  - Depends on: T-002a
  - Scope: Dockerfile (non-root, read-only rootfs, current Node LTS), `compose.yaml` (Caddy +
    API, API port unpublished, volume for DB + logs), `Caddyfile` using `PUBLIC_HOSTNAME`;
    `.env.example`. 👤-approved: add PWA build + Docker build to `.github/workflows/`
    (do-not-touch area). 👤 create the Droplet (unattended-upgrades on), Volume, Reserved IP
    and Cloud Firewall (80/443 public, 22 from own IP), tag them per ADR 0002, check the
    sslip.io PSL question, put `.env` on it, `docker compose up -d --build`.
  - Done when: CI green; on a real phone `https://<reserved-ip>.sslip.io` shows the camera and
    a photo of an oak returns `oak`; `curl -I http://…` returns 301/308 to https.
  - Note (2026-10-10, G-7): the field test and production use DO serverless `gemma-4-31B-it`
    (T-018 passed, ADR 0006 accepted), with a production model access key restricted to the
    Droplet's VPC and the VPC-local DNS resolver enabled. **T-016 (daily caps) comes first.**
  - Result (2026-10-10): partial. Agent part done on `infra/T-002b-deploy-skeleton`: Dockerfile,
    `compose.yaml` (+ `compose.local.yaml` for Ollama), `Caddyfile`, API serves `dist/web`,
    runbook `docs/deploy.md`. Waiting on 👤: CI build + Docker build step in
    `.github/workflows/ci-node.yml` (agent edits denied there), Droplet setup, deploy, phone oak
    test, `curl -I` redirect. sslip.io and nip.io are **not** on the Public Suffix List
    (checked 2026-10-10): fallback is a hostname under a listed domain (e.g. duckdns.org).

## Milestone 2: Collect (T-003 Fri evening; rest Sat 10-10 morning)
- [x] T-003: Database + expansion seed command
  - Estimate: 1 h
  - Requirements: REQ-001, AC-012.3
  - Depends on: T-002a
  - Scope: better-sqlite3 setup (WAL, busy_timeout), migrations runner + first migration
    (all tables in design.md), `npm run seed -- <dir> [--placeholders]`, placeholder SVG per
    category, `GET /api/expansion`, `/cards/:expansionId/:cardId` (PNG or placeholder SVG), `ACTIVE_EXPANSION`;
    test fixture expansion in `test/fixtures/expansions/`; startup check
    for the active expansion; 👤 run the seed in prod after deploy.
  - Done when: tests for AC-001.1–001.7 and AC-012.3 pass; seeding `everyday-nature` with
    `--placeholders` succeeds; `GET /api/expansion` returns 15 cards with odds.
  - Result (2026-10-09): done. 155 tests; `npm run seed -- expansions/everyday-nature --placeholders`
    loads 15 cards; `GET /api/expansion` returns 15 cards with odds. Production seed command is
    `npm run seed:prod` (compiled; the runtime image has no tsx). 👤 prod seed waits for T-002b.

- [~] T-004: Anonymous players + auth
  - Estimate: 0.75 h
  - Requirements: REQ-002, REQ-013 (AC-013.2)
  - Depends on: T-003
  - Scope: `POST /api/players`, `GET /api/me`, bearer-secret middleware (SHA-256 lookup),
    friend-code generator with collision retry, per-client-IP creation limit (from Caddy's
    `X-Forwarded-For`); PWA first-run screen (iOS install hint, 16+ notice, photos deleted,
    name input), secret in localStorage, API client attaching the header, "profile not
    found → create new" screen on 401.
  - Done when: tests for AC-002.1–002.10 and AC-013.2 pass;
    reopening the app on the phone resumes the same player.

- [~] T-005: Capture → mint → instant reveal
  - Estimate: 1.5 h
  - Requirements: REQ-003, REQ-004, REQ-005, REQ-006
  - Depends on: T-004
  - Scope: replace the temporary capture route: authenticated, rate limit 10/60 s, decision
    order (invalid → none, screen, threshold), `crypto` rarity roll from expansion odds,
    mint in a transaction, photo dropped in `finally`; reveal screen with art, rarity frames
    (Common/Rare static, Epic/Legendary animated foil, label + color), plain-text flavor line
    truncated to 140 before storing; messages for none/screen/retry.
  - Done when: tests for AC-003.5–003.7, 003.11, AC-004.1–004.3, AC-005.1–005.3,
    AC-006.1–006.5 pass; a photo on the phone produces a revealed card stored in the DB.

- [x] T-016: Daily model-call caps (added 2026-10-10, ADR 0006)
  - Estimate: 0.75 h
  - Requirements: AC-003.13, AC-003.14, NFR-012
  - Depends on: T-005
  - Scope: additive migration with per-UTC-day counters (global and per player); atomic
    check-and-increment just before the model call, after type/size, per-player minute limit
    and in-flight checks (calls that end in `retry` count); `INFERENCE_DAILY_CALL_LIMIT`
    (default 3,000) and `CAPTURES_PER_PLAYER_PER_DAY` (default 30) config; 503 `daily_limit`
    with the resume time; PWA message in local time; log once per day when a cap is reached;
    log the endpoint's `usage` tokens per capture.
  - Done when: tests for AC-003.13, AC-003.14 and NFR-012 pass (fake clock, low caps, parallel
    captures don't overshoot, a restart keeps the counts). Not cuttable if the deploy uses
    pay-per-use inference.

- [~] T-006: Binder + odds view
  - Estimate: 0.75 h
  - Requirements: REQ-007, REQ-005 (AC-005.4)
  - Depends on: T-005
  - Scope: `GET /api/binder`; binder screen (owned with counts per rarity, silhouettes for
    missing, `n / 15`), card detail with instances and lock state, odds screen; bottom
    navigation (Capture · Binder · Friends · Inbox).
  - Done when: tests for AC-007.1–007.3 and AC-005.4 pass; binder correct on the phone after
    3 captures.

## Milestone 3: Social (Sat 10-10 afternoon)
- [~] T-007: Friend requests + friends' binders
  - Estimate: 1 h
  - Requirements: REQ-008
  - Depends on: T-006
  - Scope: friend-request endpoints, unknown-code limit, `GET /api/friends`,
    `GET /api/friends/:friendCode/binder`, `GET /api/inbox` (friend-request part); profile
    screen with friend code + share/copy, add-friend form, friends list, friend binder,
    inbox list of friend requests.
  - Done when: tests for AC-008.1–008.9 pass; two phones become friends and see each other's
    binders.

- [x] T-008: Trade offers: create, cancel, sent list
  - Estimate: 0.75 h
  - Requirements: REQ-009
  - Depends on: T-007
  - Scope: `POST /api/trades` (friend source only for now), partial unique index lock,
    `POST /api/trades/:id/cancel`, `GET /api/trades/sent`; trade picker UI from a
    friend's binder (their card + my card), sent-offers screen.
  - Done when: tests for AC-009.1–009.3, 009.4 (friend case), 009.5–009.7 pass.
  - Follow-up (2026-10-10, author decision): AC-008.10 (friend-request cooldown and re-send
    limit) and AC-009.8 (10 pending offers per pair) added to the spec and built on this branch.
    T-009: add a test that a *declined* offer also frees an AC-009.8 slot.

- [~] T-009: Inbox: accept/decline with atomic swap + badge
  - Estimate: 1 h
  - Requirements: REQ-010, NFR-009
  - Depends on: T-008
  - Scope: accept/decline endpoints in IMMEDIATE transactions with ownership re-check,
    fail other pending offers on the same instances; inbox lists trade offers; badge polling
    every 20 s while the app is visible.
  - Done when: tests for AC-010.1–010.8 pass; the NFR-009 randomized invariant test (500
    seeded actions) passes; a trade between two phones completes and both binders update.

## Milestone 4: Daily trading pack (Sat 10-10, only if M3 is done by 16:30)
- [ ] T-010: Daily trading pack
  - Estimate: 1 h
  - Requirements: REQ-011, REQ-009 (AC-009.4 daily-pack case)
  - Depends on: T-009
  - Scope: lazy per-player pack per UTC day (injected clock + RNG), availability flag,
    `GET /api/daily-pack`, pack screen with "request" starting the trade picker; allow
    `daily_pack` as a trade source.
  - Done when: tests for AC-011.1–011.5 and AC-009.4 (pack case) pass.

## Milestone 5: Field test and ship (Sat 10-10 – Sun 10-11)
- [ ] T-011: Pre-field-test hardening
  - Estimate: 0.5 h
  - Requirements: NFR-001, NFR-002, NFR-003, NFR-005, NFR-010
  - Depends on: T-005
  - Scope: daily SQLite backup (keep 7), load script with 5 parallel captures against a stub
    model, manual phone checklist (`docs/field-test-checklist.md`: install first on iOS,
    camera, capture, profile-not-found recovery, trade if built). 👤 run the checklist on 2
    phones; confirm firewall rules and tags.
  - Done when: backup test passes; load script shows no 5xx at 5 parallel captures (a 6th is
    rejected per AC-003.12); checklist passes on Chrome Android and Safari iOS.

- [x] T-012: 👤 Card art for Everyday Nature
  - Estimate: ~1 h of the human's time, outside build hours
  - Requirements: REQ-001 (AC-001.4), NFR-008
  - Depends on: T-003 (can run in parallel with M2–M3, outside build hours)
  - Scope: resolve Q-6 (tool/model whose terms allow publication); 3 test images (oak, rose,
    dog) for style consistency, then the remaining 12; save as
    `expansions/everyday-nature/images/<id>.png`; fill `license.images`.
  - Done when: seed runs **without** `--placeholders`; `license.images` names tool, model
    and terms.
  - Result (2026-10-09): done. 15 cards at 768×1145 (2:3, spec changed from 3:4), 4.3 MB total;
    seed runs without placeholders; `license.images` = Gemini app (Google), Google ToS cited.

- [~] T-013: Installable PWA
  - Estimate: 0.25 h
  - Requirements: REQ-013 (AC-013.1)
  - Depends on: T-002a; do before T-014 so iOS testers install first
  - Scope: manifest + icons + minimal service worker (app shell only, no offline capture),
    registered without an inline script.
  - Change (2026-10-10, author decision): no vite-plugin-pwa (+274 dev packages). Hand-written
    `web/public/manifest.webmanifest`, `sw.js` and icons (generated by `scripts/make-icons.ts`),
    registered from `web/src/register-sw.ts`.
  - Done when: AC-013.1 checked manually on Android and iOS.
  - Result (2026-10-10): partial. Manifest (`id`, standalone, 192/512 + maskable icons), iOS
    meta tags + 180 px touch icon, app-shell `sw.js` (shell network-first with a 4 s timeout,
    `/assets` cache-first and pruned per deploy, never `/api` or `/cards`), registered after
    `load` in production. 20 new tests. Waiting on 👤: install check on Chrome Android and
    Safari iOS once deployed (T-002b).

- [ ] T-014: 👤 Field test (Sun 2026-10-11 10:00–12:30 CEST, regardless of state)
  - Requirements: success metrics in product.md; NFR-003, NFR-004
  - Depends on: whatever is deployed by Sat 18:00 (at least T-005)
  - Scope: resolve Q-1 (players); walk/garden/birding with ≥ 2 players; afterwards a
    script reports cards captured, trades completed, capture p95 latency, error rate; check
    no photos in DB, API filesystem or API/Caddy logs; no redeploys during the test.
  - Done when: metrics recorded in `docs/spec/progress.md`; issues filed as tasks or noted.

- [ ] T-015: 👤 Submission
  - Requirements: G-1, NFR-006, NFR-008, NFR-011
  - Depends on: T-014
  - Scope: README (what, run locally with Ollama, self-host with compose, fork an
    expansion); DEV post (why open, Mermaid diagram, odds, field-test results); 60-s video
    incl. DO ↔ Ollama swap; GPU Droplet destroyed (not powered off); Q-9 terms cited if DO
    serverless was used.
  - Done when: post published and submitted by Sun 2026-10-11 22:00 CEST (hard deadline Mon 2026-10-12 08:59 CEST); DO billing shows no
    running GPU resources.

## Coverage check
| Requirement | Tasks |
|---|---|
| REQ-001 | T-001, T-003, T-012 |
| REQ-002 | T-004, T-017 (AC-002.1 amended, AC-002.11) |
| REQ-003 | T-001, T-002a, T-005, T-016 (AC-003.13, AC-003.14) |
| REQ-004 | T-005, T-001 + T-002b (AC-004.4) |
| REQ-005 | T-005, T-006 |
| REQ-006 | T-005 |
| REQ-007 | T-006 |
| REQ-008 | T-007 |
| REQ-009 | T-008, T-010 |
| REQ-010 | T-009 |
| REQ-011 | T-010 |
| REQ-012 | T-001, T-002a, T-003 (AC-012.3) |
| REQ-013 | T-004 (AC-013.2), T-013 |
| NFR-001 | T-002a, T-002b, T-011 |
| NFR-002 | T-005, T-011, T-014 |
| NFR-003 | T-011, T-014 |
| NFR-004 | T-002a, T-014 |
| NFR-005 | T-011 |
| NFR-006 | T-015 |
| NFR-007 | T-002a |
| NFR-008 | T-012, T-015 |
| NFR-009 | T-009 |
| NFR-010 | T-011 |
| NFR-011 | T-002b, T-015 |
| NFR-012 | T-016 |
| NFR-013 | T-017 |
| NFR-014 | T-017 |
| NFR-015 | T-017 |

## After the challenge (G-7, added 2026-10-10)
- [x] T-018: 👤 DO serverless check (added 2026-10-10, accepts ADR 0006)
  - Estimate: ~10 min of the human's time
  - Requirements: Q-10, Q-9
  - Depends on: T-001
  - Scope: create a DO inference key; confirm the Gemma vision model id with `GET /v1/models`;
    run `npm run spike -- spike-photos` with the DO `INFERENCE_*` values; note DO's retention
    and training-use terms for prompts and images.
  - Done when: result recorded in design.md (§ Options considered) and product.md Q-7/Q-10;
    ADR 0006 set to Accepted (pass) or its fallback applied (fail).
  - Result (2026-10-10): done. `gemma-4-31B-it`: 19 spike photos (2026-10-10): 89 % correct (17/19; 12/13 catalogue, 3/3 none, 2/3 screens — the miss became `none`, nothing minted), 100 % parseable, 1 timeout, latency p50 9.1 s / p95 26.4 s; flavor lines clean. Latency accepted
    by the author; NFR-004 revised; ADR 0006 accepted. Delete the test key when no longer needed.

- [ ] T-017: Production readiness before the public launch
  - Estimate: ~3 h (agent + human)
  - Requirements: NFR-013, NFR-014, NFR-015, AC-002.1 (amended), AC-002.11, Q-9, Q-11
  - Depends on: T-016, T-018, T-002b
  - Scope:
    - Off-box encrypted backup copy (credential limited to one bucket, or a pull from outside)
      and a documented restore drill (NFR-014).
    - Privacy notice and terms page (Q-11: provider terms, controller and contact, erasure
      route, how to report an offensive name), linked from first run and profile (AC-002.11).
    - Monitoring: uptime check on `/healthz`; an alert when a daily cap is hit; a DO billing
      alert; the DO inference prepaid balance kept small.
    - Log rotation and retention for `LOG_FILE_PATH` and Docker logs on the volume.
    - Patch cadence: Dependabot/Renovate and a monthly base-image rebuild.
    - Migration policy after the challenge week: back up before every migration.
    - NFR-013 load and size check against a seeded DB; add any missing indexes.
    - A permanent hostname (own domain, or sslip.io's rate-limit/PSL status confirmed).
  - Done when: restore drill documented; privacy notice live and linked; uptime, cap and billing
    alerts set; load check meets NFR-013.

# Field-test checklist (T-011, NFR-010)

Run on **two real phones** before the field test (Sun 2026-10-11 10:00 CEST): one with the
current **Chrome for Android**, one with **Safari on iOS 17+**, portrait. Use the deployed build
at `https://<PUBLIC_HOSTNAME>`. Tick each box per phone; note any failure in
`docs/spec/progress.md` with the phone and what you saw.

| # | Check | Expected | Android | iOS |
|---|---|---|---|---|
| 1 | Open the URL in **Safari** (iOS) before creating a player | "Install TCGrass first" hint (AC-013.2) | n/a | [ ] |
| 2 | Install to the home screen and open it from the icon | Opens full screen with the TCGrass name and icon (AC-013.1) | [ ] | [ ] |
| 3 | First run: enter a display name | "TCGrass is for ages 16 and up." and "Your photos are only used to identify the card and are deleted right after." shown; player created; friend code on Profile | [ ] | [ ] |
| 4 | Capture screen, allow the camera | Live preview and a shutter button (AC-003.1) | [ ] | [ ] |
| 5 | Deny the camera (or turn it off in settings), reopen | Explains how to enable it; no file upload offered (AC-003.2) | [ ] | [ ] |
| 6 | Photograph a catalogue subject (e.g. a tree, a flower, a dog) | Reveal with art, name, rarity frame and flavor line within ~30 s (AC-006.1, NFR-004) | [ ] | [ ] |
| 7 | Photograph the **same** subject again | "Already found: <name>. Next one from <local time>" (AC-014.1), unless `CAPTURE_COOLDOWN_HOURS=0` | [ ] | [ ] |
| 8 | Photograph something not in the catalogue | "No card here — try something else" (AC-003.6) | [ ] | [ ] |
| 9 | Photograph a card picture on a screen | "That looks like a screen or a picture. Photograph the real thing!" (AC-003.7; best effort, a miss is a known limitation) | [ ] | [ ] |
| 10 | Binder | New card shown with count; missing cards as silhouettes; `n / 15` (REQ-007) | [ ] | [ ] |
| 11 | Close the app fully and reopen | Same player, same binder (AC-002.3) | [ ] | [ ] |
| 12 | Phone A sends a friend request to B's code; B accepts | Both see each other in Friends and can open the other's binder (REQ-008) | [ ] | [ ] |
| 13 | A offers a trade from B's binder; B opens Inbox | Badge appears within ~30 s; B accepts; both binders swap the cards (REQ-010) | [ ] | [ ] |
| 14 | On a spare install only: clear the site data, reopen | First-run screen again: a new player; the old cards are gone (A-2). Don't do this on a player's phone | [ ] | [ ] |
| 15 | Only if the production DB was reset after players were created: reopen the app | "Profile not found" offers to create a new player (AC-002.7; also covered by tests) | [ ] | [ ] |

## Server checks (laptop and Droplet)
- [ ] `curl -I http://<PUBLIC_HOSTNAME>` answers 301 or 308 to `https://` (NFR-001).
- [ ] `curl -s https://<PUBLIC_HOSTNAME>/healthz` answers OK.
- [ ] DO console: the Cloud Firewall allows inbound TCP 80/443 and UDP 443 from anywhere and
  TCP 22 **only from your IP**; nothing else (design § Security).
- [ ] DO console: Droplet, Volume, Reserved IP and Firewall all carry `app:tcgrass`,
  `env:prod`, `owner:adricasi`, `managed-by:manual` (ADR 0002).
- [ ] `sudo ls -l ${DATA_DIR}/backups/` on the Droplet shows today's `tcgrass-YYYY-MM-DD.db`
  (NFR-003), and `df -h ${DATA_DIR}` shows room for about 8 copies of the DB.
- [ ] `CAPTURE_COOLDOWN_HOURS` in `.env` is the value chosen for the test (product.md Q-12).

## During the test
No redeploys (NFR-003). If something breaks, note the time and the phone; a config-only
restart (`tcgrass-compose up -d api` in `/opt/tcgrass`) is the only allowed change; don't run a release.

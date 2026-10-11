# Make your own deck

A TCGrass deck ("expansion") is plain data: one YAML file and one image per card. Fork the
launch deck, Everyday Nature, and play your own park, school campus, garden or trail. No code
changes needed.

```text
expansions/<id>/
├── expansion.yaml     cards, hints, rarity odds, licence
└── images/<card id>.png
```

The schema in [`src/shared/expansion.ts`](../src/shared/expansion.ts) is the source of truth;
the seed command validates every field and names the card and field of any error.

## 1. Fork Everyday Nature
```bash
cp -r expansions/everyday-nature expansions/my-park
```

## 2. Edit `expansion.yaml`
```yaml
id: my-park                  # must equal the folder name: lowercase letters, digits, hyphens
name: My Park
version: 0.1.0
license:
  data: Apache-2.0           # the licence of this file
  images: >-                 # who made the art, with which tool or model, and its terms
    ...

rarity_odds:                 # integers that sum to exactly 100, rolled on the server
  common: 70
  rare: 22
  epic: 7
  legendary: 1

style_prompt: >-             # shared art style; put it before each art_prompt when making art
  Watercolour field guide illustration, ...

identification:
  instructions: >-           # how the model should choose; keep the "none" and screen rules
    Choose the single catalogue card that matches the main subject of the photo. ...

cards:
  - id: oak                  # unique; "none" and "screen" are reserved
    name: Oak
    category: tree
    identify_hint: Broadleaf tree with lobed leaves and/or acorns.
    art_prompt: A sturdy oak tree in early autumn, lobed leaves turning gold.
```

### Tips for cards that the model can tell apart
- Pick subjects that are common where people will play, and that look different from each
  other in a photo.
- Write each `identify_hint` as the features a camera sees (bark colour, leaf shape, fur
  pattern), not facts from a field guide.
- After changing cards or hints, measure accuracy with your endpoint:
  `npm run spike -- <folder of labelled photos>` (one sub-folder per card id, plus `none/` and
  `screen/`). Keep your own test photos out of the repository: the committed `spike-photos/`
  set holds only AI-generated images.

## 3. Add the art
- One image per card at `images/<card id>.png`, 2:3 portrait (for example 768×1152), at most
  about 350 KB (`scripts/resize-expansion-images.py` helps).
- Generate it with `style_prompt` + the card's `art_prompt`, draw it, or photograph your own
  illustrations.
- Only publish images whose licence or tool terms allow it, and say how they were made in
  `license.images`. Label AI-generated art as AI-generated.
- No art yet? Seed with `--placeholders` to get a simple SVG per category while you test.

## 4. Seed and play
```bash
npm run seed -- expansions/my-park              # add --placeholders while art is missing
# then in .env:
ACTIVE_EXPANSION=my-park
```
Restart the API. It refuses to start if the active expansion isn't loaded, so a typo fails
loudly instead of serving an empty binder.

With Docker Compose, decks are baked into the image, so rebuild first:
`docker compose build`, then
`docker compose run --rm api node dist/server/seed-cli.js expansions/my-park`, set
`ACTIVE_EXPANSION` and run `docker compose up -d`. On a Droplet that pulls releases from the
registry, commit the deck and release it instead (see [deploy.md](deploy.md)).

## Changing a deck that people already play
- Seeding is idempotent and you can add cards at any time. The API loads the deck at startup,
  so restart it after re-seeding.
- Removing a card that players already own is rejected (keep it in the file), so nobody loses a
  card. Removing a card nobody owns is fine; the seed reports it.
- Changing `rarity_odds` affects only future captures. The binder's odds screen always shows
  exactly what's in the file.

## Share it
Open a pull request with your folder (see [CONTRIBUTING.md](../CONTRIBUTING.md)), or publish it
in your own fork and point `ACTIVE_EXPANSION` at it.

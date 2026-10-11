# 0009. Field Journal visual direction for the PWA

- Status: Accepted (2026-10-11, author decision)
- Date: 2026-10-11
- Deciders: adricasi

## Context
The PWA used browser defaults plus a thin token pass (T-020). The author wants a look that is
clean, distinctive and clearly about exploring and collecting nature, not a generic
AI-generated app (no purple gradients, glass effects, emoji icons, plain white shadow boxes),
with cards people want to collect and rarer cards that look more special.

Constraints: CSP `default-src 'self'` and `style-src 'self'` (no third-party fonts or styles, no
inline style attributes); no new runtime dependencies; phone first (NFR-010, 360–430 px);
rarity must not depend on colour alone (AC-006.2); reduced motion respected (AC-006.6). The
card art is already watercolour field-guide plates (`style_prompt` in `expansion.yaml`).

## Options considered
Three directions were mocked up with real card art on a private design board (2026-10-11):
1. **Field Journal**: an explorer's notebook. Parchment, iron-gall ink, moss; rubber-stamp rarity
   seals that escalate to gilt. Fraunces, Figtree, Caveat.
2. **Specimen Cabinet**: a natural-history museum. Cabinet green, brass, typed labels; rarer
   cards behind glass. Instrument Serif, IBM Plex Sans/Mono.
3. **Trailhead Holo**: a dark, bold trading-card look with contour lines and holographic foil.
   Bricolage Grotesque, Space Mono.

## Decision
Field Journal (option 1), chosen by the author. It extends the existing watercolour art instead
of competing with it, and its rarity steps differ in shape and text, not only colour.

- **Fonts**: Fraunces (variable, roman + italic), Figtree (variable) and Caveat 500, Latin subset,
  self-hosted as woff2 in `web/src/assets/fonts/` with their OFL licences (fetched from Google
  Fonts on 2026-10-11). Caveat is for short margin notes only.
- **Icons**: Lucide (ISC), copied as inline SVG paths into one `Icon` component; no package.
- **Texture**: one small SVG noise file in the bundle; no raster textures.
- The style guide lives in `docs/design/style-guide.md`; tokens live on `:root` in
  `web/src/style.css`.

## Consequences
- About 220 KB of fonts on first load (cached afterwards); `font-display: swap` keeps text visible.
- Light theme only for now: the paper look is the brand. A dark "night journal" variant is a
  follow-up, not part of T-024.
- Future screens follow the style guide; reviewers check against it.

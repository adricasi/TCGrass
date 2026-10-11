# TCGrass style guide: Field Journal

Decision: [ADR 0009](../adr/0009-field-journal-visual-direction.md). Tokens live on `:root` in
`web/src/style.css`; this page explains how to use them. Phone first: 360–430 px portrait.

## Idea
An explorer's field journal. The app is the notebook, each card is a plate you found and logged,
and rarity is shown the way a naturalist would: ink stamps, then gilt. The watercolour card art
is the hero; the interface stays quiet paper and ink around it.

## Colour
| Token | Hex | Use |
|---|---|---|
| `--paper` | #F3EBDD | Page ground (with the grain texture) |
| `--paper-raised` | #FBF6EC | Cards, nav, inputs, list rows |
| `--paper-edge` | #CDBF9F | Hairlines, card edges, dividers |
| `--ink` | #2B2A26 | Text, icons, outline buttons |
| `--ink-soft` | #5E574A | Secondary text (≥ 4.5:1 on paper) |
| `--moss` | #4F6B3A | Primary actions, current tab, progress |
| `--river` | #3E5C76 | Rare; margin notes |
| `--rust` | #B5532A | Epic; badges (fills) |
| `--rust-ink` | #9C4522 | Error text (5.4:1 on paper) |
| `--gilt` | #B08A2E | Legendary borders and sheen (decoration only) |
| `--gilt-ink` | #7A5D16 | Legendary text (4.5:1 on paper) |

Text on colour: paper-raised on moss, river, rust and gilt-ink passes AA. Never put text in
`--gilt` itself, and never use `--rust` as text on `--paper` (4.2:1); use `--rust-ink`. Input
borders use `--ink-soft` so fields stay visible (WCAG 1.4.11).

## Type
- **Fraunces** (self-hosted, variable): card names, screen titles, the wordmark. Italic for
  flavor lines.
- **Figtree** (self-hosted, variable): everything you read and tap. 16 px minimum for body and
  inputs (prevents iOS zoom).
- **Caveat** 500: short handwritten margin notes only ("found 11 Oct, 9:42"). Never for
  instructions, errors or buttons.
- Small labels: Figtree 600, 12 px, uppercase, `letter-spacing: 0.12em`.

## Card anatomy
1. Header row: category (and the catalogue number in the binder), small caps, `--ink-soft`.
2. Art: inside a 3 px double rule in the rarity colour.
3. Name: Fraunces 600.
4. Flavor line: Fraunces italic, plain text (AC-006.4).
5. Rarity stamp: a round stamp overlapping the art's bottom-right corner, with the rarity
   written in it (AC-006.2: never colour alone).

| Rarity | Frame | Stamp | Extra |
|---|---|---|---|
| Common | paper edge hairline | single ink ring, `--ink-soft` | none |
| Rare | river hairline + outer ring | double ring, `--river` | none |
| Epic | rust hairline + outer ring | filled `--rust` | animated foil sweep |
| Legendary | gilt border + outer gilt ring | filled `--gilt-ink` seal | warm sheen + foil sweep, glow |

The binder shows the same frame at thumbnail size, plus the rarity label; missing cards are a
dark silhouette in a dashed outline with the name (AC-007.1).

## Icons
Lucide (ISC; licence in `THIRD_PARTY_NOTICES.md`), copied into `web/src/Icon.tsx` as inline SVG paths, stroke 1.75, 24 px, always
next to a text label or with an `aria-label`. One set only; no emoji as icons.

## Components
- **Primary button**: moss fill, paper text, 6 px radius, 48 px tall, subtle bottom ink edge.
- **Secondary button** (`.secondary`): transparent, 1.5 px ink outline.
- **Text link** (`.link`, `.back`): ink, underlined; `.back` has a left arrow icon.
- **Rows** (friends, offers, instances): paper-raised, paper-edge hairline, 8 px radius, a 4 px
  left edge in the rarity colour where a card is involved.
- **Badge**: rust pill, paper text.
- **Notices**: paper-raised box with a dashed ink border, like a note tucked into the journal.

## Motion
- Reveal entry: flip (Common, Rare) or spin + glow (Epic, Legendary), ≤ 1.4 s, tap to skip
  (AC-006.6).
- Foil sweep on Epic and Legendary only. Nothing else loops.
- `prefers-reduced-motion: reduce` turns off every animation and transition.

## Don't
- Purple or blue-violet gradients, glassmorphism, neon glows, drop shadows on everything.
- Emoji as icons; more than one icon set.
- Pure white (#FFF) surfaces or pure black text.
- New colours outside the tokens; Inter, Roboto or system-ui as the visible brand font.
- Inline styles or third-party font/CDN links (CSP `'self'`).

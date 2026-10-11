# Contributing to TCGrass

Thanks for helping! New decks, bug fixes, accessibility improvements and ideas are all
welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help
- **Report a bug or suggest a feature:** open a GitHub issue with what you did, what you
  expected and what happened (browser and phone model help).
- **Share a deck:** see [docs/expansions.md](docs/expansions.md).
- **Send a pull request:** small, focused changes are easiest to review.
- **Security issues:** please don't open a public issue; follow [SECURITY.md](SECURITY.md).

## Set up
```bash
npm ci
cp .env.example .env     # point INFERENCE_* at an Ollama or other OpenAI-compatible endpoint
npm run seed -- expansions/everyday-nature
npm run dev:api          # and in another terminal:
npm run dev:web
```
More options (Docker Compose, Ollama in Docker) are in the [README](README.md#run-it-yourself).

## How we work
- **Spec first.** Requirements live in [docs/spec](docs/spec/) with stable IDs (`REQ-nnn`,
  `AC-nnn.n`, `NFR-nnn`, `T-nnn`). If a change needs different behaviour, propose the spec change
  in the same pull request. Significant decisions get an ADR in [docs/adr](docs/adr/).
- **Tests with every behaviour change.** Bug fixes start with a failing test. Test names start
  with the acceptance criterion they prove, e.g. `it("AC-009.2 locks the offered card …")`.
- **API shapes are defined once,** as zod schemas in `src/shared/`, and imported by both the
  server and the PWA.
- **State changes are one IMMEDIATE SQLite transaction.** Migrations are additive.
- **UI follows the [style guide](docs/design/style-guide.md):** tokens from `style.css`, Lucide
  icons via `Icon.tsx`, no inline styles, nothing loaded from other origins (CSP `'self'`).

### Game rules that must not break
- Photos are never persisted or logged; they go only to the configured inference endpoint.
- Rarity is rolled on the server with `crypto`; never accepted from the client or the model.
- Model output is untrusted: validated against catalogue ids, flavor text shown as plain text.
- Card instances are created only by captures; trades never create or destroy them.
- The player secret is a bearer credential: header only, stored hashed, never logged.
- Only AI-generated images go in `spike-photos/`; never commit real photos of people or places.

## Before you open a pull request
```bash
npm run format
npm run lint && npm run typecheck
npm test
npm run build
```
- Use a branch named `feat/…`, `fix/…`, `docs/…`, `test/…` or `chore/…`.
- Write [Conventional Commits](https://www.conventionalcommits.org/):
  `type(scope): imperative summary`, with a body that explains why and references IDs,
  e.g. `fix(trades): fail other offers on accept (REQ-010)`.
- Fill in the pull request template: what, why, how you tested it, risks and rollback.
- CI runs lint, types, tests with coverage, the build, `npm audit` and a secret scan. All must
  pass.

## AI-assisted contributions
AI tools are welcome. You are responsible for every line: read it, test it and be ready to
explain it in review.

## License
By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE). Deck data keeps the licence named in its `expansion.yaml`.

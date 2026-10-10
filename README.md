# tcgrass

TODO: one-line description of tcgrass.

## Getting started
```bash
npm ci                                   # install from lockfile
npm test                                 # tests (npm test -- --coverage)
npm run lint && npm run typecheck        # lint + types
npm run format                           # format
npm run build                            # compile to dist/
npm audit --audit-level=high             # dependency vulnerabilities
```

## Self-hosting
`docker compose up -d --build` runs Caddy (HTTPS) in front of the API, which serves the PWA,
card art and `/api`, with SQLite in `DATA_DIR`. Copy `.env.example` to `.env` and fill it in
first, and create the data directory writable by the container user
(`mkdir -p data && sudo chown 1000:1000 data`, or your `DATA_DIR`). Seed the expansion once,
before the first start:
`docker compose run --rm api node dist/server/seed-cli.js expansions/everyday-nature`.
The full Droplet runbook is in [docs/deploy.md](docs/deploy.md).

## Identification test set
`spike-photos/<card-id>/` (plus `none/` and `screen/`) holds the labelled images used by
`npm run spike -- spike-photos` to measure identification accuracy. Every image is
AI-generated, so the set shows no real person, home or place. Add only AI-generated images
there; real photos stay out of the repository.

## Development workflow (AI-assisted, spec-driven)
Built with the personal ai-toolkit (`~/ai-toolkit`). In Claude Code:
1. `/spec` — define or refine the specification in `docs/spec/` (once, then when requirements change).
2. `/project-kit` — tailor project-specific agents and skills to the spec.
3. `/next` — implement the next task: branch, tests from acceptance criteria, code, checks, review, commit.
4. `/review-all` then `/ship` — full review (Claude + Gemini) and PR preparation.
5. `/handoff` — leave a progress note for the next session.
Commits run pre-commit (formatters, linters, gitleaks); pushing and merging are done by a human.

## Specification
See [docs/spec](docs/spec/): product, requirements, design and task plan.

## Architecture decisions
See [docs/adr](docs/adr/).

# 0005. Use Hono + zod for the API and Vite + Preact for the PWA, in one package

- Status: Proposed
- Date: 2026-10-07
- Deciders: adricasi

## Context
The repo is a TypeScript (strict, ESM) scaffold on Node 22 (product.md A-1). About 8 h of build
for an API with ~15 endpoints and a PWA with ~7 screens (capture, reveal, binder, friends,
inbox, trade, daily pack). External input must be validated at the boundary.

## Options considered
1. **Hono + zod (API), Vite + Preact (PWA)**. Pros: small, typed; zod schemas shared by client
   and server; Preact gives components/hooks at ~4 KB. Cons: Hono's Node adapter is less
   battle-tested than Fastify.
2. **Fastify + zod, Vite + React.** Pros: mature plugins (rate limit, multipart). Cons: more
   setup for zod typing; heavier client.
3. **Express + vanilla TS.** Pros: familiar. Cons: weak typing, hand-rolled UI state.

Layout options: npm workspaces (`api/`, `web/`, `shared/`) vs **one package** with `src/server`,
`src/shared` and `web/`. Workspaces add config overhead with no benefit for one deployable.

## Decision
We will build the API with Hono (`@hono/node-server`) and zod, and the PWA with Vite + Preact
(+ vite-plugin-pwa), in the existing single npm package: `src/server`, `src/shared`
(schemas and types used by both), `web/` (Vite root). The API serves the built PWA and card
images, because this is the least setup for one deployable while keeping types shared.

## Consequences
- Positive: one lockfile, one CI pipeline, shared schemas.
- Negative / risks: two tsconfig targets (Node and DOM) in one package; handled with separate
  `tsconfig` files and ESLint overrides.
- Follow-ups: exact dependency versions are pinned by the lockfile when added in T-001.

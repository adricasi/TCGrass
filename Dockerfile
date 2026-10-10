# TCGrass API + PWA (design.md § Environments and deployment, ADR 0002).
# Debian slim, not Alpine: better-sqlite3 ships prebuilt binaries for glibc. Pinned by digest
# so a rebuild (or a rollback) gets the same base; bump tag and digest together.

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
# Toolchain only for the fallback in case no better-sqlite3 prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY expansions ./expansions
# Non-root; compose.yaml adds a read-only root filesystem with /data and /tmp writable.
USER node
EXPOSE 3000
CMD ["node", "dist/server/main.js"]

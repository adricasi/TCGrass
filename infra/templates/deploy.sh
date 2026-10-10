#!/usr/bin/env bash
# Pull-based deploy agent (ADR 0008), run every minute by tcgrass-deploy.timer.
# CI moves the :prod tag only after the operator approves a release; this script notices the new
# image, seeds the expansion and restarts the stack. compose.yaml and the Caddyfile come from
# Terraform (cloud-init), never from the image, so a registry push can't change how the host runs
# containers. No inbound connection and no CI credentials on this machine.
set -euo pipefail

: "${API_IMAGE:?}" "${APP_DIR:?}" "${MOUNT_POINT:?}"
cd "$APP_DIR"

# Containers must not reach the metadata service: it serves user data, which holds the registry
# pull credentials. tcgrass-metadata-block.service sets this before Docker starts; this re-check
# only heals the rule if something removed it, and refuses to deploy if it can't.
if ! iptables -t raw -C PREROUTING -d 169.254.169.254/32 -j DROP 2>/dev/null; then
  echo "metadata block missing; restoring it" >&2
  iptables -t raw -I PREROUTING -d 169.254.169.254/32 -j DROP
fi

if [[ ! -f .env ]]; then
  echo "waiting for $APP_DIR/.env (written once by the operator, docs/deploy.md)"
  exit 0
fi
if ! mountpoint -q "$MOUNT_POINT"; then
  echo "data volume is not mounted at $MOUNT_POINT; refusing to deploy without it" >&2
  exit 1
fi

docker pull --quiet "$API_IMAGE" >/dev/null
new_id="$(docker image inspect --format '{{.Id}}' "$API_IMAGE")"
if [[ -f .deployed-image && "$(cat .deployed-image)" == "$new_id" ]]; then
  exit 0
fi
echo "deploying $API_IMAGE ($new_id)"

export API_IMAGE
# The seed is idempotent (AC-001.5) and applies the migrations, which are additive (AGENTS.md).
docker compose run --rm --no-deps api sh -c 'node dist/server/seed-cli.js "expansions/$ACTIVE_EXPANSION"'
# --wait: only a healthy stack counts as deployed; otherwise the next run tries again.
docker compose up -d --no-build --remove-orphans --wait --wait-timeout 120

install -m 600 /dev/null .deployed-image
echo "$new_id" > .deployed-image
docker image prune -f >/dev/null
echo "deployed $new_id"

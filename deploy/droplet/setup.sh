#!/usr/bin/env bash
# One-time (and re-runnable) Droplet setup for pull-based releases (ADR 0008).
# Run as root from a copy of this repository on the Droplet:
#
#   bash deploy/droplet/setup.sh --mount /mnt/<volume-path>
#
# Expects Docker Engine + Compose plugin installed from Docker's apt repository (docs/deploy.md)
# and the data Volume mounted. Each step checks first, so re-running it is safe; re-run it after
# changing compose.yaml or the Caddyfile (they are not part of an image release).
set -euo pipefail

usage() {
  echo "usage: $0 --mount <volume mount point> [--image <registry repo>] [--app-dir <dir>]" >&2
  exit 2
}

mount_point=""
image_repo=""
app_dir="/opt/tcgrass"
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 ]] || usage
  case "$1" in
    --mount) mount_point="${2%/}"; shift 2 ;;
    --image) image_repo="$2"; shift 2 ;;
    --app-dir) app_dir="${2%/}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$mount_point" ]] || usage
# Written into systemd and logrotate files below: accept only plain paths.
[[ "$mount_point" =~ ^/mnt/[A-Za-z0-9_.-]+$ ]] || { echo "--mount must look like /mnt/<name>" >&2; exit 2; }
[[ "$app_dir" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "--app-dir must be an absolute plain path" >&2; exit 2; }
# A re-run keeps the registry chosen before unless --image is given.
if [[ -z "$image_repo" && -f /etc/tcgrass/deploy.env ]]; then
  image_repo="$(sed -n 's/^IMAGE_REPO=//p' /etc/tcgrass/deploy.env)"
fi
image_repo="${image_repo:-registry.digitalocean.com/tcgrass/tcgrass-api}"
[[ "$image_repo" =~ ^[a-z0-9.-]+/[a-z0-9._/-]+$ ]] || { echo "--image must be <registry>/<path>" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
data_dir="$mount_point/tcgrass"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "run as root"
[[ -f "$repo_root/compose.yaml" && -f "$repo_root/Caddyfile" ]] || fail "run from a copy of the repository"

step "Docker"
docker compose version >/dev/null 2>&1 || fail "Docker Engine + Compose plugin not found; install them first (docs/deploy.md)"
docker buildx version >/dev/null 2>&1 || fail "docker-buildx-plugin not found (the agent resolves digests with it)"
docker compose version

step "Packages: jq (agent), sqlite3 (backup checks)"
apt-get -o DPkg::Lock::Timeout=600 install -y jq sqlite3 >/dev/null
echo "ok"

step "Security updates"
systemctl is-active unattended-upgrades >/dev/null && echo "unattended-upgrades active" ||
  echo "WARNING: unattended-upgrades is not active; run: dpkg-reconfigure -plow unattended-upgrades"

step "Block containers from the metadata service (before Docker starts)"
install -m 0644 "$here/tcgrass-metadata-block.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tcgrass-metadata-block.service
iptables -t raw -C PREROUTING -d 169.254.169.254/32 -j DROP || fail "metadata-service block not installed"
echo "rule present"

step "Data volume at $mount_point"
mountpoint -q "$mount_point" || fail "$mount_point is not a mount point (check: df -h | grep /mnt)"
echo "mounted"
# Docker (and restart-policy containers) must never start before the volume is mounted, or the
# API would create a fresh, empty DB on the boot disk.
install -d -m 0755 /etc/systemd/system/docker.service.d
printf '[Unit]\nRequiresMountsFor=%s\n' "$mount_point" > /etc/systemd/system/docker.service.d/10-data-volume.conf
systemctl daemon-reload
# The API container runs as uid/gid 1000. Give that id a dedicated, non-login system account, so
# it has a name (logrotate needs one) and a later admin user (harden-ssh.sh) gets another uid
# instead of sharing ownership of the game data.
if ! getent group 1000 >/dev/null; then
  groupadd --system --gid 1000 tcgrass
fi
if ! getent passwd 1000 >/dev/null; then
  useradd --system --uid 1000 --gid 1000 --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin tcgrass
fi
data_user="$(getent passwd 1000 | cut -d: -f1)"
data_group="$(getent group 1000 | cut -d: -f1)"
[[ "$data_user" == "tcgrass" ]] ||
  echo "WARNING: uid 1000 belongs to '$data_user', not a dedicated account; it owns the game data"
# The DB and its backups hold secret hashes (owner-only).
install -d -o 1000 -g 1000 -m 0700 "$data_dir"
ls -ld "$data_dir"

step "Stack definition in $app_dir (from this repository, never from an image)"
install -d -m 0750 "$app_dir"
install -m 0644 "$repo_root/compose.yaml" "$app_dir/compose.yaml"
install -m 0644 "$repo_root/Caddyfile" "$app_dir/Caddyfile"
ls -l "$app_dir"

step "Log rotation for the API's JSON log"
# The log folder is writable by the container. logrotate runs as root, so it must drop to the
# folder's owner (su) before touching it; otherwise a compromised container could plant a
# symlink and have root truncate or overwrite any file.
cat > /etc/logrotate.d/tcgrass <<CONF
$data_dir/logs/api.log {
  su $data_user $data_group
  daily
  rotate 14
  maxsize 50M
  compress
  missingok
  notifempty
  copytruncate
}
CONF
echo "ok"

step "Deploy agent"
install -d -m 0755 /etc/tcgrass
printf 'IMAGE_REPO=%s\nAPP_DIR=%s\nMOUNT_POINT=%s\nRELEASE_TAG=prod\n' \
  "$image_repo" "$app_dir" "$mount_point" > /etc/tcgrass/deploy.env
install -m 0755 "$here/tcgrass-deploy" /usr/local/bin/tcgrass-deploy
install -m 0755 "$here/tcgrass-compose" /usr/local/bin/tcgrass-compose
install -m 0644 "$here/tcgrass-deploy.service" "$here/tcgrass-deploy.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tcgrass-deploy.timer
systemctl list-timers tcgrass-deploy.timer --no-pager

step "Checks that need you"
registry_host="${image_repo%%/*}"
if [[ -f /root/.docker/config.json ]] && jq -e --arg host "$registry_host" '.auths[$host]' /root/.docker/config.json >/dev/null; then
  chmod 600 /root/.docker/config.json
  echo "registry credentials for $registry_host: present (mode 600)"
else
  echo "TODO: read-only registry credentials missing in /root/.docker/config.json (docs/deploy.md)"
fi
if [[ -f "$app_dir/.env" ]]; then
  chmod 600 "$app_dir/.env"
  grep -q "^DATA_DIR=$data_dir$" "$app_dir/.env" && echo ".env: present (mode 600), DATA_DIR ok" ||
    echo "WARNING: .env should contain DATA_DIR=$data_dir"
else
  echo "TODO: write $app_dir/.env (docs/deploy.md); the agent waits until it exists"
fi

if [[ -s "$app_dir/.deployed-image" ]]; then
  step "Apply the new compose.yaml and Caddyfile to the running release"
  APP_DIR="$app_dir" tcgrass-compose up -d --no-build --remove-orphans --wait --wait-timeout 120
  # The Caddyfile is a bind mount: Caddy reads it at start.
  APP_DIR="$app_dir" tcgrass-compose restart caddy
fi

printf '\nDone. Follow the agent with: journalctl -u tcgrass-deploy -f\n'

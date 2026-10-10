#!/usr/bin/env bash
# Optional SSH hardening: a sudo user with root's SSH key, then no root login and no passwords.
# Run as root:  bash deploy/droplet/harden-ssh.sh <username>
#
# Keep your current root session open until you have logged in as <username> in a SECOND
# terminal and run `sudo -v`. The script validates the config before reloading SSH.
set -euo pipefail

user="${1:-}"
[[ "$user" =~ ^[a-z][a-z0-9-]{1,31}$ ]] || { echo "usage: $0 <username>" >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo "run as root" >&2; exit 1; }
[[ -s /root/.ssh/authorized_keys ]] || { echo "root has no authorized_keys to copy" >&2; exit 1; }

if ! id "$user" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$user"
fi
usermod -aG sudo "$user"
home="$(getent passwd "$user" | cut -d: -f6)"
[[ -n "$home" && -d "$home" ]] || { echo "no home directory for $user" >&2; exit 1; }
install -d -o "$user" -g "$user" -m 0700 "$home/.ssh"
install -o "$user" -g "$user" -m 0600 /root/.ssh/authorized_keys "$home/.ssh/authorized_keys"

if ! passwd -S "$user" | awk '{exit $2 == "P" ? 0 : 1}'; then
  echo "Set a password for sudo (SSH stays key-only):"
  passwd "$user"
fi

# sshd uses the first value it reads and includes sshd_config.d/*.conf in lexical order, so this
# file must sort before cloud-init's 50-cloud-init.conf.
cat > /etc/ssh/sshd_config.d/01-tcgrass-hardening.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
CONF

sshd -t
# The effective settings, after every drop-in, must be the hardened ones before reloading.
effective="$(sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) ')"
echo "$effective"
for setting in "permitrootlogin no" "passwordauthentication no" "kbdinteractiveauthentication no"; do
  grep -qix "$setting" <<<"$effective" || { echo "sshd would not apply: $setting" >&2; exit 1; }
done
# Ubuntu 24.04 starts sshd on demand (ssh.socket); restart when it isn't running. Open
# sessions survive either way.
systemctl reload ssh 2>/dev/null || systemctl restart ssh
echo "Done. In a NEW terminal: ssh $user@<reserved-ip>, then sudo -v. Only then close this session."

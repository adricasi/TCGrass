# Deploying TCGrass

How the stack in `compose.yaml` runs on one DigitalOcean Droplet (ADR 0002, design.md
§ Environments and deployment). **The human runs every command here**; agents only prepare
them. Self-hosting elsewhere uses the same steps from "Deploy" on.

```
phone ──HTTPS──▶ Caddy :443 (Let's Encrypt) ──HTTP──▶ api :3000 (not published)
                 :80 → 308 to HTTPS                  ├─ /api, /cards, PWA (dist/web)
                                                     ├─ SQLite + logs on ${DATA_DIR}
                                                     └─ HTTPS ─▶ INFERENCE_BASE_URL
```

## 1. Droplet setup (once)
Create these in the DigitalOcean console, all in one region. Tag every resource with
`app:tcgrass`, `env:prod`, `owner:adricasi` and `managed-by:manual`.

- [ ] **Droplet:** Ubuntu 24.04 LTS, Basic, 1 GB RAM (the image build runs `tsc` and Vite).
  SSH key login only, monitoring on, in the default VPC.
- [ ] **Volume:** 10 GB, attached to the Droplet. Let the console format and auto-mount it
  (it appears under `/mnt/<volume-name>`).
- [ ] **Reserved IP:** assign it to the Droplet.
- [ ] **Cloud Firewall:** applied to the Droplet's tag.
  - Inbound: TCP 80 and 443, plus UDP 443 (HTTP/3), from anywhere; TCP 22 from your own IP
    only.
  - Outbound: all.
- [ ] **Inference key:** a dedicated DO serverless *model access key*, never a DO API
  token. Restrict it to the Droplet's VPC and enable the VPC-local DNS resolver (G-7,
  ADR 0006). Use the console names from DO's docs; they were not verified here. If the key
  can't be VPC-restricted, a leaked key works from anywhere, so the billing alert matters more.
- [ ] **Billing alert** on the account. `INFERENCE_DAILY_CALL_LIMIT` caps only our own
  server's calls. Rotate the key after the challenge.

On the Droplet: first log in as root once, create a sudo user with your SSH key, set
`PermitRootLogin no` and confirm `PasswordAuthentication no` in `/etc/ssh/sshd_config`. Then
work as that user (`ssh <user>@<reserved-ip>`):

```bash
# Security updates: on by default in Ubuntu 24.04. Check, and enable if needed.
systemctl status unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# 2 GB swap so the image build fits in 1 GB of RAM.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Install Docker Engine and the Compose plugin from Docker's apt repository by following
<https://docs.docker.com/engine/install/ubuntu/>. Then:

```bash
git clone https://github.com/adricasi/TCGrass.git /opt/tcgrass
# The API runs as uid 1000 and needs a writable data directory on the Volume.
sudo mkdir -p /mnt/<volume-name>/tcgrass
sudo chown 1000:1000 /mnt/<volume-name>/tcgrass
# The DB and its backups hold the players' secret hashes: readable by the API user only.
sudo chmod 700 /mnt/<volume-name>/tcgrass
```

Docker-published ports bypass UFW, so the DO Cloud Firewall is what protects the box.

Rotate the API's log file on the Volume. Container stdout is rotated by Compose. Pino
appends, so `copytruncate` is safe:

```bash
sudo tee /etc/logrotate.d/tcgrass <<'CONF'
/mnt/<volume-name>/tcgrass/logs/api.log {
  daily
  rotate 14
  maxsize 50M
  compress
  missingok
  notifempty
  copytruncate
}
CONF
```

### Hostname
`PUBLIC_HOSTNAME` is `<reserved-ip-with-dashes>.sslip.io`, e.g. `203-0-113-7.sslip.io`.

**Check (2026-10-10): neither sslip.io nor nip.io is on the Public Suffix List.** Every user
of either service therefore shares Let's Encrypt's per-domain certificate limit, and issuance
can fail. After the first `up`, run `docker compose logs caddy`:
- `certificate obtained successfully`: done.
- A `rateLimited` error: switch to a hostname under a domain that *is* on the list, such as
  a free `<name>.duckdns.org` with an A record pointing at the Reserved IP. Then set
  `PUBLIC_HOSTNAME` and run `docker compose up -d` again.

### `.env`
Create it with no world-readable window, then fill it in with an editor (never `echo` a
key, which leaves it in shell history). Keep it only on the Droplet:

```bash
install -m 600 /dev/null /opt/tcgrass/.env && nano /opt/tcgrass/.env
```

Set these variables, with the names taken from `.env.example`:

- **Hosting:** `PUBLIC_HOSTNAME`, and `DATA_DIR=/mnt/<volume-name>/tcgrass`.
- **Inference:** `INFERENCE_BASE_URL`, `INFERENCE_MODEL` and `INFERENCE_API_KEY` (secret),
  for DO serverless `gemma-4-31B-it`.
- **Game settings:** `ACTIVE_EXPANSION`, `APP_ENV=production`, `LOG_LEVEL=info`,
  `IDENTIFY_MIN_CONFIDENCE`, `INFERENCE_DAILY_CALL_LIMIT`, `CAPTURES_PER_PLAYER_PER_DAY` and
  `CAPTURE_COOLDOWN_HOURS`.

Compose always sets `PORT`, `DATABASE_PATH`, `LOG_FILE_PATH` and `TRUST_PROXY` itself.

## 2. Deploy
Deploy from a git tag, so a rollback is just checking out the previous tag.

```bash
cd /opt/tcgrass
git fetch --tags && git rev-parse <tag>   # matches the SHA you expect? (tags can move)
git checkout <tag>
docker compose build
# The API refuses to start until the active expansion is seeded (AC-012.3). Seeding migrates
# the DB and runs inside the image, so the stored card-art paths match the container.
docker compose run --rm api node dist/server/seed-cli.js expansions/everyday-nature
docker compose up -d
```

Re-run the seed command only when `expansions/` changes. It refuses to remove cards that
players own.

### Check
```bash
docker compose ps                          # api "healthy", caddy "running"
curl -I http://<hostname>/                 # expect 308 with Location: https://<hostname>/
curl -s https://<hostname>/healthz         # {"status":"ok"}
```

Then, on a real phone, open `https://<hostname>`: the camera preview should appear, and a
photo of an oak should return `oak` (the T-002b Done-when).

Paste back the output of `docker compose ps`, the `curl -I` headers, the `/healthz` body and
the phone result.

### Freeze
No redeploys from Sat 2026-10-10 18:00 CEST until the field test ends (NFR-003).

## 3. Operate
- **Logs:** `docker compose logs -f api` (stdout). JSON request logs are also written to
  `${DATA_DIR}/logs/api.log`, which survives redeploys.
- **Kill switch:** set `INFERENCE_DAILY_CALL_LIMIT=0` in `.env`, then run
  `docker compose up -d api`.
- **Capture cooldown:** set `CAPTURE_COOLDOWN_HOURS` in `.env` (default 5, from 0 to 168,
  decimals allowed, 0 = off), then run `docker compose up -d api`. The new value applies at once
  to cooldowns already running. For the field test, decide before the Saturday 18:00 deploy;
  a config-only restart like this one is allowed until Sun 09:30 CEST (product.md Q-12).
- **Rollback:** `git checkout <previous-tag> && docker compose up -d --build`. Migrations are
  additive during the challenge week, so the DB stays compatible.
- **Backups (NFR-003):** the API writes one online backup per UTC day to
  `${DATA_DIR}/backups/tcgrass-YYYY-MM-DD.db` (at startup if today's is missing, then checked
  hourly) and keeps the newest 7. Each run logs `backup_done`, or `backup_failed` at error level.
  They live on the same Volume as the DB; the off-box copy is T-017.
- **Restore** (everything after that backup is lost):
  ```bash
  B=${DATA_DIR}/backups/tcgrass-YYYY-MM-DD.db
  sudo sqlite3 "$B" 'PRAGMA integrity_check'   # must print "ok"
  docker compose stop api
  sudo install -d -o 1000 -g 1000 -m 700 ${DATA_DIR}/restore-$(date +%F)
  sudo mv ${DATA_DIR}/tcgrass.db* ${DATA_DIR}/restore-$(date +%F)/   # DB, -wal and -shm
  sudo install -o 1000 -g 1000 -m 600 "$B" ${DATA_DIR}/tcgrass.db
  docker compose start api
  ```
  (`sqlite3` may need `sudo apt install sqlite3` on the Droplet.)
- **Load check:** `npm run load -- --parallel 6` (laptop, stub model, no inference cost) expects
  5 × 200 and 1 × 503 `busy` (NFR-005, AC-003.12).
- **Before the field test:** run [field-test-checklist.md](field-test-checklist.md) on both
  phones.

### Service worker kill switch
The PWA's `sw.js` caches only the app shell and `/assets`, and it's served `no-cache`. Phones
pick up a fixed `sw.js` on their next visit. If a deployed worker ever breaks the app,
deleting `sw.js` is **not** enough: a 404 leaves the old worker installed. Replace
`web/public/sw.js` with this, then redeploy:

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});
```

It removes every cache and unregisters itself. Player secrets in localStorage are kept.

## Local run (NFR-011)
To run against Ollama on the laptop:
1. In `.env`, set `INFERENCE_BASE_URL=http://host.docker.internal:11434/v1`,
   `PUBLIC_HOSTNAME=localhost` and `DATA_DIR=./data`.
2. Run `mkdir -p data && sudo chown 1000:1000 data` (the API runs as uid 1000), then the deploy commands above, with
   `-f compose.yaml -f compose.local.yaml` after `docker compose`. The override maps
   `host.docker.internal` to the host; production doesn't get that mapping.

Ollama listens on 127.0.0.1 by default, so a container can't reach it. Bind it to the Docker
bridge address (`OLLAMA_HOST=172.17.0.1`, check with `ip addr show docker0`), not 0.0.0.0:
Ollama's API has no authentication.

Caddy serves `https://localhost` with its own local CA, which browsers warn about.

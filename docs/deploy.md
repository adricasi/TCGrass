# Deploying TCGrass

How the stack in `compose.yaml` runs on one DigitalOcean Droplet: infrastructure created by
hand (ADR 0002), images built by GitHub Actions and stored in DigitalOcean Container Registry,
deployed by an agent on the Droplet after your approval (ADR 0008, design.md § Environments
and deployment). **The human runs every command here**; agents only prepare them.
Self-hosting elsewhere: see "Fallback" and "Local run".

```
                      DuckDNS: tcgrass.duckdns.org ─A─▶ Reserved IP
phone ──HTTPS──▶ Caddy :443 (Let's Encrypt) ──HTTP──▶ api :3000 (not published)
                 :80 → 308 to HTTPS                  ├─ /api, /cards, PWA (dist/web)
                                                     ├─ SQLite + logs on ${DATA_DIR}
                                                     └─ HTTPS ─▶ INFERENCE_BASE_URL
```

Production today: **https://tcgrass.duckdns.org/** on one Droplet in AMS3. The pieces, and why:

| Piece | Choice | Why |
|---|---|---|
| Host | One DigitalOcean Droplet + Volume + Reserved IP | Cheapest setup that runs the whole stack; the Volume keeps the data, the Reserved IP keeps the address (ADR 0002) |
| Domain | DuckDNS subdomain | Free, stable name; on the Public Suffix List, so its own Let's Encrypt limits ([§ Domain](#domain-duckdns)) |
| HTTPS | Caddy | Gets and renews certificates by itself, redirects HTTP, HTTP/3, a 20-line config ([§ HTTPS](#https-caddy)) |
| App | API container serving the PWA and `/api` | One image, one port, never exposed directly |
| Releases | GitHub Actions → DOCR → pull agent on the Droplet | No inbound access for CI; you approve each release (ADR 0008) |
| Inference | DO serverless Gemma (`gemma-4-31B-it`) | No GPU to run; capped per day (ADR 0006) |

## 1. Infrastructure (once, by hand, ADR 0002)
In the DigitalOcean console, all in **AMS3**. Put every resource in a DO **Project**
`tcgrass`, and tag the ones that support tags (Droplet, Volume) with `app:tcgrass`,
`env:prod`, `owner:adricasi` and `managed-by:manual`.

- [ ] **Droplet:** Ubuntu 24.04 LTS, Basic 1 GB, SSH key login only, monitoring on (default VPC).
- [ ] **Volume:** 10 GB attached to the Droplet, "Automatically format & mount" (ext4). Find its
  path with `df -h | grep /mnt` (e.g. `/mnt/volume_ams3_01`); below it is `<VOL>`.
- [ ] **Reserved IP:** assigned to the Droplet.
- [ ] **Cloud Firewall** applied to the Droplet. Inbound: TCP 80 and 443, UDP 443 (HTTP/3) from
  anywhere; TCP 22 from your own IP only. Outbound: all. Docker-published ports bypass UFW, so
  this firewall is what protects the box. Remove the SSH rule when you don't need it.
- [ ] **Container Registry:** `registry.digitalocean.com/tcgrass` (starter tier).
- [ ] **Inference key:** a dedicated DO serverless *model access key*, never a DO API token.
  Restrict it to the Droplet's VPC if the console offers it (it may not). Rotate it after the
  challenge.
- [ ] **Billing alert** on the account. `INFERENCE_DAILY_CALL_LIMIT` caps only our own server.

Install Docker Engine and the Compose plugin from Docker's apt repository
(<https://docs.docker.com/engine/install/ubuntu/>) and check `docker compose version`.

## Domain and HTTPS (once)
### Domain: DuckDNS
**Why DuckDNS.** A phone only allows the camera on `https://`, and a certificate needs a hostname.
[DuckDNS](https://www.duckdns.org/) gives a free subdomain with no domain to buy or renew.
Unlike `sslip.io` or `nip.io` names (which encode the IP), `duckdns.org` is on the
[Public Suffix List](https://publicsuffix.org/) (checked 2026-10-10), so Let's Encrypt counts
certificates per subdomain: we don't share a rate limit with every other user of the service.
The first deploy used `143.198.251.237.sslip.io`; issuance on such names can fail for that
reason. An own domain later works the same way (an A record, or a CNAME to the DuckDNS name).

**Set it up (once):**
1. Sign in at <https://www.duckdns.org/> (GitHub, Google and others), add the subdomain
   (`tcgrass`) and set its **current ip** to the Droplet's **Reserved IP**. Update.
2. The Reserved IP never changes, so no DuckDNS updater (cron or container) is needed. Keep
   the account token private: it can repoint the name.
3. Check from your laptop before the first release:
   ```bash
   dig +short tcgrass.duckdns.org          # must print the Reserved IP
   ```
4. In `/opt/tcgrass/.env`: `PUBLIC_HOSTNAME=tcgrass.duckdns.org` (§ 2c).

DuckDNS serves only A/AAAA (and MX) records: no TXT, so Caddy uses the HTTP and TLS-ALPN
challenges, not the DNS challenge. That's why ports 80 and 443 must stay open in the Cloud
Firewall.

### HTTPS: Caddy
**Why Caddy.** It gets a Let's Encrypt certificate (ZeroSSL as a fallback) for the name in its
config and renews it in the background, with no certbot or cron. It redirects HTTP to HTTPS,
serves HTTP/2 and HTTP/3, and the whole config is the [`Caddyfile`](../Caddyfile) in this repo.
Security headers are set by the API, not Caddy, so they are the same in every setup
(design.md § Security design).

**What the `Caddyfile` does:**
- `{$PUBLIC_HOSTNAME}`: serves exactly that name, taken from `.env` through `compose.yaml`
  (`localhost` gets Caddy's internal CA for local runs).
- `request_body max_size 6MB`: an outer bound; the API enforces the exact photo limit.
- `reverse_proxy api:3000`: everything goes to the API container, whose port is not published.
  Caddy replaces any client-sent `X-Forwarded-For`, so `TRUST_PROXY=true` is safe behind it.
- `encode zstd gzip`: compresses the JS bundle for phones on cellular.
- `header -Server`: hides the server banner.

**How the container runs** (`compose.yaml`): pinned by digest; ports 80, 443 and 443/udp;
read-only filesystem, all capabilities dropped except `NET_BIND_SERVICE`, 128 MB memory
limit; starts only once the API is healthy. Certificates and ACME account keys live in the
`caddy_data` Docker volume, so they survive restarts and releases.

**Requirements for the first certificate:** the A record points at the Reserved IP, TCP 80 and
443 are open to the internet, and `PUBLIC_HOSTNAME` is set. After the first release:
```bash
cd /opt/tcgrass && tcgrass-compose logs caddy | grep -iE "certificate obtained|error"
curl -sI http://tcgrass.duckdns.org/ | head -3     # 308 → https://tcgrass.duckdns.org/
curl -s https://tcgrass.duckdns.org/healthz        # {"status":"ok"}
```
- `certificate obtained successfully`: done; renewals are automatic.
- `rateLimited`, `NXDOMAIN` or `connection refused`: check `dig`, the firewall rules and that
  nothing else listens on port 80. Caddy retries with back-off; fix the cause and run
  `tcgrass-compose restart caddy`.

### Changing the hostname
The hostname is the web origin, and **players live in the browser per origin**: players created
under the old name can't be reached from the new one, and installed home-screen apps keep
opening the old name. Announce the change first. Then:
1. Point the new name at the Reserved IP and check it with `dig`.
2. Set `PUBLIC_HOSTNAME` in `/opt/tcgrass/.env` and run `tcgrass-compose up -d` (Compose
   recreates Caddy with the new name; Caddy gets the new certificate on its own).
3. Link previews and the canonical URL are baked into the image from `PUBLIC_URL`
   (default `https://tcgrass.duckdns.org`, `web/public-url.ts`). CI builds without it, so
   update `DEFAULT_PUBLIC_URL` there and release.

## 2. Prepare the Droplet for releases (once, ADR 0008)
### 2a. Read-only registry credentials
On your laptop, with `doctl` logged in to your account. These credentials can only pull, and
they expire after 90 days (default: never). They are streamed straight into a root-only file
on the Droplet: nothing is written on your laptop or shows up in shell history:

```bash
doctl registry docker-config --expiry-seconds 7776000 |
  ssh root@<reserved-ip> 'umask 077; install -d -m 700 /root/.docker; cat > /root/.docker/config.json'
```

### 2b. `setup.sh`
Copy the repository to the Droplet and run the setup. It is safe to re-run; re-run it whenever
`compose.yaml` or the `Caddyfile` change (they are not part of an image release):

```bash
# on your laptop, from the repository root
rsync -a --delete --exclude .git --exclude node_modules --exclude data --exclude '.env*' \
  --exclude .dev --exclude .claude --exclude .reviews --exclude dist --exclude coverage \
  --exclude spike-photos ./ root@<reserved-ip>:/root/tcgrass-src/
ssh root@<reserved-ip> 'bash /root/tcgrass-src/deploy/droplet/setup.sh --mount <VOL>'
```

It installs `jq` and `sqlite3`; blocks containers from the metadata service before Docker
starts; makes Docker wait for the Volume; creates a non-login system account `tcgrass` for
uid 1000 (the API container's user) and `<VOL>/tcgrass` owned by it (mode 700); puts
`compose.yaml` and the `Caddyfile` in `/opt/tcgrass`; sets up log rotation (as `tcgrass`, not
root, since the container can write the log folder); installs the deploy
agent (`tcgrass-deploy.timer`) and the `tcgrass-compose` helper. It ends with what's still
missing (registry credentials, `.env`). On a re-run with a release already deployed, it also
applies the new `compose.yaml` and restarts Caddy for the new `Caddyfile`.

### 2c. `.env`
Create it with no world-readable window, then fill it in with an editor (never `echo` a key,
which leaves it in shell history). Keep it only on the Droplet:

```bash
install -m 600 /dev/null /opt/tcgrass/.env && nano /opt/tcgrass/.env
```

Set these variables, with the names taken from `.env.example`:

- **Hosting:** `PUBLIC_HOSTNAME`, and `DATA_DIR=<VOL>/tcgrass`.
- **Inference:** `INFERENCE_BASE_URL`, `INFERENCE_MODEL` and `INFERENCE_API_KEY` (secret),
  for DO serverless `gemma-4-31B-it`.
- **Game settings:** `ACTIVE_EXPANSION=everyday-nature`, `APP_ENV=production`,
  `LOG_LEVEL=info`, `IDENTIFY_MIN_CONFIDENCE`, `INFERENCE_DAILY_CALL_LIMIT`,
  `CAPTURES_PER_PLAYER_PER_DAY` and `CAPTURE_COOLDOWN_HOURS`.

Compose always sets `PORT`, `DATABASE_PATH`, `LOG_FILE_PATH` and `TRUST_PROXY` itself.

### 2d. Optional: SSH hardening
`bash /root/tcgrass-src/deploy/droplet/harden-ssh.sh <username>` creates a sudo user with your
key and turns off root login and passwords. Keep the root session open until a second terminal
can `ssh <username>@<reserved-ip>` and `sudo -v`.

### 2e. GitHub (once)
The repository is **private** for now (author decision, 2026-10-11). GitHub Free has no
environment secrets or required reviewers for private repositories, so the workflow runs in
*private mode*: repository secrets, and a release is a manual "Run workflow" on `main`.

- [x] **Workflows:** `deploy.yml` and `CODEOWNERS` are in `.github/` (done 2026-10-11, PR #25).
- [ ] **Variable** (Settings → Secrets and variables → Actions → Variables):
  `DO_REGISTRY_NAME=tcgrass`.
- [ ] **Repository secret** (same page → Secrets): `DO_REGISTRY_TOKEN`, a DO API token with
  only `registry:read` + `registry:update` (the scopes DO's API reference lists for
  `/v2/registry/docker-credentials`) and an expiry date. The workflow passes it to
  `doctl registry login --expiry-seconds` (a pinned `doctl` from the official release, checked
  against a fixed SHA-256 in the workflow; token from the environment), which stores registry
  credentials that expire in 15–25 minutes. To bump `doctl`, update `DOCTL_VERSION` and
  `DOCTL_SHA256` together, from that release's `checksums.sha256` file. Each login
  creates a short-lived token that shows up under **API → Tokens** until it expires; that is
  expected. `DO_REGISTRY_USERNAME` is no longer needed (delete it). In a private repository only
  collaborators (you) can run workflows that read it; **keep it that way** (no other
  collaborators with write access). The workflow refuses to run if the repository is public.
- [ ] **Branch protection** on `main` if your plan offers it for private repositories.

**Before making the repository public** (it must be public for the challenge submission),
switch to the reviewed public mode. Until then **`deploy.yml` refuses to run** in a public
repository, so no release can be made; the running app is not affected. Public mode: environments
`registry` and `production` (both limited to `main`; you as required reviewer on
`production`), the two secrets moved into both environments and deleted at repository level,
the environment-gated workflow (ask for it, ADR 0008), branch protection and `CODEOWNERS`
review. Repository secrets in a public repository could be targeted by pull requests.

## 3. Release (ADR 0008)
1. Merge to `main`. The `build` job of `deploy.yml` pushes `tcgrass-api:sha-<commit>`; wait
   until it is green.
2. **Release = your click:** Actions → **deploy** → **Run workflow** → branch `main`, leave
   *commit* empty for the latest `main` (or paste a full SHA of a commit on `main`) → **Run
   workflow**. The `release` job refuses commits that aren't on `main` or have no image yet.
3. It points `:prod` at that image. Within a minute the Droplet's agent resolves the
   digest, pulls it, seeds the expansion (idempotent; migrations are additive) and runs
   `docker compose up -d --wait`. A release is recorded in `/opt/tcgrass/.deployed-image` only
   once the stack is healthy.
   - **If the seed fails**, nothing was restarted; the agent tries again next minute.
   - **If the new stack isn't healthy**, the agent rolls back to the previous release, writes
     the bad one to `/opt/tcgrass/.failed-image` and doesn't retry it until `:prod` moves.
     To retry the same image on purpose (e.g. after fixing `.env`), delete that file.

Follow it on the Droplet: `journalctl -u tcgrass-deploy -f`.

**Rollback:** "Run workflow" with the full SHA of an earlier commit on `main`.

**Freeze:** during the field test, don't run the release (NFR-003).

**Registry space:** the starter tier holds 500 MiB, only a few images. When it is full, builds
fail and nothing can be released. Delete old `sha-*` tags in the console (**never** the one
`:prod` points to: same digest as `/opt/tcgrass/.deployed-image`), then run the registry's
garbage collection; or move to the basic tier ($5/month).

### Check
```bash
cd /opt/tcgrass
tcgrass-compose ps                          # api "healthy", caddy "running"
curl -I http://<hostname>/                  # expect 308 with Location: https://<hostname>/
curl -s https://<hostname>/healthz          # {"status":"ok"}
```

Then, on a real phone, open `https://<hostname>`: the camera preview should appear, and a
photo of an oak should return `oak` (the T-002b Done-when).

### Fallback: build on the Droplet
If releases don't work in time: stop the agent (`systemctl stop tcgrass-deploy.timer`) and any
running stack (`tcgrass-compose down` in `/opt/tcgrass`), clone the repository,
`docker compose build`, seed with
`docker compose run --rm api node dist/server/seed-cli.js expansions/everyday-nature` and
`docker compose up -d` from that clone, using the same `.env` (needs ~2 GB of swap on 1 GB).

## 4. Operate
- **Compose on the Droplet:** use `tcgrass-compose …` (in `/opt/tcgrass`), which pins the
  deployed release; plain `docker compose up` would look for a local image.
- **Logs:** `tcgrass-compose logs -f api` (stdout); the agent: `journalctl -u tcgrass-deploy`. JSON request logs are also written to
  `${DATA_DIR}/logs/api.log`, which survives redeploys.
- **Kill switch:** set `INFERENCE_DAILY_CALL_LIMIT=0` in `/opt/tcgrass/.env`, then run
  `tcgrass-compose up -d api`.
- **Capture cooldown:** set `CAPTURE_COOLDOWN_HOURS` in `.env` (default 5, from 0 to 168,
  decimals allowed, 0 = off), then run `tcgrass-compose up -d api`. The new value applies at once
  to cooldowns already running. For the field test, decide before the last release; a
  config-only restart like this one is allowed until Sun 09:30 CEST (product.md Q-12).
- **Rollback:** see § 3 (re-run the release with an earlier commit). Migrations are additive
  during the challenge week, so the DB stays compatible.
- **Expiring credentials** (put reminders in your calendar): the Droplet's registry
  credentials (90 days from § 2a: repeat it) and `DO_REGISTRY_TOKEN` (its expiry date:
  create a new token, update the secret). Expired credentials stop releases, not the running
  app; the agent logs `could not resolve … :prod` every minute.
- **Certificates** live in Caddy's `caddy_data` Docker volume on the **boot disk**: a rebuilt
  Droplet requests a new one (fine for duckdns.org). Renewals are automatic. Use the exact
  `PUBLIC_HOSTNAME` as the URL: the certificate covers only that name. Hostname changes:
  [§ Changing the hostname](#changing-the-hostname).
- **Backups (NFR-003):** the API writes one online backup per UTC day to
  `${DATA_DIR}/backups/tcgrass-YYYY-MM-DD.db` (at startup if today's is missing, then checked
  hourly) and keeps the newest 7. Each run logs `backup_done`, or `backup_failed` at error level.
  They live on the same Volume as the DB; the off-box copy is T-017.
- **Restore** (everything after that backup is lost):
  ```bash
  set -u
  DATA_DIR=<VOL>/tcgrass                  # the same value as in /opt/tcgrass/.env
  B=${DATA_DIR}/backups/tcgrass-YYYY-MM-DD.db
  sudo sqlite3 "$B" 'PRAGMA integrity_check'   # must print "ok"
  tcgrass-compose stop api
  sudo install -d -o 1000 -g 1000 -m 700 ${DATA_DIR}/restore-$(date +%F)
  sudo mv ${DATA_DIR}/tcgrass.db* ${DATA_DIR}/restore-$(date +%F)/   # DB, -wal and -shm
  sudo install -o 1000 -g 1000 -m 600 "$B" ${DATA_DIR}/tcgrass.db
  tcgrass-compose start api
  ```
  (`setup.sh` installs `sqlite3`.)
- **Load check:** `npm run load -- --parallel 6` (laptop, stub model, no inference cost) expects
  5 × 200 and 1 × 503 `busy` (NFR-005, AC-003.12).
- **Before the field test:** run [field-test-checklist.md](field-test-checklist.md) on both
  phones.

### Service worker kill switch
The PWA's `sw.js` caches only the app shell and `/assets`, and it's served `no-cache`. Phones
pick up a fixed `sw.js` on their next visit. If a deployed worker ever breaks the app,
deleting `sw.js` is **not** enough: a 404 leaves the old worker installed. Replace
`web/public/sw.js` with this, then release it:

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
2. Run `mkdir -p data && sudo chown 1000:1000 data` (the API runs as uid 1000), then
   `docker compose build`, the seed command and `docker compose up -d` ("Fallback" above), with
   `-f compose.yaml -f compose.local.yaml` after `docker compose`. The override maps
   `host.docker.internal` to the host; production doesn't get that mapping.

Ollama listens on 127.0.0.1 by default, so a container can't reach it. Bind it to the Docker
bridge address (`OLLAMA_HOST=172.17.0.1`, check with `ip addr show docker0`), not 0.0.0.0:
Ollama's API has no authentication.

Caddy serves `https://localhost` with its own local CA, which browsers warn about.

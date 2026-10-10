# Deploying TCGrass

How the stack in `compose.yaml` runs on one DigitalOcean Droplet (ADR 0002, ADR 0008,
design.md § Environments and deployment): infrastructure from Terraform, releases from
GitHub Actions with your approval, pulled by an agent on the Droplet. **The human runs every
command here**; agents only prepare them. Self-hosting elsewhere: see "Fallback" and
"Local run".

```
phone ──HTTPS──▶ Caddy :443 (Let's Encrypt) ──HTTP──▶ api :3000 (not published)
                 :80 → 308 to HTTPS                  ├─ /api, /cards, PWA (dist/web)
                                                     ├─ SQLite + logs on ${DATA_DIR}
                                                     └─ HTTPS ─▶ INFERENCE_BASE_URL
```

## 1. Infrastructure with Terraform (once)
Everything in DigitalOcean except the inference key lives in [`infra/`](../infra/) (ADR 0008):
VPC, Droplet (set up by cloud-init), Volume, Reserved IP, Cloud Firewall, Container Registry,
project and tags (`app:tcgrass`, `env:prod`, `owner:adricasi`, `managed-by:terraform`).
**You run `plan` and `apply`**; agents only write and validate the code.

### 1a. By hand, before the first `init`
- [ ] **Spaces bucket** for the state, in `ams3`, private, e.g. `tcgrass-tfstate-<you>`; and a
  **Spaces access key** limited to that bucket if the console offers it.
- [ ] **DO API token for Terraform** (it creates Droplets, Volumes, VPCs, firewalls, Reserved
  IPs, tags, projects and the registry). Keep it in your shell only.
- [ ] **Billing alert** on the account.

### 1b. Plan and apply (from your laptop)
```bash
cd infra
cp backend.hcl.example backend.hcl            # fill in the bucket name (git-ignored)
cp terraform.tfvars.example terraform.tfvars  # your SSH public key, your IP/32, registry name
export DIGITALOCEAN_TOKEN=...                  # Terraform token (not saved anywhere)
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...   # Spaces key
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan > plan.json         # optional: hand it to iac-reviewer
terraform apply tfplan
terraform output                                 # reserved_ip, public_hostname, ssh_command, vpc_id
```
Cloud-init takes 3–5 minutes after the apply: Docker, the Volume mounted at `/mnt/tcgrass`, the
data folder (`/mnt/tcgrass/data`, uid 1000, mode 700), log rotation, unattended upgrades and the
deploy agent (`tcgrass-deploy.timer`). Check it with
`ssh root@<reserved_ip> cloud-init status --wait`.

The Volume and the registry have `prevent_destroy`. Changing the cloud-init template does not
touch the running Droplet; rebuild it on purpose with
`terraform apply -replace=digitalocean_droplet.app` (the Volume and the IP survive; write
`.env` again afterwards).

### 1c. Inference key (by hand, ADR 0006)
A dedicated DO serverless *model access key*, never a DO API token. Restrict it to the VPC from
`terraform output vpc_id` and enable the VPC-local DNS resolver. Use the console names from DO's
docs; they were not verified here. Rotate it after the challenge.

### 1d. GitHub (once)
- [ ] **Workflows** (agents can't edit `.github/workflows/`): from the repo root,
  `cp .reviews/workflows/*.yml .github/workflows/ && git apply .reviews/ci-node.patch`,
  then review and commit them yourself.
- [ ] **Variable** (repository) `DO_REGISTRY_NAME` = your `registry_name`.
- [ ] **Environment `registry`**: deployment branches = `main` only, no reviewer.
- [ ] **Environment `production`**: deployment branches = `main` only, **you as required
  reviewer**. The release job can't run without your approval.
- [ ] **Environment secrets in both** (never repository secrets, which any workflow could
  read): `DO_REGISTRY_USERNAME` (your DO account email) and `DO_REGISTRY_TOKEN`, a DO API
  token used only to push images, with an expiry date. DO's docs don't say which custom
  scopes a push needs: try `registry:read` + `registry:update`, and widen only if the push
  is refused.
- [ ] **Branch protection** on `main` (PR required): anyone who can push to `main` can also
  push images with the `registry` environment's token.

### Hostname
`PUBLIC_HOSTNAME` is `terraform output -raw public_hostname`, e.g. `203-0-113-7.sslip.io`.

**Check (2026-10-10): neither sslip.io nor nip.io is on the Public Suffix List.** Every user
of either service therefore shares Let's Encrypt's per-domain certificate limit, and issuance
can fail. After the first deploy, run `docker compose logs caddy` in `/opt/tcgrass`:
- `certificate obtained successfully`: done.
- A `rateLimited` error: switch to a hostname under a domain that *is* on the list, such as
  a free `<name>.duckdns.org` with an A record pointing at the Reserved IP. Then set
  `PUBLIC_HOSTNAME` and run `docker compose up -d` again.

### `.env` (once, on the Droplet)
The deploy agent waits until this file exists. Create it with no world-readable window, then
fill it in with an editor (never `echo` a key, which leaves it in shell history):

```bash
ssh root@<reserved_ip>
install -m 600 /dev/null /opt/tcgrass/.env && nano /opt/tcgrass/.env
```

Set these variables, with the names taken from `.env.example`:

- **Hosting:** `PUBLIC_HOSTNAME`, `DATA_DIR=/mnt/tcgrass/data` and
  `API_IMAGE=<terraform output -raw api_image>` (so manual `docker compose` commands use the
  registry image too).
- **Inference:** `INFERENCE_BASE_URL`, `INFERENCE_MODEL` and `INFERENCE_API_KEY` (secret),
  for DO serverless `gemma-4-31B-it`.
- **Game settings:** `ACTIVE_EXPANSION=everyday-nature`, `APP_ENV=production`,
  `LOG_LEVEL=info`, `IDENTIFY_MIN_CONFIDENCE`, `INFERENCE_DAILY_CALL_LIMIT`,
  `CAPTURES_PER_PLAYER_PER_DAY` and `CAPTURE_COOLDOWN_HOURS`.

Compose always sets `PORT`, `DATABASE_PATH`, `LOG_FILE_PATH` and `TRUST_PROXY` itself.

## 2. Deploy (CI/CD, ADR 0008)
1. Merge to `main`. `deploy.yml` builds the image and pushes `tcgrass-api:sha-<commit>`.
2. The `release` job waits for **your approval** in GitHub (environment `production`).
3. Approving moves `:prod` to that commit. Within about a minute the Droplet's agent pulls it,
   seeds the expansion (idempotent; migrations are additive) and runs
   `docker compose up -d --wait`. A release counts as deployed only once the stack is healthy;
   otherwise the agent retries every minute (fix forward, or roll back below).

`compose.yaml` and `Caddyfile` on the Droplet come from Terraform (cloud-init), not from the
image, so a registry push can't change how the host runs containers. When you change either
file: `scp compose.yaml Caddyfile root@<reserved_ip>:/opt/tcgrass/` then
`docker compose up -d` there (or replace the Droplet on purpose, see 1b).

Watch it on the Droplet: `journalctl -u tcgrass-deploy -f`.

**Rollback:** run the `deploy` workflow by hand ("Run workflow") with the full SHA of an earlier
commit on `main`, and approve it. Migrations are additive during the challenge week, so the DB
stays compatible.

**Freeze:** during the field test, don't approve releases (NFR-003).

**Registry space:** the starter tier holds 500 MiB. Old `sha-*` tags add up; delete them in the
console and run the registry's garbage collection, or move to the basic tier.

### Check
```bash
cd /opt/tcgrass
docker compose ps                          # api "healthy", caddy "running"
curl -I http://<hostname>/                 # expect 308 with Location: https://<hostname>/
curl -s https://<hostname>/healthz         # {"status":"ok"}
```

Then, on a real phone, open `https://<hostname>`: the camera preview should appear, and a
photo of an oak should return `oak` (the T-002b Done-when).

### Fallback: build on the Droplet
If CI/CD isn't working in time, the Droplet Terraform created can still build from source:

```bash
ssh root@<reserved_ip>
systemctl stop tcgrass-deploy.timer                          # keep the agent out of the way
git clone https://github.com/adricasi/TCGrass.git /opt/tcgrass-src && cd /opt/tcgrass-src
git checkout <commit>
cp /opt/tcgrass/.env .env && sed -i '/^API_IMAGE=/d' .env   # build locally instead of pulling
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
docker compose build
docker compose run --rm api node dist/server/seed-cli.js expansions/everyday-nature
docker compose up -d
```

## 3. Operate
- **Logs:** `docker compose logs -f api` (stdout). JSON request logs are also written to
  `${DATA_DIR}/logs/api.log`, which survives redeploys.
- **Kill switch:** set `INFERENCE_DAILY_CALL_LIMIT=0` in `/opt/tcgrass/.env`, then run
  `docker compose up -d api` in `/opt/tcgrass`.
- **Capture cooldown:** set `CAPTURE_COOLDOWN_HOURS` in `.env` (default 5, from 0 to 168,
  decimals allowed, 0 = off), then run `docker compose up -d api`. The new value applies at once
  to cooldowns already running. For the field test, decide before the last deploy; a
  config-only restart like this one is allowed until Sun 09:30 CEST (product.md Q-12).
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
- **Registry pull credentials** expire after `pull_credentials_ttl_days` (default 90). Before
  that: `terraform apply -replace=digitalocean_container_registry_docker_credentials.pull`,
  then copy the new `docker_credentials` to `/root/.docker/config.json` (mode 600) on the
  Droplet (cloud-init doesn't re-run).
- **Plans hold secrets:** `tfplan` and `plan.json` contain the pull credentials in clear text;
  they're git-ignored, delete them after review.
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
2. Run `mkdir -p data && sudo chown 1000:1000 data` (the API runs as uid 1000), then the
   "Fallback" commands above from `docker compose build` on, with
   `-f compose.yaml -f compose.local.yaml` after `docker compose`. The override maps
   `host.docker.internal` to the host; production doesn't get that mapping.

Ollama listens on 127.0.0.1 by default, so a container can't reach it. Bind it to the Docker
bridge address (`OLLAMA_HOST=172.17.0.1`, check with `ip addr show docker0`), not 0.0.0.0:
Ollama's API has no authentication.

Caddy serves `https://localhost` with its own local CA, which browsers warn about.

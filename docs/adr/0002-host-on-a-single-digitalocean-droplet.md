# 0002. Host on a single DigitalOcean Droplet with Docker Compose

- Status: Proposed
- Date: 2026-10-07
- Deciders: adricasi

## Context
The toolkit's default cloud is GCP, but TCGrass targets the **Best Use of DigitalOcean** prize
track (product.md G-1). Constraints: ≈ 8 h of build, ≤ $25 cloud spend for the week (NFR-006),
HTTPS required for the camera, ≤ 50 players (NFR-005), and a self-hosting story
(`docker compose up`, NFR-011). The GPU used for inference must be switchable off without
taking the app down.

## Options considered
1. **One small CPU Droplet + Docker Compose (Caddy + Node API + SQLite volume)**, inference on a
   separate endpoint. Pros: ~$6/month, automatic HTTPS via Caddy, same compose file works on a
   laptop, GPU independent of the app. Cons: we operate the box (updates, backups, firewall).
2. **App Platform + Managed Postgres.** Pros: managed deploys and TLS. Cons: ~$20–30/month,
   ephemeral filesystem forces Postgres, weaker self-host story.
3. **Everything on a GPU Droplet.** Pros: one machine. Cons: app is down whenever the GPU is
   off; $0.76–1.57/h while up.
4. **GCP (Cloud Run + Cloud SQL / Vertex AI).** Pros: toolkit default. Cons: forfeits the
   DigitalOcean track.

## Decision
We will run the app on one small DigitalOcean CPU Droplet with Docker Compose (Caddy → Node API
serving the PWA and card images, SQLite on an attached volume), because it is the cheapest
option that keeps the app up while the GPU is off and doubles as the self-hosting setup.

## Consequences
- Positive: low cost; identical local and production stacks; fits the prize track.
- Negative / risks: single point of failure (acceptable: NFR-003 covers only the field test);
  manual ops. Mitigate with a DO Cloud Firewall (22 from the author's IP only, 80/443 public),
  unattended security upgrades and a daily SQLite backup copy during the challenge week.
- Deviation from the GCP standard is deliberate and limited to this project. Least privilege
  and no secrets in the repo still apply.
- Infrastructure as code: **accepted deviation for the hackathon** — the human creates the
  Droplet, Volume, Reserved IP and Cloud Firewall with the console/doctl (no Terraform); every
  resource is tagged `app:tcgrass`, `env:prod`, `owner:adricasi`, `managed-by:manual`. If the
  project continues after 2026-10-11, port it to Terraform.
- Follow-ups: no agent runs create/delete commands; enabling unattended security upgrades is
  part of the Droplet setup step in tasks.md.

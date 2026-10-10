# 0008. Provision DigitalOcean with Terraform and deploy approved images by pull

- Status: Accepted (2026-10-10, author decision)
- Date: 2026-10-10
- Deciders: adricasi
- Supersedes: the "Infrastructure as code: accepted deviation" consequence of ADR 0002 (the
  rest of ADR 0002 stands: one Droplet, Docker Compose, Caddy, SQLite on a Volume)

## Context
ADR 0002 let the author create the Droplet, Volume, Reserved IP and firewall by hand for the
hackathon, and port them to Terraform if the project continued. G-7 (2026-10-10) keeps it online
as a public product, and the author, a cloud engineer, chose on 2026-10-10 to provision with
Terraform and release through GitHub Actions before the first deploy. The toolkit standard is
"all infrastructure is code; every change is reviewed as a plan; the human applies".

Constraints: agents never apply or deploy; secrets never in the repo or CI logs; the firewall
allows SSH only from the operator's IP, and GitHub's hosted runners have no fixed IPs; no
redeploys during the field test (NFR-003); cost ≤ $50/month (NFR-015).

## Options considered
**Infrastructure**
1. **Terraform, DigitalOcean provider, state in DO Spaces with the S3 backend lock file.**
   Pros: same account and region; DO documents the backend; locking via `use_lockfile`.
   Cons: the bucket and its keys are created by hand first (bootstrap).
2. HCP Terraform for state. Pros: managed locking and run UI. Cons: another account and token.
3. Stay manual (ADR 0002). Pros: fastest tonight. Cons: drift, no review of changes.

**Releases**
1. **Pull-based:** CI builds and pushes `tcgrass-api:sha-<commit>` to DO Container Registry; a
   release job behind a GitHub environment with the operator as required reviewer moves
   `:prod`; a systemd timer on the Droplet pulls `:prod` every minute and restarts the stack.
   Pros: no inbound access from CI, no SSH key or DO firewall token in GitHub, the Droplet only
   holds read-only registry credentials. Cons: up to a minute of delay; an agent to maintain.
2. Push over SSH: CI opens port 22 to the runner's IP through the DO API, deploys, closes it.
   Pros: immediate. Cons: GitHub holds an SSH key and a firewall-capable token; a failed job can
   leave 22 open.
3. Build on the Droplet from git (today's runbook). Pros: simple. Cons: needs swap on 1 GB,
   slow, and nothing records what is running.

## Decision
We will provision every DigitalOcean resource except the inference key with **Terraform**
(`infra/`, state in Spaces, `apply` run locally by the operator), and release with **pull-based
CD**: images built and pushed by `deploy.yml`, promoted to `:prod` only after the operator's
approval, and pulled by `tcgrass-deploy.timer` on the Droplet. `compose.yaml` and the
`Caddyfile` on the Droplet come from Terraform (cloud-init), **never from the image**: the
agent runs Compose as root, so a stack definition taken from a pushed image would turn
registry push into root on the host (security review, 2026-10-10). The registry secrets are
GitHub **environment** secrets (`registry` for the build, `production` with the operator as
required reviewer for the release), both limited to `main`. CI runs `fmt`, `validate` and
`terraform test` (mocked provider) without cloud credentials.

## Consequences
- Positive: every resource reviewed as a plan and tagged `managed-by:terraform`; releases are
  approved, recorded and reversible (re-run `deploy` with an older commit); the field-test freeze
  is "don't approve"; no inbound path from CI.
- Negative / risks:
  - Registry pull credentials sit in Terraform state, plan files and the Droplet's user data
    (read-only, expire after 90 days). Containers are blocked from the metadata service
    (`DOCKER-USER` rule set by the agent).
  - Anyone who can push to `main` can push images; branch protection on `main` is the
    control. A pushed image runs as the non-root, read-only `api` container and can read its
    environment (the inference key) and the DB.
  - A change to `compose.yaml` or the `Caddyfile` needs an `scp` to the Droplet or a
    replacement; it doesn't ship with a release.
  - The cloud-init template is ignored after creation (`ignore_changes`); changing it means
    replacing the Droplet on purpose (`-replace`), then writing `.env` again.
  - The starter registry tier (500 MiB) fills with old `sha-*` tags; garbage collection or the
    basic tier.
  - Bootstrap by hand: Spaces bucket and keys, Terraform token, GitHub environment and secrets,
    the inference key (ADR 0006) and `/opt/tcgrass/.env`.
  - DO's docs don't state which custom token scopes a registry push needs; the push token is
    scoped by trial (`registry:read` + `registry:update` first).
- Follow-ups: T-022 builds it; T-017 adds off-box backups, monitoring and Dependabot for the
  provider and actions; consider a non-root SSH user and `PermitRootLogin no` in cloud-init.

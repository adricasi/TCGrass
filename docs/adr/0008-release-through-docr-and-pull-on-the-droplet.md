# 0008. Release images through DigitalOcean Container Registry and pull them on the Droplet

- Status: Accepted (2026-10-11, author decision)
- Date: 2026-10-11
- Deciders: adricasi
- Amends: ADR 0002 (how code reaches the Droplet). Infrastructure stays manual, as ADR 0002 says.

## Context
The Droplet, Volume, Reserved IP and Cloud Firewall exist, created by hand (ADR 0002). Until now
a release meant SSH, `git checkout` and `docker compose build` on a 1 GB Droplet. The author
wants GitHub Actions to build the image, store it in **DigitalOcean Container Registry**
(`registry.digitalocean.com/tcgrass`, created by hand) and an automation to deploy it.

Constraints: the repository is public; SSH is open only to the operator's IP and GitHub's runners
have no fixed IPs; no redeploys during the field test (NFR-003); agents never deploy; the
toolkit's rule that a pushed artifact must not be able to take over the host.

Facts checked on 2026-10-11:
- GitHub: self-hosted runners "should almost never be used for public repositories"
  (docs.github.com, *Secure use reference*).
- Watchtower (containrrr) was archived on 2025-12-17 and gets no security patches.
- No public DOCR webhook for image pushes was found.
- `doctl registry docker-config` creates read-only credentials by default (`--read-write`
  defaults to `false`) that never expire unless `--expiry-seconds` is given.

## Options considered
1. **GitHub Actions deploys over SSH.** Pros: the common tutorial pattern, immediate. Cons: GitHub
   holds an SSH key and a DO token able to change the firewall (to admit the runner's IP), or SSH
   is opened to the internet.
2. **Self-hosted GitHub runner on the Droplet.** Pros: outbound only. Cons: GitHub advises against
   it for public repositories (pull requests can run code on the host).
3. **Watchtower.** Pros: off the shelf. Cons: archived, unpatched, needs the Docker socket.
4. **DOCR webhook.** Not available publicly.
5. **Tailscale (private SSH from CI).** Pros: no public SSH. Cons: a third-party service and key.
6. **Pull agent on the Droplet.** A systemd timer resolves `:prod` to a digest every minute and,
   when it changes, pulls by digest with read-only registry credentials, seeds and restarts the
   stack. Pros: outbound only; GitHub holds only a push token; nothing deploys without the
   operator's approval. Cons: up to a minute of delay; a small script to maintain.

## Decision
We will use option 6. `deploy.yml` builds the image on every push to `main` and pushes
`tcgrass-api:sha-<commit>` (GitHub environment `registry`, `main` only); a `release` job behind
the environment `production` (operator as required reviewer) points `:prod` at that image. On
the Droplet, `tcgrass-deploy.timer` runs `deploy/droplet/tcgrass-deploy`, which deploys **by
digest** and records a release only once `docker compose up --wait` reports the stack healthy.

`compose.yaml` and the `Caddyfile` on the Droplet are installed by the operator with
`deploy/droplet/setup.sh`, **never taken from the image**: the agent runs Compose as root, so a
stack definition inside a pushed image would turn registry push into root on the host. Containers
are blocked from the metadata service before Docker starts, and Docker waits for the data Volume.

**Private-repository mode (2026-10-11, author decision).** While the repository is private on
GitHub Free, environment secrets and required reviewers are unavailable (GitHub docs,
*Deployments and environments*). Until it goes public, the registry secrets are repository
secrets, builds run on every push to `main`, and a release runs only when the operator
triggers `deploy` by hand on `main` (the click is the approval); the release job accepts only
commits on `main` with an existing image. Before the repository is made public, it switches to
the environment-gated mode above. In this mode the manual trigger is enforced only by the
workflow on `main`: anyone with write access could push a branch whose workflow reads the
repository secrets and moves `:prod`, and GitHub Free private repositories enforce neither
branch protection nor `CODEOWNERS`. The control is that the owner is the only collaborator
with write access (security review, 2026-10-11).

**Registry credentials in CI (2026-10-11, end-to-end review).** The workflow never runs
`docker login` with the DO token. DigitalOcean's `action-doctl` (pinned, `no_auth`) installs a
pinned `doctl`, and `doctl registry login --expiry-seconds` (token from the environment, never
in a config file) stores registry credentials that expire in 25 minutes (build) or 15 minutes
(release); `docker logout` removes them at the end. BuildKit is pinned
by version and digest. In private mode the workflow refuses to run if the repository is public.

## Consequences
- Positive: no SSH key or firewall-capable token in GitHub; port 22 stays limited to the
  operator; releases are approved, recorded by digest and reversible (re-run the release with an
  older commit); the field-test freeze is "don't approve".
- Negative / risks:
  - GitHub holds one DO token that can push images (environment secret, `main` only). DOCR has
    no per-tag permissions, so anyone who can change `main` can change the workflow and move
    `:prod`: the `production` approval is a **release step, not a security boundary**. The
    controls are branch protection on `main` and `CODEOWNERS` review for `.github/` and
    `deploy/`.
  - A pushed image runs as uid 1000 (`user:` in `compose.yaml`), with all capabilities dropped,
    `no-new-privileges`, a read-only root filesystem, no Docker socket and no metadata access.
    Its reach is the DB, the API's environment (the inference key) and outbound network.
  - A release that fails its health check is rolled back to the previous one and not retried
    until `:prod` moves (`.failed-image`).
  - The Droplet holds read-only registry credentials (`/root/.docker/config.json`, mode 600) that
    expire after 90 days; rotate them (runbook).
  - A change to `compose.yaml` or the `Caddyfile` is not part of a release: re-run `setup.sh`.
  - The starter registry tier (500 MiB) fills with old `sha-*` tags; delete old tags and run the
    registry's garbage collection, or move to the basic tier.
  - Infrastructure is still manual (ADR 0002); Terraform remains a follow-up.

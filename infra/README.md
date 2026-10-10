# infra/ — TCGrass on DigitalOcean (Terraform)

One root module, one environment (`prod`), region `ams3`. Decision: [ADR 0008](../docs/adr/0008-provision-with-terraform-and-deploy-by-pull.md).
Runbook: [docs/deploy.md](../docs/deploy.md) § 1.

| File | What |
|---|---|
| `versions.tf` | Terraform ≥ 1.11, `digitalocean/digitalocean ~> 2.105` (lock file committed) |
| `backend.tf` | S3 backend on DO Spaces with `use_lockfile`; bucket/key/endpoint from `backend.hcl` |
| `network.tf` | VPC and Cloud Firewall (22 from `admin_cidrs` only; 80/443 TCP, 443 UDP public) |
| `compute.tf` | SSH key, data Volume (`prevent_destroy`), Droplet with cloud-init, Reserved IP, project |
| `registry.tf` | Container Registry (`prevent_destroy`) and read-only pull credentials for the Droplet |
| `locals.tf` | Names and the tag set `app`, `env`, `owner`, `managed-by:terraform` |
| `templates/` | cloud-init, the pull-based deploy agent and its systemd units |
| `tests/` | `terraform test` with a mocked provider (no credentials) |

## Credentials (never in files)
- `DIGITALOCEAN_TOKEN`: DO API token for the provider.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`: Spaces key for the state bucket.
- `backend.hcl` and `terraform.tfvars` are git-ignored; copy them from the `.example` files.

## Checks (safe, no credentials)
```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
tflint --recursive
```

## Plan and apply (operator only)
```bash
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan > plan.json   # review, e.g. with the iac-reviewer agent
terraform apply tfplan
```
Agents never run `apply`, `destroy`, `import`, `state` or `-replace`.

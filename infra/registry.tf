resource "digitalocean_container_registry" "this" {
  name                   = var.registry_name
  subscription_tier_slug = var.registry_tier
  region                 = var.region

  lifecycle {
    prevent_destroy = true
  }
}

# Read-only pull credentials for the Droplet's deploy agent. Sensitive: they end up in state and
# in the Droplet's user data. CI pushes with its own token (GitHub secret), never with these.
resource "digitalocean_container_registry_docker_credentials" "pull" {
  registry_name = digitalocean_container_registry.this.name
  write         = false
  # Not the ~50-year default. Rotate before it ends (docs/deploy.md § Operate).
  expiry_seconds = var.pull_credentials_ttl_days * 24 * 60 * 60
}

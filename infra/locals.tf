locals {
  name = "tcgrass-${var.environment}"

  project_environment = {
    prod    = "Production"
    staging = "Staging"
    dev     = "Development"
  }[var.environment]

  # ADR 0002/0008 tagging rule; DigitalOcean tags are flat strings.
  tags = {
    app        = "app:tcgrass"
    env        = "env:${var.environment}"
    owner      = "owner:${var.owner}"
    managed_by = "managed-by:terraform"
  }

  volume_name = "${local.name}-data"
  # Where cloud-init mounts the volume; DATA_DIR in /opt/tcgrass/.env points inside it.
  mount_point = "/mnt/tcgrass"
  api_image   = "registry.digitalocean.com/${digitalocean_container_registry.this.name}/tcgrass-api:prod"
}

resource "digitalocean_tag" "this" {
  for_each = local.tags
  name     = each.value
}

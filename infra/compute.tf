resource "digitalocean_ssh_key" "operator" {
  name       = "${local.name}-operator"
  public_key = var.ssh_public_key
}

resource "digitalocean_volume" "data" {
  name                    = local.volume_name
  region                  = var.region
  size                    = var.volume_size_gb
  initial_filesystem_type = "ext4"
  description             = "TCGrass ${var.environment}: SQLite DB, logs and daily backups (NFR-003)."
  tags                    = [for tag in digitalocean_tag.this : tag.name]

  # Holds all game state.
  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_droplet" "app" {
  name       = local.name
  image      = "ubuntu-24-04-x64"
  region     = var.region
  size       = var.droplet_size
  vpc_uuid   = digitalocean_vpc.this.id
  ssh_keys   = [digitalocean_ssh_key.operator.fingerprint]
  monitoring = true
  ipv6       = true
  # Data lives on the volume, so the boot disk can stay small and the Droplet can shrink later.
  resize_disk = false
  # Lets SQLite and Docker stop cleanly before a destroy or replace.
  graceful_shutdown = true
  # Attached at creation, so the device exists when cloud-init mounts it.
  volume_ids = [digitalocean_volume.data.id]
  tags       = [for tag in digitalocean_tag.this : tag.name]

  user_data = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    volume_name        = local.volume_name
    mount_point        = local.mount_point
    api_image          = local.api_image
    docker_config_b64  = base64encode(digitalocean_container_registry_docker_credentials.pull.docker_credentials)
    deploy_script_b64  = base64encode(file("${path.module}/templates/deploy.sh"))
    deploy_service_b64 = base64encode(file("${path.module}/templates/tcgrass-deploy.service"))
    deploy_timer_b64   = base64encode(file("${path.module}/templates/tcgrass-deploy.timer"))
    auto_upgrades_b64  = base64encode(file("${path.module}/templates/20auto-upgrades"))
    # The stack definition comes from this repository, never from the pulled image: a registry
    # push must not be able to change what runs as root on the host (ADR 0008).
    compose_b64   = base64encode(file("${path.module}/../compose.yaml"))
    caddyfile_b64 = base64encode(file("${path.module}/../Caddyfile"))
  })

  lifecycle {
    # Both would replace the Droplet (provider docs). Data lives on the volume and the Reserved IP
    # keeps the address, so a replacement is safe, but only on purpose:
    # `terraform apply -replace=digitalocean_droplet.app` (docs/deploy.md).
    ignore_changes = [user_data, ssh_keys]
  }
}

resource "digitalocean_reserved_ip" "app" {
  region     = var.region
  droplet_id = digitalocean_droplet.app.id
}

resource "digitalocean_project" "this" {
  name        = local.name
  description = "TCGrass collectible card game (DEV Hacktoberfest 'Touch Grass')."
  purpose     = "Web Application"
  environment = local.project_environment
  resources = [
    digitalocean_droplet.app.urn,
    digitalocean_volume.data.urn,
    digitalocean_reserved_ip.app.urn,
  ]
}

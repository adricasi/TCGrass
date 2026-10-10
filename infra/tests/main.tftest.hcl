# Offline checks with a mocked provider: no credentials, no real resources.
# Run: terraform init -backend=false && terraform test

mock_provider "digitalocean" {
  # Droplet ids are numeric; other resources reference them as numbers.
  mock_resource "digitalocean_droplet" {
    defaults = {
      id = "424242"
    }
  }
  mock_resource "digitalocean_reserved_ip" {
    defaults = {
      ip_address = "203.0.113.10"
    }
  }
  mock_resource "digitalocean_ssh_key" {
    defaults = {
      fingerprint = "aa:bb:cc"
    }
  }
  mock_resource "digitalocean_container_registry_docker_credentials" {
    defaults = {
      docker_credentials = "{\"auths\":{}}"
    }
  }
}

variables {
  ssh_public_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAItest test@example"
  admin_cidrs    = ["198.51.100.7/32"]
  registry_name  = "tcgrass-test"
}

run "ssh_only_from_admin_cidrs_and_web_open" {
  command = apply

  assert {
    condition = alltrue([
      for rule in digitalocean_firewall.this.inbound_rule :
      rule.port_range != "22" || rule.source_addresses == toset(["198.51.100.7/32"])
    ])
    error_message = "Port 22 must be open to admin_cidrs only."
  }

  assert {
    condition = length([
      for rule in digitalocean_firewall.this.inbound_rule : rule
      if contains(["80", "443"], rule.port_range)
    ]) == 3
    error_message = "Expected public 80/tcp, 443/tcp and 443/udp."
  }
}

run "every_taggable_resource_carries_the_standard_tags" {
  command = apply

  assert {
    condition = toset(digitalocean_droplet.app.tags) == toset([
      "app:tcgrass", "env:prod", "owner:adricasi", "managed-by:terraform",
    ])
    error_message = "Droplet tags must follow the tagging rule (ADR 0008)."
  }

  assert {
    condition     = toset(digitalocean_volume.data.tags) == toset(digitalocean_droplet.app.tags)
    error_message = "The volume must carry the same tags as the Droplet."
  }
}

run "user_data_holds_no_app_secrets_and_pulls_prod" {
  command = apply

  assert {
    condition     = !strcontains(digitalocean_droplet.app.user_data, "INFERENCE_API_KEY")
    error_message = "The inference key must never be in user data (it goes in /opt/tcgrass/.env)."
  }

  assert {
    condition     = strcontains(digitalocean_droplet.app.user_data, "registry.digitalocean.com/tcgrass-test/tcgrass-api:prod")
    error_message = "The deploy agent must pull the :prod tag from this registry."
  }

  assert {
    condition     = digitalocean_container_registry_docker_credentials.pull.write == false
    error_message = "The Droplet's registry credentials must be read-only."
  }

  assert {
    condition     = digitalocean_container_registry_docker_credentials.pull.expiry_seconds == 90 * 24 * 60 * 60
    error_message = "The pull credentials must expire (default 90 days), not live ~50 years."
  }

  assert {
    condition     = strcontains(digitalocean_droplet.app.user_data, base64encode(file("${path.module}/../compose.yaml")))
    error_message = "compose.yaml must come from this repository via user data, never from the image."
  }

  assert {
    condition     = strcontains(digitalocean_droplet.app.user_data, "RequiresMountsFor=/mnt/tcgrass")
    error_message = "Docker must wait for the data volume to be mounted."
  }

  assert {
    condition     = output.public_hostname == "203-0-113-10.sslip.io"
    error_message = "public_hostname must be the dashed reserved IP under sslip.io."
  }
}

run "rejects_ssh_open_to_the_world" {
  command = plan

  variables {
    admin_cidrs = ["0.0.0.0/0"]
  }

  expect_failures = [var.admin_cidrs]
}

run "rejects_very_wide_ssh_ranges" {
  command = plan

  variables {
    admin_cidrs = ["198.51.100.7/32", "64.0.0.0/2"]
  }

  expect_failures = [var.admin_cidrs]
}

terraform {
  # use_lockfile on the S3 backend (state locking in Spaces) needs 1.11+.
  required_version = "~> 1.11"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.105"
    }
  }
}

# Token from DIGITALOCEAN_TOKEN in the environment; never in code or tfvars.
provider "digitalocean" {}

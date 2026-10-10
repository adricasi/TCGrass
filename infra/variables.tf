variable "region" {
  type        = string
  description = "DigitalOcean region for every resource (the field test runs in Europe)."
  default     = "ams3"
}

variable "environment" {
  type        = string
  description = "Environment label used in names and tags."
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be prod, staging or dev."
  }
}

variable "owner" {
  type        = string
  description = "Owner tag (ADR 0002 tagging rule)."
  default     = "adricasi"
}

variable "droplet_size" {
  type        = string
  description = "Droplet size slug. Images are built in CI, so 1 GB is enough to run the stack."
  default     = "s-1vcpu-1gb"
}

variable "volume_size_gb" {
  type        = number
  description = "Size of the data volume (SQLite DB, logs, daily backups) in GiB. Can only grow."
  default     = 10

  validation {
    condition     = var.volume_size_gb >= 1 && var.volume_size_gb <= 100
    error_message = "volume_size_gb must be between 1 and 100."
  }
}

variable "ssh_public_key" {
  type        = string
  description = "OpenSSH public key allowed to log in as root (the operator's key)."

  validation {
    condition     = can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) ", var.ssh_public_key))
    error_message = "ssh_public_key must be an OpenSSH public key."
  }
}

variable "admin_cidrs" {
  type        = list(string)
  description = "CIDRs allowed to reach SSH (port 22): the operator's IP only, e.g. [\"203.0.113.7/32\"]."

  validation {
    condition = length(var.admin_cidrs) > 0 && alltrue([
      for cidr in var.admin_cidrs : can(cidrnetmask(cidr)) && tonumber(split("/", cidr)[1]) >= 8
    ])
    error_message = "admin_cidrs must be IPv4 CIDRs no wider than /8 (never 0.0.0.0/0)."
  }
}

variable "registry_name" {
  type        = string
  description = "DigitalOcean Container Registry name (globally unique; one registry per account)."

  validation {
    condition     = can(regex("^[a-z0-9-]{3,63}$", var.registry_name))
    error_message = "registry_name must be 3-63 lowercase letters, digits or dashes."
  }
}

variable "registry_tier" {
  type        = string
  description = "Registry subscription tier: starter (free, 500 MiB), basic or professional."
  default     = "starter"

  validation {
    condition     = contains(["starter", "basic", "professional"], var.registry_tier)
    error_message = "registry_tier must be starter, basic or professional."
  }
}

variable "pull_credentials_ttl_days" {
  type        = number
  description = "Lifetime of the Droplet's read-only registry credentials, in days."
  default     = 90

  validation {
    condition     = var.pull_credentials_ttl_days >= 1 && var.pull_credentials_ttl_days <= 365
    error_message = "pull_credentials_ttl_days must be between 1 and 365."
  }
}

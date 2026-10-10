output "reserved_ip" {
  description = "Public IPv4 address of the app."
  value       = digitalocean_reserved_ip.app.ip_address
}

output "public_hostname" {
  description = "PUBLIC_HOSTNAME for /opt/tcgrass/.env (Caddy gets a certificate for it)."
  value       = "${replace(digitalocean_reserved_ip.app.ip_address, ".", "-")}.sslip.io"
}

output "ssh_command" {
  description = "Log in to the Droplet (only from admin_cidrs)."
  value       = "ssh root@${digitalocean_reserved_ip.app.ip_address}"
}

output "api_image" {
  description = "Image tag the deploy agent pulls; CI moves it on an approved release."
  value       = local.api_image
}

output "vpc_id" {
  description = "VPC to restrict the inference model access key to (ADR 0006)."
  value       = digitalocean_vpc.this.id
}

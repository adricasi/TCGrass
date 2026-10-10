# State in a DigitalOcean Spaces bucket (S3-compatible), with the lock file in the same bucket.
# Bucket, key and endpoint come from backend.hcl (see backend.hcl.example); the Spaces keys come
# from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the environment, never from files.
terraform {
  backend "s3" {
    # Placeholder the S3 backend requires; the endpoint picks the Spaces region.
    region = "us-east-1"

    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_s3_checksum            = true

    use_lockfile = true
  }
}

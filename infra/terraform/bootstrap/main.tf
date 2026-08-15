# infra/terraform/bootstrap/main.tf
#
# The S3 bucket Terraform state itself lives in. Originally bootstrapped
# with local state (can't use the S3 backend to create the bucket that
# backend needs), then applied once and never touched again in the
# ordinary course of things -- this file moved here from the main
# prod/staging config specifically because it's an account-wide singleton,
# not a per-environment resource.

resource "aws_s3_bucket" "terraform_state" {
  bucket = "ocar-terraform-state"

  tags = {
    Name = "${var.project_name}-terraform-state"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Customer-managed key so the state bucket doesn't rely on the AWS-managed
# S3 key -- cheap (~$1/month) and gives us actual control (rotation, key
# policy) over what encrypts Terraform state, which can contain secrets.
resource "aws_kms_key" "terraform_state" {
  description         = "Encrypts the Terraform state bucket"
  enable_key_rotation = true

  tags = {
    Name = "${var.project_name}-terraform-state"
  }
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/${var.project_name}-terraform-state"
  target_key_id = aws_kms_key.terraform_state.key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.terraform_state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lets GitHub Actions authenticate to AWS with short-lived OIDC tokens
# instead of static access keys. Account-wide singleton -- only one
# provider can exist per issuer URL per AWS account -- moved here from
# github-oidc.tf for the same reason the state bucket moved: every
# prod/staging apply of the main config was trying (and failing) to
# re-create this since it's not actually per-environment.
data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

output "github_actions_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider -- referenced by the main config's data source"
  value       = aws_iam_openid_connect_provider.github_actions.arn
}

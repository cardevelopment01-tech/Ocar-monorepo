# The S3 bucket Terraform state itself will live in, once migrated off local
# state. Bootstrapped with local state (can't use the S3 backend to create
# the bucket that backend needs) -- apply this first, then flip the
# commented-out backend block in providers.tf and run `terraform init
# -migrate-state` to move the existing state file in.

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

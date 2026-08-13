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

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

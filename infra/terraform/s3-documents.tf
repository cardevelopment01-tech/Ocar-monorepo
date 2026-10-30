# Driver/rider document bucket for the new production environment ("prd"). prd only: prod and staging keep using the
# bucket the app was set up with (ocar-bucket, not managed here).
#
# Created by hand on 2026-10-29 (a copy of ocar-bucket's files, same keys -- the app signs links against whatever
# S3_BUCKET_NAME is set, so old links keep working) and adopted here with import blocks so an apply never recreates or
# empties it. prevent_destroy makes `terraform destroy` fail on it instead of deleting 3,000+ identity documents.
#
# TODO(decide): browser CORS rule, and whether uploads/pending/ should expire (neither is set yet).
locals {
  documents_buckets = var.environment == "prd" ? toset(["${var.project_name}-${var.environment}"]) : toset([])
}

resource "aws_s3_bucket" "documents" {
  for_each = local.documents_buckets

  bucket        = each.key
  force_destroy = false

  tags = {
    Name    = each.key
    Purpose = "driver-documents"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  for_each = local.documents_buckets

  bucket = aws_s3_bucket.documents[each.key].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  for_each = local.documents_buckets

  bucket = aws_s3_bucket.documents[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  for_each = local.documents_buckets

  bucket = aws_s3_bucket.documents[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  for_each = local.documents_buckets

  bucket = aws_s3_bucket.documents[each.key].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Current files NEVER expire (these are real driver documents). The rule only trims what versioning leaves behind:
# replaced/deleted copies go after 90 days, leftover delete markers are tidied, half-finished uploads are dropped.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  for_each = local.documents_buckets

  bucket = aws_s3_bucket.documents[each.key].id

  # Versioning must be on first, or AWS rejects the noncurrent-version rule.
  depends_on = [aws_s3_bucket_versioning.documents]

  rule {
    id     = "expire-old-versions-after-90-days"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  rule {
    id     = "remove-orphaned-delete-markers"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }
  }
}

import {
  for_each = local.documents_buckets
  to       = aws_s3_bucket.documents[each.key]
  id       = each.key
}

import {
  for_each = local.documents_buckets
  to       = aws_s3_bucket_versioning.documents[each.key]
  id       = each.key
}

import {
  for_each = local.documents_buckets
  to       = aws_s3_bucket_server_side_encryption_configuration.documents[each.key]
  id       = each.key
}

import {
  for_each = local.documents_buckets
  to       = aws_s3_bucket_public_access_block.documents[each.key]
  id       = each.key
}

import {
  for_each = local.documents_buckets
  to       = aws_s3_bucket_ownership_controls.documents[each.key]
  id       = each.key
}

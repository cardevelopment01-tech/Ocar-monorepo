# Staging-only scratch bucket for raw Prometheus-exposition-format snapshots
# of every exporter (api, node_exporter, cadvisor, postgres_exporter),
# uploaded by archive-metrics-to-s3.sh on a 1-minute systemd timer during a
# load test. Exists so nothing is lost to Grafana Cloud's free-tier 15k
# active-series cap -- full, uncapped fidelity sits here for post-test
# analysis, independent of whatever Mimir accepted or dropped. Not a
# replacement for live monitoring: nothing queries this bucket directly,
# it's a flat-file archive to replay into a throwaway Prometheus/VictoriaMetrics
# after a test if you need to dig into a specific query/instance.
#
# staging-only (count-gated) -- prod isn't cardinality-constrained the same
# way (no repeated 1-4 instance load-test scaling), so there's nothing here
# for prod to write.
resource "aws_s3_bucket" "metrics_archive" {
  count  = var.environment == "staging" ? 1 : 0
  bucket = "${var.project_name}-${var.environment}-metrics-archive"

  tags = {
    Name = "${var.project_name}-${var.environment}-metrics-archive"
  }
}

# Dedicated key, not a reuse of the bootstrap terraform_state key (different
# purpose, and that key's policy isn't scoped to grant this bucket's readers/
# writers kms:Encrypt/Decrypt anyway) -- satisfies Trivy's AWS-0132
# (SSE-S3/AES256 alone doesn't, it specifically wants a customer managed key).
resource "aws_kms_key" "metrics_archive" {
  count                   = var.environment == "staging" ? 1 : 0
  description             = "${var.project_name}-${var.environment}-metrics-archive bucket encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "metrics_archive" {
  count         = var.environment == "staging" ? 1 : 0
  name          = "alias/${var.project_name}-${var.environment}-metrics-archive"
  target_key_id = aws_kms_key.metrics_archive[0].key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "metrics_archive" {
  count  = var.environment == "staging" ? 1 : 0
  bucket = aws_s3_bucket.metrics_archive[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.metrics_archive[0].arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "metrics_archive" {
  count  = var.environment == "staging" ? 1 : 0
  bucket = aws_s3_bucket.metrics_archive[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 14 days -- this is short-lived load-test forensics, not permanent storage.
# Bump if a specific test needs a longer post-mortem window.
resource "aws_s3_bucket_lifecycle_configuration" "metrics_archive" {
  count  = var.environment == "staging" ? 1 : 0
  bucket = aws_s3_bucket.metrics_archive[0].id

  rule {
    id     = "expire-after-14-days"
    status = "Enabled"

    filter {}

    expiration {
      days = 14
    }
  }
}

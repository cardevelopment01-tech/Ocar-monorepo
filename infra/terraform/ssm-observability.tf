# Plain (non-secret) SSM parameters holding the observability sidecar config
# -- neither file contains credentials (docker-compose.prod.yml only
# references ${GITHUB_REPOSITORY_OWNER}/${IMAGE_TAG}; config.alloy pulls all
# credentials from sys.env(...) at container runtime, not from this file).
# Sourced directly from the repo so they're always in sync with what's
# committed -- no manual re-upload needed when either file changes.

resource "aws_ssm_parameter" "docker_compose_prod" {
  name = "/${var.project_name}/${var.environment}/docker-compose-prod"
  # Standard tier caps out at 4096 characters -- docker-compose.prod.yml
  # crossed that threshold once the cadvisor service + api resource limits
  # were added (same failure mode alloy_config hit below). Advanced tier
  # costs $0.05/parameter/month, negligible at this scale.
  tier  = "Advanced"
  type  = "String"
  value = file("${path.module}/../../docker-compose.prod.yml")
}

resource "aws_ssm_parameter" "alloy_config" {
  name = "/${var.project_name}/${var.environment}/alloy-config"
  # Standard tier caps out at 4096 characters -- config.alloy crossed that
  # threshold once the postgres_exporter scrape block was added. Advanced
  # tier costs $0.05/parameter/month, negligible at this scale.
  tier  = "Advanced"
  type  = "String"
  value = file("${path.module}/../../infra/alloy/config.alloy")
}

resource "aws_ssm_parameter" "refresh_pg_exporter_secret_script" {
  name  = "/${var.project_name}/${var.environment}/refresh-pg-exporter-secret-script"
  type  = "String"
  value = file("${path.module}/../scripts/refresh-postgres-exporter-secret.sh")
}

# Fixed master password reused across every future "restore a prod snapshot
# into a temp RDS instance, transfer its data into staging, delete the temp
# instance" load-test data-seeding cycle (see
# docs/superpowers/specs/2026-08-31-load-test-seed-data-spec.md and
# load-tests/README.md). Deliberately NOT the auto-generated
# manage_master_user_password Secrets Manager ARN -- that ARN is
# indistinguishable by pattern from prod's own master-secret ARN (both are
# "rds!db-<random>"), so scoping IAM to it would mean staging's EC2 role could
# read PROD's live master password too. A fixed, staging-owned SSM parameter
# lets every future temp-restore instance reuse the exact same read path
# below, with zero further ad-hoc IAM grants. Staging-only -- this workflow
# never runs against prod.
resource "aws_ssm_parameter" "archive_metrics_to_s3_script" {
  count = var.environment == "staging" ? 1 : 0
  name  = "/${var.project_name}/${var.environment}/archive-metrics-to-s3-script"
  type  = "String"
  value = file("${path.module}/../scripts/archive-metrics-to-s3.sh")
}

resource "aws_ssm_parameter" "restore_temp_db_password" {
  count = var.environment == "staging" ? 1 : 0
  name  = "/${var.project_name}/${var.environment}/restore-temp-db-password"
  type  = "SecureString"
  value = "CHANGE ME -- see docs/superpowers/specs/2026-08-31-load-test-seed-data-spec.md"

  lifecycle {
    ignore_changes = [value] # set once out-of-band, not managed by every apply
  }
}

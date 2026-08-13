# Plain (non-secret) SSM parameters holding the observability sidecar config
# -- neither file contains credentials (docker-compose.prod.yml only
# references ${GITHUB_REPOSITORY_OWNER}/${IMAGE_TAG}; config.alloy pulls all
# credentials from sys.env(...) at container runtime, not from this file).
# Sourced directly from the repo so they're always in sync with what's
# committed -- no manual re-upload needed when either file changes.

resource "aws_ssm_parameter" "docker_compose_prod" {
  name  = "/${var.project_name}/${var.environment}/docker-compose-prod"
  type  = "String"
  value = file("${path.module}/../../docker-compose.prod.yml")
}

resource "aws_ssm_parameter" "alloy_config" {
  name  = "/${var.project_name}/${var.environment}/alloy-config"
  # Standard tier caps out at 4096 characters -- config.alloy crossed that
  # threshold once the postgres_exporter scrape block was added. Advanced
  # tier costs $0.05/parameter/month, negligible at this scale.
  tier  = "Advanced"
  type  = "String"
  value = file("${path.module}/../../infra/alloy/config.alloy")
}

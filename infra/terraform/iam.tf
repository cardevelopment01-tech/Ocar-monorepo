# IAM role EC2 instances assume so their boot script (user_data, step 6) can
# read the current Docker image tag, the GHCR pull token, and the API's env
# file from SSM Parameter Store -- scoped to exactly those three parameters,
# not the broad AmazonSSMManagedInstanceCore managed policy (that also grants
# full Session Manager access, which nothing here needs).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  image_tag_parameter_name  = "/${var.project_name}/${var.environment}/image-tag"
  ghcr_token_parameter_name = "/${var.project_name}/${var.environment}/ghcr-token"
  api_env_parameter_name    = "/${var.project_name}/${var.environment}/api-env"
  # Hand-maintained (same as the three above -- no aws_ssm_parameter resource,
  # seeded via `aws ssm put-parameter --type SecureString` once by hand). Read
  # on-demand by the deploy workflow's SSM-routed migration step (deploy.yml),
  # not at instance boot -- kept separate from api-env's DATABASE_URL because
  # pre-RDS-cutover it's Neon's DIRECT (non-pooler) host while DATABASE_URL is
  # pooled; post-cutover to RDS (no pooler) the two converge to the same value.
  migration_db_url_parameter_name = "/${var.project_name}/${var.environment}/migration-database-url"

  ssm_parameter_arn_prefix       = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter"
  image_tag_parameter_arn        = "${local.ssm_parameter_arn_prefix}${local.image_tag_parameter_name}"
  ghcr_token_parameter_arn       = "${local.ssm_parameter_arn_prefix}${local.ghcr_token_parameter_name}"
  api_env_parameter_arn          = "${local.ssm_parameter_arn_prefix}${local.api_env_parameter_name}"
  migration_db_url_parameter_arn = "${local.ssm_parameter_arn_prefix}${local.migration_db_url_parameter_name}"

  ssm_kms_key_arn = "arn:aws:kms:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:alias/aws/ssm"
}

resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-ec2-role"
  }
}

resource "aws_iam_role_policy" "read_boot_parameters" {
  name = "${var.project_name}-${var.environment}-read-boot-parameters"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ssm:GetParameter"]
        Resource = [
          local.image_tag_parameter_arn,
          local.ghcr_token_parameter_arn,
          local.api_env_parameter_arn,
          local.migration_db_url_parameter_arn,
          aws_ssm_parameter.docker_compose_prod.arn,
          aws_ssm_parameter.alloy_config.arn,
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = local.ssm_kms_key_arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-${var.environment}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# Lets the app request a short-lived signed auth token (via @aws-sdk/rds-signer)
# instead of storing a password -- see rds.tf's iam_database_authentication_enabled
# comment for why. Scoped to the single DB user the app actually connects as;
# rds-db:connect ARNs use the RDS instance's resource_id (dbi-XXXX), NOT its
# identifier -- see rds.tf's rds_resource_id output.
resource "aws_iam_role_policy" "rds_iam_connect" {
  name = "${var.project_name}-${var.environment}-rds-iam-connect"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "rds-db:connect"
      Resource = "arn:aws:rds-db:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:dbuser:${aws_db_instance.main.resource_id}/${var.db_master_username}"
    }]
  })
}

# TEMPORARY: debugging why targets are failing health checks -- lets us
# `aws ssm start-session` into an instance without opening SSH. Remove this
# attachment once the boot script is confirmed working; it's broader than
# the app needs long-term (adds Session Manager access on top of the scoped
# parameter-read policy above).
resource "aws_iam_role_policy_attachment" "ssm_session_manager_debug" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

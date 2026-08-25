# RDS Postgres to replace Neon. Same shape as elasticache.tf: single instance
# (no Multi-AZ/read replica yet, add when actually needed), placed in the
# existing public subnets since there's no NAT/private subnet layer, security
# via SG (only the EC2 SG can reach port 5432) not subnet placement --
# publicly_accessible = false makes that the enforced boundary either way.
#
# manage_master_user_password = true instead of a random_password resource:
# AWS creates and rotates the master credential in Secrets Manager, so the
# password never sits in Terraform state or a .tfvars file. Pull it once
# after apply (aws secretsmanager get-secret-value) to build the DATABASE_URL
# that goes into the hand-maintained api-env SSM parameter -- same manual
# handoff that image-tag/ghcr-token/api-env already use (see iam.tf), not a
# new pattern.

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-${var.environment}-db-subnets"
  subnet_ids = aws_subnet.public[*].id
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds-sg"
  description = "Allow Postgres port only from the EC2 instances"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from EC2 instances"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-rds-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-${var.environment}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = var.db_name
  username                    = var.db_master_username
  manage_master_user_password = true

  # Lets IAM-authenticated connections (rds-db:connect, see iam.tf) request a
  # short-lived signed token instead of a password -- the fix for the 2026-08-25
  # incident where the hand-maintained api-env SSM copy of the Secrets-Manager
  # password went stale after a rotation and took prod down. Any DB user still
  # needs `GRANT rds_iam TO <user>` before it can actually use this.
  #
  # GOTCHA (learned the hard way during that same incident): granting rds_iam
  # to a role is NOT additive. It changes which pg_hba.conf rule matches that
  # role's connections, which REPLACES password auth for it, not adds IAM auth
  # alongside it. Granting it to ocar_admin (the RDS master user) locked out
  # every password-based connection instance-wide the moment it was granted,
  # with no clean way to have both auth methods live for the same role at
  # once -- recovery required `aws rds modify-db-instance
  # --no-enable-iam-database-authentication --apply-immediately` to restore
  # password auth. Never grant rds_iam to the master role again. If IAM auth
  # is wanted for the app, create a DEDICATED non-master DB role for it first,
  # and test the full grant/revoke/connect cycle in staging before touching
  # prod. See docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md for the full
  # timeline.
  iam_database_authentication_enabled = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # postgresql.conf setting needed on the SOURCE for logical replication to
  # work at all -- must be set before CREATE PUBLICATION is attempted.
  parameter_group_name = aws_db_parameter_group.main.name

  # Real backups on the actual DB now (Neon handles this today) -- 7 days is
  # a starting point, not a tuned retention policy.
  backup_retention_period   = 7
  skip_final_snapshot       = var.environment == "prod" ? false : true
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-${var.environment}-db-final" : null
  deletion_protection       = var.environment == "prod"

  # Neon's dashboard gave query-level and log visibility for free; matching
  # that on RDS needs both explicitly turned on, or the client DB load test
  # (see CLAUDE.md pending-ops note) has strictly less visibility than planned.
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = {
    Name = "${var.project_name}-${var.environment}-db"
  }
}

# Both parameters below are static (require a reboot, can't apply live) and
# can only be set via a parameter group -- must be applied and the instance
# rebooted BEFORE CREATE SUBSCRIPTION / CREATE EXTENSION pg_stat_statements
# are attempted, not something you can fix after the fact without downtime.
resource "aws_db_parameter_group" "main" {
  name   = "${var.project_name}-${var.environment}-db-params"
  family = "postgres18"

  # Lets RDS act as a logical replication SUBSCRIBER (Neon -> RDS sync).
  parameter {
    name         = "rds.logical_replication"
    value        = "1"
    apply_method = "pending-reboot"
  }

  # Neon preloads pg_stat_statements by default (why the Neon pending-ops
  # note only said "enable the extension") -- RDS does not. Without this,
  # `CREATE EXTENSION pg_stat_statements` fails outright, postgres_exporter's
  # scrape breaks, and the "DB Internals" row in ocar-overview.json goes
  # dark permanently, not just until noticed.
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  # Neon's endpoint enforces TLS by default (api/.env.example's DATABASE_URL
  # comment assumes sslmode=require works) -- RDS does not enforce it out of
  # the box, so an unencrypted connection would silently be accepted post-cutover
  # unless this is set. Dynamic parameter, no reboot needed.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Same 500ms threshold the old Neon pending-ops note used. Dynamic parameter,
  # no reboot needed. Ships to CloudWatch via enabled_cloudwatch_logs_exports
  # on aws_db_instance.main -- without this set, that export has nothing
  # duration-based to actually log.
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

output "rds_endpoint" {
  description = "RDS host:port -- combine with db_name/username and the Secrets Manager password to build DATABASE_URL"
  value       = "${aws_db_instance.main.address}:${aws_db_instance.main.port}"
}

output "rds_master_user_secret_arn" {
  description = "Secrets Manager ARN holding the master password -- aws secretsmanager get-secret-value --secret-id <this> --query SecretString"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "rds_resource_id" {
  description = "RDS instance resource ID -- the dbi-XXXX identifier used to build rds-db:connect ARNs (see iam.tf), distinct from the instance identifier"
  value       = aws_db_instance.main.resource_id
}

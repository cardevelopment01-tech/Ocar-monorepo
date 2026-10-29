# infra/terraform/prd.tfvars
#
# The new production environment, "prd" (planned 2026-10-29: 71 to add, nothing applied yet). Mirrors what the
# current ocar-prod-* stack runs (verified against live AWS the same day) so the first build matches what the load
# tests measured. The current prod stack stays up until prd has passed its tests, then becomes the new staging.
#
# prd has its own state and its own Terraform data dir, so prod's .terraform/ is never touched:
#   TF_DATA_DIR=.terraform-prd terraform init -reconfigure -backend-config=prd.backend.hcl
#   TF_DATA_DIR=.terraform-prd terraform plan -var-file=prd.tfvars -lock=false
# Never run plan/apply with this file while .terraform/ (no TF_DATA_DIR) points at prod's state.
#
# This file is gitignored (infra/terraform/**/*.tfvars) -- commit changes with `git add -f`.
# Secrets do NOT belong in this file (a laptop-only tfvars file got lost once, 2026-08-19): API settings live in the SSM
# parameter /ocar/prd/api-env, GitHub/Grafana credentials under /ocar/observability/*.
#
# Safety is handled in code, not here: local.protected (iam.tf) gives prd deletion protection, a final DB snapshot
# and a non-force-destroyable logs bucket; local.legacy_names gives it clean ocar-prd-<thing>-<color> names.
# deploy.yml can target prd by manual dispatch from main only; set repo variables PRD_ALB_DNS_NAME and
# PRD_GHA_DEPLOY_ROLE_ARN and create the "prd" GitHub Environment (main-only, required reviewer) first.

environment  = "prd"
project_name = "ocar"
aws_region   = "ap-south-1"

# --- hostname -------------------------------------------------------------------------------------------------------
# The real production hostname. The certificate DNS-validation CNAME must exist in Cloudflare before apply finishes
# (this module cannot create it). ACM reuses the same CNAME per account/domain, so it may already be in place.
# TODO(decide): staging hostname for the old stack once api.ocarindia.com moves (e.g. staging.ocarindia.com).
domain_name = "api.ocarindia.com"

# --- network --------------------------------------------------------------------------------------------------------
# A different range from the current VPC (10.0.0.0/16) so the two can be peered for the data migration if needed.
vpc_cidr            = "10.1.0.0/16"
# Three AZs: RDS refused a Multi-AZ db.t4g.medium (gp3) restore with only 1a+1b ("1 more must be created in other
# Availability Zones: ap-south-1c", 2026-10-29), so the DB subnet group needs a third zone.
availability_zones  = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
public_subnet_cidrs = ["10.1.0.0/24", "10.1.1.0/24", "10.1.2.0/24"]

# --- compute --------------------------------------------------------------------------------------------------------
# Live today: t3.medium, CPU target-tracking at 19%, min 1 / max 4. The load tests showed one server carries about
# 190 users (~6,000 req/min).
instance_type = "t3.medium"
active_color  = "blue"
# CPU target 19% (asg_cpu_target_percent default) and max_size 4 (hard-coded in asg.tf) match the live prod policy.
# TODO(decide): enable detailed monitoring in the launch template (~$2.10/server/month) so the CPU rule reacts in
# minutes instead of 5-15.

# --- database -------------------------------------------------------------------------------------------------------
# Live today: db.t4g.medium, PG 18.4, gp3 100 GB (3,000 IOPS), Single-AZ, 14-day backups, Performance Insights on.
# TODO(decide after the doubling-ramp result): class / IOPS headroom.
# Built single-AZ on 2026-10-29 because AWS had no db.t4g.medium capacity for a Multi-AZ restore ("insufficient-capacity").
# Pinning a zone does not work either: the one zone with capacity changed within the hour (1a, then 1c), so the zone is
# left to AWS (db_availability_zone unset). Once the instance existed and capacity returned, it was converted in place
# with `aws rds modify-db-instance --multi-az --apply-immediately` (same day), hence true here. A fresh restore at
# cutover (option A) can hit the same capacity error -- db.t3.medium / db.t4g.large had capacity in several zones.
db_multi_az              = true
db_engine_version        = "18.4"
db_instance_class        = "db.t4g.medium"
db_allocated_storage     = 200
db_max_allocated_storage = 500
# Restore from the 16 Oct pre-seed snapshot (before the 1M-ride test data; confirmed by the owner 2026-10-29); the db
# name `ocar` and the users come with it. It misses everything prod has written since -- before cutover, refresh it
# (fresh snapshot + rebuild, or logical replication); the variable is ignored after creation.
db_snapshot_identifier   = "ocar-prod-db-keep-pre-seed-20261016"

# --- cache ----------------------------------------------------------------------------------------------------------
# Live today: one cache.t4g.micro Valkey node, no replica. TODO(decide): replica or a larger node for real production.
valkey_node_type = "cache.t4g.micro"

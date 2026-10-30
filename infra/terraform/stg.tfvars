# infra/terraform/stg.tfvars
#
# The new staging environment, "stg", deliberately smaller than prd (t3.small servers, db.t4g.small database). It replaces the old prod stack (scaled to 0 on 2026-10-30, to be
# destroyed) and the empty old "staging". Capacity numbers measured on prd do NOT carry over to it. Nothing protected:
# local.protected is false for stg, so the DB can be deleted without a final snapshot and the logs bucket can be
# force-destroyed. Clean names (ocar-stg-<thing>[-<color>]); no legacy ones.
#
# stg has its own state and its own Terraform data dir, so no other environment's .terraform/ is touched:
#   TF_DATA_DIR=.terraform-stg terraform init -reconfigure -backend-config=stg.backend.hcl
#   TF_DATA_DIR=.terraform-stg terraform plan -var-file=stg.tfvars
# Never run plan/apply with this file while .terraform/ (no TF_DATA_DIR) points at another environment's state.
#
# This file is gitignored (infra/terraform/**/*.tfvars) -- commit changes with `git add -f`.
# Secrets do NOT belong here: API settings live in the SSM parameter /ocar/stg/api-env, GitHub/Grafana credentials
# under /ocar/observability/*.

environment  = "stg"
project_name = "ocar"
aws_region   = "ap-south-1"

# --- hostname -------------------------------------------------------------------------------------------------------
# The certificate DNS-validation CNAME must be created in Cloudflare by hand while the apply waits (this module cannot
# create it). Not "staging.ocarindia.com": prd's test certificate already uses that name.
# TODO(decide): final hostname.
domain_name = "stg.api.ocarindia.com"

# --- network --------------------------------------------------------------------------------------------------------
# A range of its own (prod 10.0.0.0/16, prd 10.1.0.0/16) so all three can coexist and be peered if ever needed.
vpc_cidr            = "10.2.0.0/16"
availability_zones  = ["ap-south-1a", "ap-south-1b"]
public_subnet_cidrs = ["10.2.0.0/24", "10.2.1.0/24"]

# --- compute --------------------------------------------------------------------------------------------------------
instance_type = "t3.small"
active_color  = "blue"
# detailed_monitoring stays at its default (off): staging does not need 1-minute scaling metrics (~$2.10/server/month).

# --- database -------------------------------------------------------------------------------------------------------
# Single-AZ (the variable's false default) and an empty database: the first deploy runs the migrations. Add a
# db_snapshot_identifier only if staging should start with data (the 16 Oct pre-seed snapshot, or a fresh one).
db_engine_version        = "18.4"
db_instance_class        = "db.t4g.small"
db_allocated_storage     = 100
db_max_allocated_storage = 300

# --- cache ----------------------------------------------------------------------------------------------------------
valkey_node_type = "cache.t4g.micro"

# infra/terraform/staging.tfvars
#
# Everything NOT listed here (instance_type, vpc_cidr, ...) is deliberately
# left at variables.tf's default -- staging otherwise matches prod's
# infrastructure shape, since the whole point is a load-test environment the
# client can trust the numbers from. db_instance_class/valkey_node_type below
# are the one deliberate exception (2026-09-08) -- this load test runs
# against bigger RDS/ElastiCache tiers than prod's actual db.t4g.small/
# cache.t4g.micro, so its numbers show headroom at this tier, not a
# same-as-prod comparison. Only what genuinely needs to differ goes here.

environment = "staging"

# A real DNS record you'll need to create by hand in Cloudflare (see the
# runbook) -- prod's domain_name default can't be reused here, ACM would be
# requesting/validating a cert for the same hostname a second, unrelated
# Terraform state doesn't own.
domain_name = "staging.ocar-api.clienttesting.in"

# Load-test sizing (2026-09-08) -- bigger than prod's current db.t4g.small/
# cache.t4g.micro on purpose, see header comment above.
db_instance_class = "db.r8g.xlarge"
valkey_node_type  = "cache.m8g.large"

# 300GB floor for this load test's bulk seed data. max_allocated_storage
# must exceed allocated_storage (AWS storage-autoscaling requirement) --
# raised to 500 so autoscaling has headroom above the 300GB floor instead
# of being pinned at the ceiling immediately.
db_allocated_storage     = 300
db_max_allocated_storage = 500

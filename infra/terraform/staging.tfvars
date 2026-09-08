# infra/terraform/staging.tfvars
#
# Everything NOT listed here (instance_type, vpc_cidr, ...) is deliberately
# left at variables.tf's default -- staging otherwise matches prod's
# infrastructure shape, since the whole point is a load-test environment the
# client can trust the numbers from. Only what genuinely needs to differ
# goes here.

environment = "staging"

# A real DNS record you'll need to create by hand in Cloudflare (see the
# runbook) -- prod's domain_name default can't be reused here, ACM would be
# requesting/validating a cert for the same hostname a second, unrelated
# Terraform state doesn't own.
domain_name = "staging.ocar-api.clienttesting.in"

# db_instance_class/valkey_node_type temporarily downgraded back to
# variables.tf's defaults (2026-09-08) -- the real high-volume load test is
# on hold for a lighter run first, to check whether Grafana Cloud's free
# plan can even absorb the metric/log volume from high concurrent load
# before paying for bigger RDS/ElastiCache tiers. Restore to db.r8g.xlarge /
# cache.m8g.large when resuming the real load test.
#
# db_allocated_storage/db_max_allocated_storage are NOT reverted here --
# AWS RDS storage can only grow, never shrink, once increased. Stays at
# 300GB/500GB regardless (set 2026-09-08); reverting would require
# recreating the instance from a snapshot, which defeats the point of an
# in-place downgrade.
db_allocated_storage     = 300
db_max_allocated_storage = 500

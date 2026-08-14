# infra/terraform/staging.tfvars
#
# Everything NOT listed here (instance_type, vpc_cidr, valkey_node_type, ...)
# is deliberately left at variables.tf's default -- staging must match prod's
# infrastructure shape exactly, since the whole point is a load-test
# environment the client can trust the numbers from. Only what genuinely
# needs to differ goes here.

environment = "staging"

# A real DNS record you'll need to create by hand in Cloudflare (see the
# runbook) -- prod's domain_name default can't be reused here, ACM would be
# requesting/validating a cert for the same hostname a second, unrelated
# Terraform state doesn't own.
domain_name = "staging.ocar-api.clienttesting.in"

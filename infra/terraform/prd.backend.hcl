# infra/terraform/prd.backend.hcl
#
# State for the new production environment ("prd"). Selected explicitly, like prod.backend.hcl and staging.backend.hcl:
#   terraform init -reconfigure -backend-config=prd.backend.hcl
# Never run plan/apply with a -var-file for one environment while .terraform/ points at another environment's state.
#
# TODO(decide): if prd is built in the client's own AWS account, point bucket/region at THEIR state bucket instead.
bucket       = "ocar-terraform-state"
key          = "prd/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true

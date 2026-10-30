# infra/terraform/stg.backend.hcl
#
# State for the new staging environment ("stg"). Selected explicitly, like prod.backend.hcl, prd.backend.hcl and
# staging.backend.hcl:
#   TF_DATA_DIR=.terraform-stg terraform init -reconfigure -backend-config=stg.backend.hcl
# Never run plan/apply with a -var-file for one environment while .terraform/ points at another environment's state.
bucket       = "ocar-terraform-state"
key          = "stg/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true

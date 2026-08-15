# infra/terraform/staging.backend.hcl
#
# Selected explicitly via `terraform init -backend-config=staging.backend.hcl`
# -- deliberately NOT a `terraform workspace`, which switches state invisibly
# and is easy to forget you're in. This file makes "which environment am I
# about to touch" a visible, typed-out choice every time.
bucket       = "ocar-terraform-state"
key          = "staging/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true

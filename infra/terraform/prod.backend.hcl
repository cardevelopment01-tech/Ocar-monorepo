# infra/terraform/prod.backend.hcl
#
# Selected explicitly via `terraform init -backend-config=prod.backend.hcl`
# -- previously these values were hardcoded directly in providers.tf's
# backend block, which meant a plain `terraform init` with no flags at all
# silently initialized against PROD's real state. That's dangerous now that
# a second environment exists: a `terraform plan/apply -var-file=staging.tfvars`
# run without first re-running init against staging.backend.hcl would target
# prod's state while believing itself to be staging, since Terraform reuses
# whatever backend the local `.terraform/` directory was last initialized
# against. Making prod's backend config just as explicit as staging's removes
# any backend that could ever be a silent default.
bucket       = "ocar-terraform-state"
key          = "prod/terraform.tfstate"
region       = "ap-south-1"
use_lockfile = true

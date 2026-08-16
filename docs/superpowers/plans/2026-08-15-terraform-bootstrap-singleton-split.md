# Terraform Bootstrap/Singleton Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 7 account-wide singleton resources (the Terraform state bucket + its KMS key/alias/config, and the GitHub Actions OIDC provider) out of the shared prod/staging root module into their own one-time "bootstrap" state, so a staging apply never again tries to re-create resources prod's state already owns.

**Architecture:** A new `infra/terraform/bootstrap/` root module, with its own backend config pointing at a third state file in the same S3 bucket, takes ownership of the 7 singleton resources. The main config (the one `prod.backend.hcl`/`staging.backend.hcl` apply against) stops defining them as `resource` blocks and instead reads the OIDC provider via a read-only `data` source (the S3 bucket itself needs no reference at all — the backend block already just points at it by literal name string, which is how this bucket was bootstrapped in the first place per its own top-of-file comment). Migration moves *state tracking* only (`terraform state rm` + `terraform import`) — zero real AWS resources are destroyed or recreated at any point, verified by a clean `terraform plan` (0 add/change/destroy) on both sides before and after.

**Tech Stack:** Terraform (existing `hashicorp/aws ~> 6.0` provider, S3 backend), no new dependencies.

---

## Why this is the right pattern (researched, not guessed)

Confirmed via HashiCorp's own guidance and common real-world reference architectures: account-level singleton resources (an OIDC provider, the state bucket itself) are meant to live in their own separate "bootstrap"/"global" workspace, applied once, with everything else referencing them read-only rather than trying to re-create them per environment. Moving resources between two *remote* (S3) backend states isn't a simple `-state`/`-state-out` flag move (that's a local-state-only feature) — it's `terraform state rm` in the source state plus `terraform import` in the destination state, which is exactly what this plan does.

## The exact resources moving, and their current real IDs (already looked up live, so imports use real values, not placeholders)

| Resource address | Current file | Real ID/ARN to import |
|---|---|---|
| `aws_s3_bucket.terraform_state` | `state-bucket.tf` | `ocar-terraform-state` |
| `aws_s3_bucket_versioning.terraform_state` | `state-bucket.tf` | `ocar-terraform-state` |
| `aws_kms_key.terraform_state` | `state-bucket.tf` | `761c1742-7dfc-4272-b44e-da30627f4283` |
| `aws_kms_alias.terraform_state` | `state-bucket.tf` | `alias/ocar-terraform-state` |
| `aws_s3_bucket_server_side_encryption_configuration.terraform_state` | `state-bucket.tf` | `ocar-terraform-state` |
| `aws_s3_bucket_public_access_block.terraform_state` | `state-bucket.tf` | `ocar-terraform-state` |
| `aws_iam_openid_connect_provider.github_actions` | `github-oidc.tf` | `arn:aws:iam::822127610728:oidc-provider/token.actions.githubusercontent.com` |

Three call sites reference the OIDC provider's ARN and need updating from a `resource` reference to a `data` reference: `github-oidc.tf:27`, `github-oidc.tf:101`, `github-oidc.tf:216` (the `github_actions_plan`, `github_actions_deploy`, and `github_actions_staging` roles' trust policies).

---

## File structure

- Create: `infra/terraform/bootstrap/providers.tf` — own `terraform{}`/`backend "s3"{}`/`provider "aws"{}` blocks, own state key.
- Create: `infra/terraform/bootstrap/main.tf` — the 7 moved resource definitions, copied verbatim from their current files (same descriptions/comments, since the *reasoning* for each hasn't changed, only *where* they live).
- Create: `infra/terraform/bootstrap/variables.tf` — just `project_name` and `aws_region`, since `environment` doesn't apply to a resource set that isn't per-environment.
- Delete: `infra/terraform/state-bucket.tf` (all 6 resources move to bootstrap).
- Modify: `infra/terraform/github-oidc.tf` — replace the `resource "aws_iam_openid_connect_provider"` block with a `data` block, update the 3 trust-policy references.
- Modify: `CLAUDE.md` — document the new bootstrap module and when it's (rarely) touched.

---

### Task 1: Create the bootstrap module's Terraform/provider/backend config

**Files:**
- Create: `infra/terraform/bootstrap/providers.tf`
- Create: `infra/terraform/bootstrap/variables.tf`

- [ ] **Step 1: Check the main config's exact terraform/provider block to mirror**

Read `infra/terraform/providers.tf` (already known from this session: `required_version = ">= 1.9.0"`, `aws` provider `~> 6.0`, `tls` provider `~> 4.0`) and `infra/terraform/variables.tf`'s `project_name` (default `"ocar"`) and `aws_region` (default `"ap-south-1"`) definitions.

- [ ] **Step 2: Create `infra/terraform/bootstrap/variables.tf`**

```hcl
# infra/terraform/bootstrap/variables.tf
#
# No `environment` variable here on purpose -- everything in this module is
# an account-wide singleton, not something that differs between prod and
# staging. That's the whole point of this module's existence.

variable "project_name" {
  type        = string
  description = "Short project name, used as a prefix/tag on resources"
  default     = "ocar"
}

variable "aws_region" {
  type        = string
  description = "AWS region everything gets created in"
  default     = "ap-south-1"
}
```

- [ ] **Step 3: Create `infra/terraform/bootstrap/providers.tf`**

```hcl
# infra/terraform/bootstrap/providers.tf
#
# Deliberately its own separate state (bootstrap/terraform.tfstate, in the
# same bucket the main prod/staging config uses) -- these are account-wide
# singleton resources (the state bucket itself, the GitHub OIDC provider),
# applied once, almost never touched again. Keeping them in the same shared
# root module the per-environment configs use is exactly what caused every
# staging apply to try (and fail) to re-create resources prod's state
# already owns. See docs/superpowers/plans/2026-08-15-terraform-bootstrap-singleton-split.md.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "ocar-terraform-state"
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-south-1"
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "ocar"
      ManagedBy = "terraform"
      Scope     = "bootstrap"
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/bootstrap/providers.tf infra/terraform/bootstrap/variables.tf
git commit -m "feat(infra): scaffold the bootstrap module's provider/backend config"
```

---

### Task 2: Move the state-bucket resources into the bootstrap module

**Files:**
- Create: `infra/terraform/bootstrap/main.tf`
- Delete: `infra/terraform/state-bucket.tf`

- [ ] **Step 1: Create `infra/terraform/bootstrap/main.tf` with the 6 moved resources**

```hcl
# infra/terraform/bootstrap/main.tf
#
# The S3 bucket Terraform state itself lives in. Originally bootstrapped
# with local state (can't use the S3 backend to create the bucket that
# backend needs), then applied once and never touched again in the
# ordinary course of things -- this file moved here from the main
# prod/staging config specifically because it's an account-wide singleton,
# not a per-environment resource.

resource "aws_s3_bucket" "terraform_state" {
  bucket = "ocar-terraform-state"

  tags = {
    Name = "${var.project_name}-terraform-state"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Customer-managed key so the state bucket doesn't rely on the AWS-managed
# S3 key -- cheap (~$1/month) and gives us actual control (rotation, key
# policy) over what encrypts Terraform state, which can contain secrets.
resource "aws_kms_key" "terraform_state" {
  description         = "Encrypts the Terraform state bucket"
  enable_key_rotation = true

  tags = {
    Name = "${var.project_name}-terraform-state"
  }
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/${var.project_name}-terraform-state"
  target_key_id = aws_kms_key.terraform_state.key_id
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.terraform_state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

- [ ] **Step 2: Delete the old file**

```bash
git rm infra/terraform/state-bucket.tf
```

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/bootstrap/main.tf
git commit -m "feat(infra): move state bucket + KMS resources into the bootstrap module"
```

---

### Task 3: Move the OIDC provider — bootstrap owns the resource, main config gets a data source

**Correction found during Task 2's spec review**: `github-oidc.tf`'s two IAM policies (`github_actions_plan_state`, and the equivalent block in `github_actions_staging`) also reference `aws_s3_bucket.terraform_state.arn` and `aws_kms_key.terraform_state.arn` directly (7 occurrences total, not just the 3 OIDC-provider ones originally scoped here) — those resources moved to bootstrap in Task 2, so these need the same resource-to-data-source treatment, added to this task's scope.

**Files:**
- Modify: `infra/terraform/bootstrap/main.tf`
- Modify: `infra/terraform/github-oidc.tf`

- [ ] **Step 1: Add the OIDC provider resource to the bootstrap module**

Append to `infra/terraform/bootstrap/main.tf`:

```hcl
# Lets GitHub Actions authenticate to AWS with short-lived OIDC tokens
# instead of static access keys. Account-wide singleton -- only one
# provider can exist per issuer URL per AWS account -- moved here from
# github-oidc.tf for the same reason the state bucket moved: every
# prod/staging apply of the main config was trying (and failing) to
# re-create this since it's not actually per-environment.
data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

output "github_actions_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider -- referenced by the main config's data source"
  value       = aws_iam_openid_connect_provider.github_actions.arn
}
```

- [ ] **Step 2: Add the `tls` provider to bootstrap's `providers.tf`**

The `tls_certificate` data source needs the `tls` provider, which the main config already declares but bootstrap doesn't yet. In `infra/terraform/bootstrap/providers.tf`, update `required_providers`:

```hcl
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
```

- [ ] **Step 3: Replace the resource with a data source in the main config**

In `infra/terraform/github-oidc.tf`, replace:

```hcl
data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}
```

with:

```hcl
# This is a read-only lookup, not ownership -- the provider itself is
# created/managed once in infra/terraform/bootstrap/ (see
# docs/superpowers/plans/2026-08-15-terraform-bootstrap-singleton-split.md
# for why). Every prod/staging apply just needs its ARN, never needs to
# create or modify it.
data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}
```

- [ ] **Step 4: Update the 3 trust-policy references**

In `infra/terraform/github-oidc.tf`, all 3 occurrences of:

```hcl
Federated = aws_iam_openid_connect_provider.github_actions.arn
```

become:

```hcl
Federated = data.aws_iam_openid_connect_provider.github_actions.arn
```

(Lines 27, 101, 216 as of this plan's writing — search for the exact string rather than trusting line numbers, since earlier tasks in this same file may have shifted them.)

- [ ] **Step 5: Add data sources for the state bucket and KMS key, update their 7 references too**

`github-oidc.tf`'s IAM policies (`github_actions_plan_state` and the equivalent statement inside `github_actions_staging`'s policy) also directly reference `aws_s3_bucket.terraform_state.arn` and `aws_kms_key.terraform_state.arn` — these moved to bootstrap in Task 2 too, so they need the same treatment. Near the top of `github-oidc.tf` (or right before the first place these are used), add:

```hcl
# Read-only lookups -- the state bucket and its KMS key are owned by
# infra/terraform/bootstrap/, not this config. Same reasoning as the OIDC
# provider data source above.
data "aws_s3_bucket" "terraform_state" {
  bucket = "ocar-terraform-state"
}

data "aws_kms_key" "terraform_state" {
  key_id = "alias/ocar-terraform-state"
}
```

Then replace every occurrence of `aws_s3_bucket.terraform_state.arn` with `data.aws_s3_bucket.terraform_state.arn`, and every occurrence of `aws_kms_key.terraform_state.arn` with `data.aws_kms_key.terraform_state.arn` (7 occurrences total across the `github_actions_plan_state` and `github_actions_staging` policies — search for the exact strings rather than trusting specific line numbers).

- [ ] **Step 6: Commit**

```bash
git add infra/terraform/bootstrap/main.tf infra/terraform/bootstrap/providers.tf infra/terraform/github-oidc.tf
git commit -m "feat(infra): move OIDC provider to bootstrap, reference via data source"
```

---

### Task 4: Validate both configs before touching any live state

**Files:** none (verification only)

- [ ] **Step 1: Validate the bootstrap module**

```bash
cd infra/terraform/bootstrap
terraform init
terraform fmt -check -recursive
terraform validate
```
Expected: `terraform init` succeeds (creates a fresh, empty `bootstrap/terraform.tfstate`), `fmt`/`validate` both pass clean.

- [ ] **Step 2: Validate the main config still parses correctly**

```bash
cd infra/terraform
terraform fmt -check -recursive
```
Expected: clean, no diff. (Full `terraform validate` here will still reference the now-deleted `aws_iam_openid_connect_provider` resource if any stray reference was missed — if `validate` errors on an undefined reference, that's the signal Step 4 of Task 3 wasn't fully applied; grep for `aws_iam_openid_connect_provider.github_actions` again and fix any remaining occurrence before proceeding.)

---

### Task 5: Live state migration — move tracking, touch zero real infrastructure

**This task is NOT for a subagent to execute autonomously.** It touches prod's live Terraform state directly. Each step must be run by (or explicitly confirmed with) the human, one command at a time, checking output before proceeding to the next.

**Files:** none (state operations only)

- [ ] **Step 1: Import all 7 resources into the bootstrap state**

From `infra/terraform/bootstrap/` (already `terraform init`-ed in Task 4):

```bash
terraform import aws_s3_bucket.terraform_state ocar-terraform-state
terraform import aws_s3_bucket_versioning.terraform_state ocar-terraform-state
terraform import aws_kms_key.terraform_state 761c1742-7dfc-4272-b44e-da30627f4283
terraform import aws_kms_alias.terraform_state alias/ocar-terraform-state
terraform import aws_s3_bucket_server_side_encryption_configuration.terraform_state ocar-terraform-state
terraform import aws_s3_bucket_public_access_block.terraform_state ocar-terraform-state
terraform import aws_iam_openid_connect_provider.github_actions arn:aws:iam::822127610728:oidc-provider/token.actions.githubusercontent.com
```
Expected after each: `Import successful!`

- [ ] **Step 2: Confirm bootstrap's plan is clean**

```bash
terraform plan
```
Expected: `No changes. Your infrastructure matches the configuration.` — if this shows any diff, STOP and investigate before proceeding; it means the imported resource's real attributes don't match what `main.tf` declares (e.g. a tag drifted), and that must be reconciled first.

- [ ] **Step 3: Remove the same 7 resources from prod's state**

```bash
cd ../
terraform init -reconfigure -backend-config=prod.backend.hcl
terraform state rm aws_s3_bucket.terraform_state
terraform state rm aws_s3_bucket_versioning.terraform_state
terraform state rm aws_kms_key.terraform_state
terraform state rm aws_kms_alias.terraform_state
terraform state rm aws_s3_bucket_server_side_encryption_configuration.terraform_state
terraform state rm aws_s3_bucket_public_access_block.terraform_state
terraform state rm aws_iam_openid_connect_provider.github_actions
```
Expected after each: `Removed <address>` / `Successfully removed 1 resource instance(s).` — this only stops prod's state from *tracking* these resources, it does not delete anything in AWS.

- [ ] **Step 4: Confirm prod's plan is clean**

```bash
terraform plan -var="environment=prod"
```
Expected: `Plan: 0 to add, 0 to change, 0 to destroy.` — the `data` source should resolve the OIDC provider's ARN correctly with no diff on the 3 roles that reference it, and nothing else should be affected. If this shows anything other than 0/0/0, STOP — do not apply, investigate first.

- [ ] **Step 5: Confirm staging's plan is also clean**

```bash
terraform init -reconfigure -backend-config=staging.backend.hcl
terraform plan -var-file=staging.tfvars
```
Expected: since staging was destroyed earlier tonight, this will show the full staging stack needing to be created again (unrelated to this fix) — the important thing to verify is that **none of the 3 previously-erroring singleton resources appear anywhere in this plan** (confirming the recurring "already exists" errors are genuinely gone), and that it does NOT show `0 to add` if you expect a from-scratch staging plan — a from-scratch plan showing the OIDC-provider-related resources as "to create" here would mean something is still wrong (staging would try to fight prod for it again).

- [ ] **Step 6: Re-run prod's own IAM role apply is NOT needed**

Since Step 4's plan already came back clean (0/0/0), there is nothing further to apply against prod for this change — the migration is complete once state tracking has moved and both plans are clean.

---

### Task 6: Document the bootstrap module

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a short section**

In `CLAUDE.md`, near the existing `## Staging Environment` section, add:

```markdown
## Terraform Bootstrap Module

`infra/terraform/bootstrap/` holds account-wide singleton resources that
don't belong to any one environment: the Terraform state bucket + its KMS
key, and the GitHub Actions OIDC provider. Own state
(`bootstrap/terraform.tfstate`, same bucket), applied once and almost never
touched again -- the main prod/staging config only ever reads these via a
`data` source, never creates or modifies them. If you ever need to touch
this module: `cd infra/terraform/bootstrap && terraform init && terraform
plan` (no `-var-file`/`-var="environment=..."` needed, it doesn't take one).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the terraform bootstrap module"
```

---

## Explicitly out of scope

- **Automating the state migration itself into a script.** This is a one-time operation; scripting a `state rm`/`import` sequence for something that (by design) should never need to happen again is speculative tooling for a problem that doesn't recur.
- **Adding more resources to the bootstrap module preemptively** (e.g., a hypothetical future Route53 zone). Add to it only when a second genuine singleton resource actually shows up.

## Self-review notes

- **Spec coverage:** all 7 resources accounted for across Tasks 1-3, migration steps cover import + state rm + double plan-verification for both prod and staging, documentation added in Task 6.
- **Ordering safety:** Task 5 Step 2's clean-plan check on bootstrap happens *before* Task 5 Step 3 removes anything from prod's state — if the import ever drifted, prod's state still has the resources tracked and nothing is lost.
- **Type/reference consistency:** the `data "aws_iam_openid_connect_provider" "github_actions"` block's `url` argument matches exactly what the old `resource` block used (`"https://token.actions.githubusercontent.com"`), and the 3 trust-policy references are updated to the same new address (`data.aws_iam_openid_connect_provider.github_actions.arn`) consistently.

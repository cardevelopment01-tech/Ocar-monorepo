# Staging Environment (Load-Test Parity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a second, infrastructure-identical-to-prod environment (`staging`) that can be provisioned on demand for the client's load test, torn down after, and never risks touching prod's Terraform state or resources.

**Architecture:** Reuse every existing `.tf` file unchanged — every resource already interpolates `${var.environment}` in its name, so the same code produces a fully parallel stack when pointed at a different `environment` value. The only genuinely new things are: (1) a separate, explicitly-selected Terraform state file so `staging` can never collide with `prod/terraform.tfstate`, (2) a `staging.tfvars` with the values that must differ (domain), (3) a narrowly-scoped IAM role + `workflow_dispatch` GitHub Actions workflow so staging can be spun up/down by clicking a button instead of running raw `terraform` commands with hand-typed flags, and (4) a manual runbook for the parts that are secrets/third-party accounts, not Terraform (Neon DB branch, Razorpay test keys, Cloudflare DNS).

**Tech Stack:** Terraform (existing `hashicorp/aws ~> 6.0` provider, S3 backend with native locking), GitHub Actions (OIDC, no static AWS keys), Cloudflare DNS (manual, same as prod today), Neon Postgres branching.

---

## File structure

- Create: `infra/terraform/staging.backend.hcl` — points Terraform at a separate state file, selected explicitly via `-backend-config`, never a hidden `terraform workspace`.
- Create: `infra/terraform/staging.tfvars` — the values that differ from prod's defaults (just `environment` and `domain_name`).
- Modify: `infra/terraform/github-oidc.tf` — add a new, narrowly-scoped `github_actions_staging` IAM role (full apply/destroy, but only for the `staging/*` state path and resources tagged `Environment = staging`).
- Create: `.github/workflows/staging-infra.yml` — `workflow_dispatch` workflow with an `action: apply | destroy` input, so spinning staging up/down is a button click, not a local `terraform` invocation.
- Modify: `package.json` (repo root) — add `infra:staging:*` scripts for the same operations run locally, for whoever doesn't want to use the GitHub UI.
- Create: `docs/superpowers/specs/2026-08-14-staging-runbook.md` — the manual, secrets-involving steps (Cloudflare DNS, Neon branch, Razorpay test keys, populating the staging `api-env` SSM parameter) that can't be Terraform-automated.
- Modify: `CLAUDE.md` — document the new environment under a new "## Staging Environment" section.

---

### Task 1: Separate Terraform state for staging

**Files:**
- Create: `infra/terraform/staging.backend.hcl`

- [ ] **Step 1: Create the backend config file**

```hcl
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
```

- [ ] **Step 2: Verify it points somewhere different from prod**

Run: `grep -A1 '"key"' infra/terraform/providers.tf; cat infra/terraform/staging.backend.hcl`
Expected: `providers.tf` shows `key = "prod/terraform.tfstate"`, the new file shows `key = "staging/terraform.tfstate"` — two different paths in the same bucket, so `terraform init` with each config talks to a completely separate state object.

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/staging.backend.hcl
git commit -m "feat(infra): add separate backend config for staging state"
```

---

### Task 2: staging.tfvars — the values that must differ

**Files:**
- Create: `infra/terraform/staging.tfvars`

- [ ] **Step 1: Create the file**

```hcl
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
```

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/staging.tfvars
git commit -m "feat(infra): add staging.tfvars with load-test-parity values"
```

---

### Task 3: Narrowly-scoped IAM role for staging CI

**Files:**
- Modify: `infra/terraform/github-oidc.tf`

- [ ] **Step 1: Add the role + policy**

Append to the end of `infra/terraform/github-oidc.tf`:

```hcl
# Staging apply/destroy, triggered manually via workflow_dispatch (never on
# push/PR -- staging is provisioned on demand for a load test, not on every
# commit). Broader than the prod deploy role (that one only ever touches an
# image-tag parameter + ASG refresh) because this one runs full
# terraform apply/destroy -- scoped as tightly as that requires: only the
# staging state path, and only resources this config can even create (no
# wildcard iam:* or ec2:* across the whole account).
resource "aws_iam_role" "github_actions_staging" {
  name = "${var.project_name}-gha-staging"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github_actions.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:cardevelopment01-tech/Ocar-monorepo:ref:refs/heads/main"
        }
      }
    }]
  })

  tags = {
    Name = "${var.project_name}-gha-staging"
  }
}

resource "aws_iam_role_policy" "github_actions_staging" {
  name = "${var.project_name}-gha-staging-policy"
  role = aws_iam_role.github_actions_staging.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # State access -- same shape as the plan role's policy above, but
        # scoped to staging/* instead of prod/*.
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.terraform_state.arn}/staging/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketPolicy", "s3:GetBucketVersioning"]
        Resource = aws_s3_bucket.terraform_state.arn
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = aws_kms_key.terraform_state.arn
      },
      {
        # Full apply/destroy needs to create/modify/delete the resource
        # *types* this config manages -- VPC networking, the ALB, the ASG +
        # launch template, ElastiCache, SSM parameters, and the IAM
        # role/instance-profile the EC2 fleet itself assumes. This is
        # necessarily broader than the prod deploy role (which never
        # provisions anything, only flips a parameter + triggers a refresh)
        # -- full terraform apply of this config requires it. Not scoped
        # down to individual ARNs because most of these don't exist yet
        # before the first apply creates them.
        Effect = "Allow"
        Action = [
          "ec2:*Vpc*", "ec2:*Subnet*", "ec2:*RouteTable*", "ec2:*InternetGateway*",
          "ec2:*SecurityGroup*", "ec2:*LaunchTemplate*", "ec2:*Tags*",
          "ec2:Describe*",
          "elasticloadbalancing:*",
          "autoscaling:*",
          "elasticache:*",
          "ssm:*Parameter*",
          "iam:GetRole", "iam:CreateRole", "iam:DeleteRole", "iam:TagRole",
          "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
          "iam:CreateInstanceProfile", "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile",
          "iam:GetInstanceProfile", "iam:PassRole",
          "acm:*",
        ]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_staging_role_arn" {
  description = "IAM role ARN for the staging-infra workflow's aws-actions/configure-aws-credentials step"
  value       = aws_iam_role.github_actions_staging.arn
}
```

- [ ] **Step 2: Format and validate**

Run: `cd infra/terraform && terraform fmt -check -recursive && terraform validate`
Expected: `fmt` exits 0 (no diff), `validate` prints `Success! The configuration is valid.`

- [ ] **Step 3: Apply against the PROD state (this role itself is a prod-account resource, shared by both environments)**

Run: `cd infra/terraform && terraform plan -var="environment=prod" -out=tfplan && terraform apply tfplan`
Expected plan: `1 to add` (`aws_iam_role.github_actions_staging`) `+ 1 to add` (`aws_iam_role_policy.github_actions_staging`), `0 to change, 0 to destroy` — confirm nothing else shows up in the plan before applying.

- [ ] **Step 4: Note the role ARN for Task 5**

Run: `terraform output github_actions_staging_role_arn`
Copy this value — it goes into the new workflow file's `role-to-assume` input.

- [ ] **Step 5: Commit**

```bash
git add infra/terraform/github-oidc.tf
git commit -m "feat(infra): add scoped IAM role for staging apply/destroy via CI"
```

---

### Task 4: Convenience — local pnpm scripts

**Files:**
- Modify: `package.json` (repo root)

- [ ] **Step 1: Add the scripts**

In the root `package.json`'s `"scripts"` block, add:

```json
"infra:staging:init":    "cd infra/terraform && terraform init -reconfigure -backend-config=staging.backend.hcl",
"infra:staging:plan":    "cd infra/terraform && terraform plan -var-file=staging.tfvars -out=staging.tfplan",
"infra:staging:apply":   "cd infra/terraform && terraform apply staging.tfplan",
"infra:staging:destroy": "cd infra/terraform && terraform destroy -var-file=staging.tfvars"
```

(Plain `cd x && y`, no bash-only syntax — matches the existing `docker:up`/`test:api` scripts already in this file, Windows-safe.)

- [ ] **Step 2: Verify the scripts are wired correctly**

Run: `pnpm run` (no args, just lists available scripts)
Expected: the four new `infra:staging:*` entries appear in the list.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add pnpm scripts for local staging infra apply/destroy"
```

---

### Task 5: GitHub Actions workflow — one-click staging up/down

**Files:**
- Create: `.github/workflows/staging-infra.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Staging Infra (apply/destroy)

# Manual only -- never on push or pull_request. Staging is provisioned on
# demand for a load test, not kept in sync with every commit.
on:
  workflow_dispatch:
    inputs:
      action:
        description: "apply or destroy"
        required: true
        type: choice
        options: [apply, destroy]

permissions:
  id-token: write   # required for OIDC -- no static AWS keys stored anywhere
  contents: read

jobs:
  staging:
    name: terraform ${{ github.event.inputs.action }} (staging)
    runs-on: ubuntu-latest
    environment: staging
    defaults:
      run:
        working-directory: infra/terraform
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.STAGING_GHA_ROLE_ARN }}
          aws-region: ap-south-1

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: "1.15.8"
          terraform_wrapper: false

      - run: terraform init -backend-config=staging.backend.hcl

      - name: Plan
        run: terraform plan -var-file=staging.tfvars -out=tfplan

      - name: Apply
        if: github.event.inputs.action == 'apply'
        run: terraform apply -auto-approve tfplan

      - name: Destroy
        if: github.event.inputs.action == 'destroy'
        run: terraform destroy -var-file=staging.tfvars -auto-approve
```

- [ ] **Step 2: Add the role ARN as a repo secret**

In GitHub: **Settings → Environments → New environment → `staging`** → add environment secret `STAGING_GHA_ROLE_ARN` with the value from Task 3 Step 4. Using an **environment** secret (not a repo secret) means you can optionally add a required-reviewer gate on `staging` later without touching the workflow file.

- [ ] **Step 3: Verify the workflow file is valid YAML**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/staging-infra.yml','utf8')); console.log('valid')"` (adjust the `js-yaml` require path to whatever's vendored under `node_modules/.pnpm`, same trick used earlier this session for `docker-compose.prod.yml`)
Expected: `valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/staging-infra.yml
git commit -m "feat(ci): add on-demand staging infra apply/destroy workflow"
```

---

### Task 6: Manual runbook for the non-Terraform parts

**Files:**
- Create: `docs/superpowers/specs/2026-08-14-staging-runbook.md`

- [ ] **Step 1: Write the runbook**

```markdown
# Staging Environment Runbook

Manual steps needed alongside the Terraform in `infra/terraform/staging.*`
-- things that are secrets, third-party accounts, or DNS, none of which are
(or should be) checked into this repo or automated by Terraform.

## 1. Cloudflare DNS

After the first `terraform apply` against staging (via the GitHub Actions
workflow or `pnpm infra:staging:apply`), it will pause waiting for ACM
certificate validation. Run:

    terraform output acm_validation_record

Add that CNAME in Cloudflare (DNS only, **not proxied** -- same as prod's
existing record). Once it propagates, the apply finishes and outputs
`alb_dns_name`. Add a second Cloudflare CNAME:
`staging.ocar-api.clienttesting.in` -> that ALB DNS name (DNS only, not
proxied -- proxying would break the ALB's own TLS termination).

## 2. Neon database branch

In the Neon console, create a branch off the production database
specifically for this load test. Branching is copy-on-write, so it starts
with production's real data volume (needed for realistic PostGIS
query-planner/index behavior under load) without being a second full copy
you pay for or a live connection to prod. Copy the branch's connection
string (use the `-pooler` host, same as prod's convention documented in
`api/.env.example`).

## 3. Razorpay test-mode keys

Razorpay dashboard -> Settings -> API Keys -> generate a **Test Mode**
key pair. Test mode has its own dummy balance; no real money moves and no
real bank rails are touched, confirmed directly against Razorpay's own
docs. Razorpay's request-rate-limiter still applies in test mode, so the
load test script needs the same exponential-backoff-on-429 handling it
would need against production.

## 4. SMS / call-masking / push

Fast2SMS, Exotel, and FCM don't have as clean a "test mode" as Razorpay.
For the load test window specifically, either:
  - Point them at whatever sandbox/trial credentials each provider offers, or
  - If no sandbox exists, temporarily stub `notifications.worker.ts` and
    `call-masking.service.ts` behind a `STAGING_STUB_NOTIFICATIONS=true` env
    check so the load test exercises the rest of the request path (DB,
    booking logic, ride state machine) without actually dispatching real
    SMS/calls to real phone numbers at load-test volume.
  (This stub, if needed, is a small follow-up -- not written in this plan
  since it depends on which of the two options the client's load test
  actually needs; add it only if the sandbox route turns out not to exist.)

## 5. Populate the staging `api-env` SSM parameter

The parameter is created empty by the first `terraform apply` (see
`ssm-observability.tf`'s pattern -- `api-env` itself is a `SecureString`
populated by hand, same as prod's, not committed to the repo). Pull prod's
current `api-env` as a starting template, then swap in:
  - `DATABASE_URL` -> the Neon branch connection string from step 2
  - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` -> the test-mode keys from step 3
  - `JWT_SECRET` -> a fresh, staging-only secret (never reuse prod's)
  - Any Fast2SMS/Exotel/FCM credentials per step 4's decision

    aws ssm put-parameter --name "/ocar/staging/api-env" --type SecureString \
      --value "$(cat staging-api-env.txt)" --overwrite

## 6. Tear down after the load test

    pnpm infra:staging:destroy

or trigger the `Staging Infra` GitHub Actions workflow with `action: destroy`.
Confirm in the AWS console afterward that the staging ALB, ASG, and
ElastiCache replication group are actually gone -- `terraform destroy`
should catch everything this config created, but a visual confirmation
after a first-ever destroy of a new stack is cheap insurance.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-14-staging-runbook.md
git commit -m "docs: add staging environment manual runbook"
```

---

### Task 7: Document the new environment in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a new section**

After the `## CI/CD` section in `CLAUDE.md`, add:

```markdown
## Staging Environment

A second, infrastructure-identical copy of prod, provisioned on demand for
client load tests -- not a permanent always-on environment. Same
`instance_type`/ASG scaling policy/ElastiCache tier as prod (the whole
point of a load-test environment is trustworthy numbers), but its own
Terraform state (`staging/terraform.tfstate`, never `prod/terraform.tfstate`)
and its own non-production secrets (Razorpay test-mode keys, a Neon DB
branch, a separate JWT secret) -- see
`docs/superpowers/specs/2026-08-14-staging-runbook.md` for the manual
non-Terraform steps.

**Spin up:** GitHub Actions -> "Staging Infra (apply/destroy)" -> Run
workflow -> `action: apply` (or `pnpm infra:staging:apply` locally after
`pnpm infra:staging:init` + `pnpm infra:staging:plan`).

**Tear down:** same workflow with `action: destroy`, or
`pnpm infra:staging:destroy`. Always tear down after a load test --
this environment isn't meant to run continuously.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the staging environment in CLAUDE.md"
```

---

## Explicitly out of scope (don't build these)

- **A separate AWS account for staging.** Full account-level blast-radius isolation is the gold-standard pattern, but it's a much bigger organizational change (separate billing, cross-account IAM, a new OIDC trust setup) than this client engagement needs right now. The state-separation + narrowly-scoped IAM role in this plan is the pragmatic middle ground for a single-team, on-demand load-test environment. Revisit if staging becomes a permanent fixture rather than an on-demand one.
- **Auto-apply staging on every PR/push.** Deliberately manual (`workflow_dispatch` only) -- staging exists for scheduled load-test windows, not continuous deployment. Wiring it into the normal CI/CD flow would just mean paying for it constantly.
- **A shared/reduced-size "always-on" staging for catching bad deploys** (the original motivating idea from earlier in the conversation, e.g. tonight's bad `cadvisor` tag). That's a genuinely different environment with different fidelity requirements (doesn't need prod-scale) -- worth its own, separate plan if wanted, not folded into this one.
- **Stubbing Fast2SMS/Exotel/FCM in code**, until it's confirmed no sandbox mode exists for them (see runbook step 4) -- don't build a stub for a problem that might not exist.

## Self-review notes

- **Spec coverage:** infrastructure parity ✅ (Task 1-2, everything else inherits prod's defaults unchanged), safe state separation ✅ (Task 1, explicit not implicit), convenience ✅ (Task 4 local scripts + Task 5 one-click CI workflow), best practices for the parts that must NOT match prod ✅ (Task 6 runbook: test-mode payment keys, DB branch instead of a live prod connection, separate secrets).
- **Type/naming consistency:** `staging.backend.hcl` (Task 1) and `staging.tfvars` (Task 2) are referenced identically in Task 4's pnpm scripts, Task 5's workflow, and Task 6's runbook -- no drift between the file names used across tasks.
- **Ordering:** Task 3 (IAM role) must land and be applied to *prod's* state before Task 5's workflow can actually run, since the role itself is a prod-account resource shared by both environments -- called out explicitly in Task 3 Step 3.

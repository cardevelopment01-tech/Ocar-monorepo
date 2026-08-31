# Staging Environment Runbook

Manual steps needed alongside the Terraform in `infra/terraform/staging.*`
-- things that are secrets, third-party accounts, or DNS, none of which are
(or should be) checked into this repo or automated by Terraform.

## 0. Apply the staging IAM role (once, against PROD state)

The `github_actions_staging` IAM role itself is a prod-account resource
(shared infrastructure, not staging-specific), so it's applied against the
existing prod Terraform state, not the new staging one. `providers.tf`'s
backend block is deliberately empty now (see its comment) -- no backend is
ever a silent default, so the init step below is mandatory, not optional:

    cd infra/terraform
    terraform init -reconfigure -backend-config=prod.backend.hcl
    terraform plan -var="environment=prod" -out=tfplan
    terraform apply tfplan

If you're switching back and forth between prod and staging work in the same
terminal session, always re-run the matching `-backend-config` init first --
`pnpm infra:prod:init` / `pnpm infra:staging:init` do exactly this.

Review the plan output first -- it should show only the new IAM role/policy/
output being added, nothing else changing. Then:

    terraform output github_actions_staging_role_arn

Use that value for the `STAGING_GHA_ROLE_ARN` secret in step 1.

## 1. GitHub Environment + reviewer gate (do this before ever using the workflow)

`.github/workflows/staging-infra.yml`'s `environment: staging` reference is
currently inert -- the `staging` GitHub Environment doesn't exist yet, and
this repo's `gh` account doesn't have admin rights to create it (confirmed:
`gh api repos/:owner/:repo --jq '.permissions'` -> `admin: false`), same gap
CLAUDE.md already documents for `production`. Whoever has admin access
should run:

    gh api --method PUT repos/:owner/:repo/environments/staging
    REVIEWER_ID=$(gh api users/<your-github-username> --jq .id)
    gh api --method PUT repos/:owner/:repo/environments/staging \
      -f "reviewers[][type]=User" \
      -F "reviewers[][id]=$REVIEWER_ID"

Then add `STAGING_GHA_ROLE_ARN` as an **environment secret** on that `staging`
environment (Settings -> Environments -> staging -> Add secret), with the
value from `terraform output github_actions_staging_role_arn` (see step 0
above -- you need the IAM role applied first before this ARN exists).
Without the reviewer gate, an accidental `destroy` dispatch has no human
confirmation step at all.

## 2. Cloudflare DNS

After the first `terraform apply` against staging (via the GitHub Actions
workflow or `pnpm infra:staging:apply`), it will pause waiting for ACM
certificate validation. Run:

    terraform output acm_validation_record

Add that CNAME in Cloudflare (DNS only, **not proxied** -- same as prod's
existing record). Once it propagates, the apply finishes and outputs
`alb_dns_name`. Add a second Cloudflare CNAME:
`staging.ocar-api.clienttesting.in` -> that ALB DNS name (DNS only, not
proxied -- proxying would break the ALB's own TLS termination).

## 3. Staging RDS instance (restored from a production snapshot)

Correction (this step originally described a Neon branch — production runs
RDS, Neon is stale/unused, so staging's DB must be provisioned the RDS-native
way to actually satisfy `LOAD_TEST_PLAN.md` §1's "infrastructure-identical to
production" requirement for the database tier too):

1. Take a manual RDS snapshot of the production DB instance (same action as
   client task list item 1 — "take a DB backup"; this snapshot **is** that
   backup, not a separate step):
   `aws rds create-db-snapshot --db-instance-identifier <prod-instance-id> --db-snapshot-identifier ocar-staging-seed-<date>`
2. Restore a new staging instance from that snapshot, same region
   (`ap-south-1`) and same instance class as production:
   `aws rds restore-db-instance-from-db-snapshot --db-instance-identifier ocar-staging-db --db-snapshot-identifier ocar-staging-seed-<date> --db-instance-class <same-as-prod>`
3. Place it in the staging VPC/subnet group (not prod's), confirm its
   security group only allows traffic from staging's ASG, and note its
   endpoint (`-pooler`-equivalent convention doesn't apply to RDS — use the
   instance endpoint directly, same as prod's `DATABASE_URL` convention in
   `api/.env.example` minus the pooler suffix).

This instance already contains production's real data volume (drivers,
vehicles, cities, rate cards, etc.) — no separate driver/reference-data
seeding needed on top, only the synthetic rider/ride seed
(`api/scripts/seed-load-test-data.sql`) plus the synthetic driver top-up
noted in `LOAD_TEST_PLAN.md` §3's amendment (production currently has ~200
active drivers, short of the 400-driver concurrent target).

## 4. Razorpay test-mode keys

Razorpay dashboard -> Settings -> API Keys -> generate a **Test Mode**
key pair. Test mode has its own dummy balance; no real money moves and no
real bank rails are touched, confirmed directly against Razorpay's own
docs. Razorpay's request-rate-limiter still applies in test mode, so the
load test script needs the same exponential-backoff-on-429 handling it
would need against production.

## 5. SMS / call-masking / push

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

## 6. Populate the staging `api-env` SSM parameter

Unlike `docker-compose-prod` and `alloy-config` (which `ssm-observability.tf`
creates via Terraform from files in the repo), there is no Terraform resource
that creates `api-env` -- it must be created **manually** as a `SecureString`,
same as prod's (`infra/terraform/iam.tf` only reads this parameter, it never
creates it). Pull prod's current `api-env` as a starting template, then swap
in:
  - `DATABASE_URL` -> the Neon branch connection string from step 3
  - `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` -> the test-mode keys from step 4
  - `JWT_SECRET` -> a fresh, staging-only secret (never reuse prod's)
  - Any Fast2SMS/Exotel/FCM credentials per step 5's decision

    aws ssm put-parameter --name "/ocar/staging/api-env" --type SecureString \
      --value "$(cat staging-api-env.txt)" --overwrite

## 7. Tear down after the load test

    pnpm infra:staging:destroy

or trigger the `Staging Infra` GitHub Actions workflow with `action: destroy`.
Confirm in the AWS console afterward that the staging ALB, ASG, and
ElastiCache replication group are actually gone -- `terraform destroy`
should catch everything this config created, but a visual confirmation
after a first-ever destroy of a new stack is cheap insurance.

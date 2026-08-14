# Staging Environment Runbook

Manual steps needed alongside the Terraform in `infra/terraform/staging.*`
-- things that are secrets, third-party accounts, or DNS, none of which are
(or should be) checked into this repo or automated by Terraform.

## 0. GitHub Environment + reviewer gate (do this before ever using the workflow)

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
value from `terraform output github_actions_staging_role_arn` (see step 3
below -- you need the IAM role applied first before this ARN exists).
Without the reviewer gate, an accidental `destroy` dispatch has no human
confirmation step at all.

## 1. Apply the staging IAM role (once, against PROD state)

The `github_actions_staging` IAM role itself is a prod-account resource
(shared infrastructure, not staging-specific), so it's applied against the
existing prod Terraform state, not the new staging one:

    cd infra/terraform
    terraform plan -var="environment=prod" -out=tfplan
    terraform apply tfplan

Review the plan output first -- it should show only the new IAM role/policy/
output being added, nothing else changing. Then:

    terraform output github_actions_staging_role_arn

Use that value for the `STAGING_GHA_ROLE_ARN` secret in step 0.

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

## 3. Neon database branch

In the Neon console, create a branch off the production database
specifically for this load test. Branching is copy-on-write, so it starts
with production's real data volume (needed for realistic PostGIS
query-planner/index behavior under load) without being a second full copy
you pay for or a live connection to prod. Copy the branch's connection
string (use the `-pooler` host, same as prod's convention documented in
`api/.env.example`).

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

The parameter is created empty by the first `terraform apply` (see
`ssm-observability.tf`'s pattern -- `api-env` itself is a `SecureString`
populated by hand, same as prod's, not committed to the repo). Pull prod's
current `api-env` as a starting template, then swap in:
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

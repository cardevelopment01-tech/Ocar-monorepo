# Ops Runbook — Production Infra

Practical "how do I do X" reference for operating the prod fleet. For the
architecture rationale (why ASG/ALB, why no NAT gateway, why local state
originally, etc.) see `docs/TERRAFORM_INFRA_BRIEF.md`. For standing up
staging, see `docs/superpowers/specs/2026-08-14-staging-runbook.md`.

Prereqs for anything here: `aws` CLI configured with prod credentials (or
rely on the GitHub Actions OIDC role — see "Who can do what" below),
Terraform 1.15.8, repo checked out, working directory `infra/terraform`.

## Deploy new API code

Fully automatic — merge to `main` triggers `.github/workflows/ci.yml`, which
on success triggers `.github/workflows/deploy.yml`: builds the image, pushes
to GHCR, runs migrations, writes the new tag to SSM
(`/ocar/prod/image-tag`), does a rolling `instance_refresh` on the ASG
(100/100 min/max healthy — zero downtime), then health-checks `/health` and
smoke-tests `/api/v1/geo/cities`. Auto-rolls-back the image tag + triggers
another refresh if any check fails.

**No manual step needed for a normal deploy.** Only touch this if the
pipeline itself is broken.

**Manual rollback** (if auto-rollback didn't fire, or you need to go back
further than one version):
```bash
aws ssm put-parameter --name /ocar/prod/image-tag --type String \
  --value "<previous-good-tag>" --overwrite
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name <ASG_NAME> \
  --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":100}'
```
Migrations are forward-only — rolling back the image does **not** undo a
migration. If a bad migration is the actual problem, fix it forward with a
new migration file, don't try to revert.

## Scale capacity (more/fewer instances)

Within the existing 2–4 range, nothing to do — the ASG's target-tracking
policy (`aws_autoscaling_policy.request_count_tracking` in `asg.tf`) already
adds/removes instances on `ALBRequestCountPerTarget`.

To change the range itself (e.g. raise `max_size` past 4, or raise the
`t3.medium` baseline), edit `infra/terraform/asg.tf` (`min_size` /
`desired_capacity` / `max_size`) or `instance_type` in `variables.tf`, then:
```bash
pnpm infra:prod:init   # only needed once per terminal session / after switching envs
pnpm infra:prod:plan   # review the diff
pnpm infra:prod:apply  # applies infra/terraform/prod.tfplan
```
Opening a PR that touches `infra/**` also gets you the same plan for free as
a PR comment (`.github/workflows/terraform-plan.yml`) before you apply
locally.

## Make any other infra change

Same three commands as above (`init` → `plan` → `apply`) for anything in
`infra/terraform/*.tf` — security groups, ALB listener rules, IAM, etc.
Always read the plan output before applying; nothing here auto-applies on
merge (only `terraform-plan.yml`'s PR-comment plan runs in CI — actual
`apply` is a deliberate local/manual step, by design, since AWS changes
aren't cheaply reversible the way an app deploy is).

## Check health / logs / metrics

- `GET https://ocar-api.clienttesting.in/health` — same check the ALB target
  group and deploy pipeline use.
- Grafana Cloud (Loki/Mimir/Tempo, shipped by the Alloy agent on each
  instance) — logs, `pg_pool_connections`, `http_request_duration_seconds`,
  `bullmq_queue_job_counts`, per-container CPU/memory (cAdvisor row on the
  `ocar-overview` dashboard), BullMQ queue depth.
- AWS Console → EC2 → Auto Scaling Groups → `<ASG_NAME>` for instance
  count/health, or `aws autoscaling describe-auto-scaling-groups
  --auto-scaling-group-names <ASG_NAME>`.

## Rotate a secret (DB URL, JWT secret, Razorpay keys, etc.)

All of it lives in one SSM `SecureString` parameter, `/ocar/prod/api-env` —
there's no Terraform resource for it (`iam.tf` only grants read access, it's
never created by `apply`). To change one value you must pull the whole
blob, edit it, and push the whole thing back (this is the exact ergonomic
pain flagged in `CLAUDE.md`'s "Pending Ops Actions" as a candidate for a
proper secrets manager later):
```bash
aws ssm get-parameter --name /ocar/prod/api-env --with-decryption \
  --query 'Parameter.Value' --output text > api-env.txt
# edit api-env.txt by hand
aws ssm put-parameter --name /ocar/prod/api-env --type SecureString \
  --value "$(cat api-env.txt)" --overwrite
rm api-env.txt   # don't leave decrypted secrets on disk
```
Then roll the fleet so running instances pick it up (they only read SSM at
boot):
```bash
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name <ASG_NAME> \
  --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":100}'
```

## Updating an observability secret (Grafana Cloud alerting/SLO/synthetics)

`infra/terraform/observability/` (alert rules, SLOs, synthetic monitoring —
one account-wide Grafana Cloud stack, applied locally, not from CI) reads
every credential/config value it needs from SSM under
`/ocar/observability/*` — never from a local `.tfvars` file or `TF_VAR_*`
env vars (a laptop-only tfvars file for this module got lost once already,
2026-08-19, which is exactly the single point of failure this avoids).

To change one (e.g. rotating the Grafana Service Account token):
```bash
aws ssm put-parameter --name /ocar/observability/grafana-auth \
  --type SecureString --value "<new-value>" --overwrite
```
Same pattern for the other 8 parameters (`grafana-url`, `slack-webhook-url`,
`alert-email`, `prometheus-datasource-uid`, `synthetic-probe-ids` —
comma-separated numbers, e.g. `"39,44"`, `sm-access-token`, `sm-url`,
`usage-insights-datasource-uid`) — use `--type String` for the non-secret
ones. No instance refresh needed (Terraform reads SSM live at `plan`/`apply`
time, unlike the boot-time-only params in `/ocar/prod/*`). Then:
```bash
cd infra/terraform/observability
terraform plan   # no -var/-var-file needed, ever
terraform apply
```

## Stand up / tear down staging (load-test environment)

Full manual-step runbook already written:
`docs/superpowers/specs/2026-08-14-staging-runbook.md`. Short version:
`.github/workflows/staging-infra.yml` (`workflow_dispatch`, choose `apply`
or `destroy`), or locally: `pnpm infra:staging:init/plan/apply/destroy`.
**Always destroy after a load test** — staging isn't meant to run
continuously and costs the same per-instance rate as prod.

## Who can do what (current gaps — see CLAUDE.md "Pending Ops Actions")

- Deploys to `main` currently run with **no human approval gate** — the
  `production` GitHub Environment referenced in `deploy.yml` doesn't exist
  yet, so it's inert. Needs repo admin to create it.
- Same gap on the `staging` environment for `staging-infra.yml` — a
  `destroy` dispatch has no confirmation step today.
- No branch protection on `main` — a direct push bypasses PR review
  entirely (CI still has to pass before *deploy*, but not before *merge*).

Whoever has GitHub org/repo admin rights should close these before treating
this pipeline as fully production-hardened — exact `gh api` commands are in
`CLAUDE.md`.
